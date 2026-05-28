/**
 * Read-only query helpers for the admin console (ADR 0009, Phase 1).
 *
 * These live in the indexer (the DB owner) and take a `PrismaClient` so
 * they are unit-testable against a real Postgres. The Next.js route
 * handlers in `app/api/admin/**` are thin wrappers: they call
 * `requireAdmin` first, then one of these, then shape the JSON + attach
 * staleness. No behavioral number that depends on the projected `events`
 * is surfaced until the on-devnet exact-value smoke passes (ADR 0009
 * close-out #5) — these helpers expose STRUCTURAL state + indexer health
 * only; the events-derived behavioral timeline is a separate, gated query.
 *
 * SSOT split (ADR 0009 §3): history/structural ← here (indexer DB);
 * live pool/member status ← fresh RPC in the route handler.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

// ─── Indexer health / staleness ──────────────────────────────────────────

export interface IndexerHealth {
  /** Highest slot the indexer cursor has processed (null = never ran). */
  lastSlot: string | null;
  /** Unix seconds of the last cursor update (null = never ran). */
  lastUpdateUnix: number | null;
  /**
   * Cluster slot minus lastSlot, when the caller supplies a fresh cluster
   * slot from RPC. null when not provided — the UI then shows "lag unknown"
   * rather than a fake 0 (staleness must never be invisible).
   */
  slotsBehind: number | null;
  lastBackfill: {
    status: string;
    startedAtUnix: number;
    durationMs: number | null;
  } | null;
  /** Typed-table rows still awaiting reconciliation (resolvedAt IS NULL). */
  unresolved: { contribute: number; claim: number; default: number };
  /** Typed-table rows the reconciler marked orphaned (excluded from canon). */
  orphaned: { contribute: number; claim: number; default: number };
  /**
   * `events` projection freshness: max(builtAt) + projected row count.
   * `events` is batch-projected (not live), so the admin shows
   * "events as of <lastProjectionUnix>" — never implies real-time.
   */
  lastProjectionUnix: number | null;
  projectedEventCount: number;
}

export async function computeIndexerHealth(
  prisma: PrismaClient,
  clusterSlot?: number | null,
): Promise<IndexerHealth> {
  const [cursor, backfill, unresolved, orphaned, lastEvent, projectedEventCount] =
    await Promise.all([
      prisma.indexerCursor.findFirst({ orderBy: { updatedAt: "desc" } }),
      prisma.backfillRun.findFirst({ orderBy: { startedAt: "desc" } }),
      Promise.all([
        prisma.contributeEvent.count({ where: { resolvedAt: null } }),
        prisma.claimEvent.count({ where: { resolvedAt: null } }),
        prisma.defaultEvent.count({ where: { resolvedAt: null } }),
      ]),
      Promise.all([
        prisma.contributeEvent.count({ where: { orphaned: true } }),
        prisma.claimEvent.count({ where: { orphaned: true } }),
        prisma.defaultEvent.count({ where: { orphaned: true } }),
      ]),
      prisma.event.findFirst({ orderBy: { builtAt: "desc" }, select: { builtAt: true } }),
      prisma.event.count(),
    ]);

  return {
    lastSlot: cursor ? cursor.lastSlot.toString() : null,
    lastUpdateUnix: cursor ? Math.floor(cursor.updatedAt.getTime() / 1000) : null,
    slotsBehind:
      clusterSlot != null && cursor ? Math.max(0, clusterSlot - Number(cursor.lastSlot)) : null,
    lastBackfill: backfill
      ? {
          status: backfill.status,
          startedAtUnix: Math.floor(backfill.startedAt.getTime() / 1000),
          durationMs: backfill.durationMs,
        }
      : null,
    unresolved: { contribute: unresolved[0], claim: unresolved[1], default: unresolved[2] },
    orphaned: { contribute: orphaned[0], claim: orphaned[1], default: orphaned[2] },
    lastProjectionUnix: lastEvent ? Math.floor(lastEvent.builtAt.getTime() / 1000) : null,
    projectedEventCount,
  };
}

// ─── Canary overview (structural; behavioral is gated) ─────────────────────

export interface CanaryOverview {
  pools: {
    total: number;
    byStatus: Record<string, number>;
    /** Pools carrying ≥1 on-chain defaulted member (structural risk flag). */
    atRisk: number;
  };
  members: { total: number };
  events: { contribute: number; claim: number; default: number };
  indexer: IndexerHealth;
}

export async function getCanaryOverview(
  prisma: PrismaClient,
  clusterSlot?: number | null,
): Promise<CanaryOverview> {
  const [byStatusRows, totalPools, atRisk, members, eventsByType, indexer] = await Promise.all([
    prisma.pool.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.pool.count(),
    prisma.pool.count({ where: { defaultedMembers: { gt: 0 } } }),
    prisma.member.count(),
    prisma.event.groupBy({ by: ["eventType"], _count: { _all: true } }),
    computeIndexerHealth(prisma, clusterSlot),
  ]);

  const byStatus: Record<string, number> = {
    Forming: 0,
    Active: 0,
    Completed: 0,
    Liquidated: 0,
    Closed: 0,
  };
  for (const row of byStatusRows) byStatus[row.status] = row._count._all;

  const events = { contribute: 0, claim: 0, default: 0 };
  for (const row of eventsByType) {
    if (row.eventType === "Contribute") events.contribute = row._count._all;
    else if (row.eventType === "Claim") events.claim = row._count._all;
    else if (row.eventType === "Default") events.default = row._count._all;
  }

  return {
    pools: { total: totalPools, byStatus, atRisk },
    members: { total: members },
    events,
    indexer,
  };
}

// ─── Pools list (structural, from the indexer DB) ──────────────────────────

export type PoolHealthLabel = "healthy" | "at_risk" | "distressed";

export interface AdminPoolRow {
  pda: string;
  authority: string;
  seedId: string;
  status: string;
  currentCycle: number;
  cyclesTotal: number;
  membersJoined: number;
  membersTarget: number;
  defaultedMembers: number;
  startedAtUnix: number | null;
  nextCycleAtUnix: number | null;
  totalContributed: string;
  totalPaidOut: string;
  solidarityBalance: string;
  escrowBalance: string;
  /** Structural health from DB fields (RPC cross-check happens in detail). */
  health: PoolHealthLabel;
  updatedAtUnix: number;
}

/**
 * Structural pool health from DB fields only. NOT the SDK
 * `computePoolHealth` (which needs live MemberView[] from RPC) — the pools
 * LIST is a cheap DB read; the pool DETAIL view cross-checks live via RPC.
 */
function structuralHealth(defaultedMembers: number, membersTarget: number): PoolHealthLabel {
  if (defaultedMembers === 0) return "healthy";
  // > ~20% of seats defaulted reads as distressed; any default is at_risk.
  if (membersTarget > 0 && defaultedMembers * 5 >= membersTarget) return "distressed";
  return "at_risk";
}

export async function listPoolsForAdmin(prisma: PrismaClient): Promise<AdminPoolRow[]> {
  const pools = await prisma.pool.findMany({ orderBy: { createdAt: "asc" } });
  return pools.map((p) => ({
    pda: p.pda,
    authority: p.authority,
    seedId: p.seedId.toString(),
    status: p.status,
    currentCycle: p.currentCycle,
    cyclesTotal: p.cyclesTotal,
    membersJoined: p.membersJoined,
    membersTarget: p.membersTarget,
    defaultedMembers: p.defaultedMembers,
    startedAtUnix: p.startedAt != null ? Number(p.startedAt) : null,
    nextCycleAtUnix: p.nextCycleAt != null ? Number(p.nextCycleAt) : null,
    totalContributed: p.totalContributed.toString(),
    totalPaidOut: p.totalPaidOut.toString(),
    solidarityBalance: p.solidarityBalance.toString(),
    escrowBalance: p.escrowBalance.toString(),
    health: structuralHealth(p.defaultedMembers, p.membersTarget),
    updatedAtUnix: Math.floor(p.updatedAt.getTime() / 1000),
  }));
}

// ─── Behavioral aggregates (unblocked — ADR 0009 gate #5 cleared) ──────────
//
// Derived from the projected `events` table (`behavioral.ts` semantics):
//   on_time ⟺ delta_seconds <= 0 ; late ⟺ delta_seconds > 0 ;
//   grace_used = late-but-within-7d. Only Contribute events carry payment
//   timing; defaults are counted from Default events. Rates are bps of the
//   timed-contribution population (events with a non-null due_ts — i.e. the
//   pool was Active). The on-devnet smoke (2026-05-27) confirmed these
//   exact values against the chain.

export interface BehavioralAggregate {
  /** Contribute events with a computable deadline (pool was Active). */
  timedContributions: number;
  onTime: number;
  late: number;
  graceUsed: number;
  /** On-time share, in basis points of timedContributions (null if none). */
  onTimeRateBps: number | null;
  /** Mean positive delay over LATE contributions, seconds (null if none). */
  avgDelaySecondsLate: number | null;
  defaults: number;
}

export async function getCanaryBehavioral(prisma: PrismaClient): Promise<BehavioralAggregate> {
  const contributeTimed = { eventType: "Contribute" as const, dueTs: { not: null } };
  const [timed, onTime, late, graceUsed, lateAgg, defaults] = await Promise.all([
    prisma.event.count({ where: contributeTimed }),
    prisma.event.count({ where: { ...contributeTimed, deltaSeconds: { lte: 0 } } }),
    prisma.event.count({ where: { ...contributeTimed, deltaSeconds: { gt: 0 } } }),
    prisma.event.count({ where: { eventType: "Contribute", graceUsed: true } }),
    prisma.event.aggregate({
      where: { ...contributeTimed, deltaSeconds: { gt: 0 } },
      _avg: { deltaSeconds: true },
    }),
    prisma.event.count({ where: { eventType: "Default" } }),
  ]);

  return {
    timedContributions: timed,
    onTime,
    late,
    graceUsed,
    onTimeRateBps: timed > 0 ? Math.round((onTime / timed) * 10_000) : null,
    avgDelaySecondsLate:
      lateAgg._avg.deltaSeconds != null ? Math.round(lateAgg._avg.deltaSeconds) : null,
    defaults,
  };
}

// ─── Pool detail: structural members + behavioral cycle timeline ───────────

export interface AdminMemberRow {
  wallet: string;
  slotIndex: number;
  reputationLevel: number;
  contributionsPaid: number;
  onTimeCount: number;
  lateCount: number;
  defaulted: boolean;
  paidOut: boolean;
  escrowBalance: string;
}

export interface TimelineEntry {
  txSig: string;
  eventType: string;
  subjectWallet: string;
  cycle: number;
  slotIndex: number;
  onChainTsUnix: number;
  dueTsUnix: number | null;
  deltaSeconds: number | null;
  graceUsed: boolean;
  defaultReason: string | null;
  defaultReasonProvenance: string | null;
}

export interface PoolDetail {
  pool: AdminPoolRow;
  /** On-chain member counters (chain truth via backfill) — NOT events. */
  members: AdminMemberRow[];
  /** Per-cycle behavioral timeline from the projected `events` (resolved). */
  timeline: TimelineEntry[];
}

export async function getPoolDetail(prisma: PrismaClient, pda: string): Promise<PoolDetail | null> {
  const p = await prisma.pool.findUnique({ where: { pda } });
  if (!p) return null;

  const [members, events] = await Promise.all([
    prisma.member.findMany({ where: { poolId: p.id }, orderBy: { slotIndex: "asc" } }),
    prisma.event.findMany({
      where: { poolId: p.id },
      orderBy: [{ cycle: "asc" }, { slotNumber: "asc" }],
    }),
  ]);

  const pool: AdminPoolRow = {
    pda: p.pda,
    authority: p.authority,
    seedId: p.seedId.toString(),
    status: p.status,
    currentCycle: p.currentCycle,
    cyclesTotal: p.cyclesTotal,
    membersJoined: p.membersJoined,
    membersTarget: p.membersTarget,
    defaultedMembers: p.defaultedMembers,
    startedAtUnix: p.startedAt != null ? Number(p.startedAt) : null,
    nextCycleAtUnix: p.nextCycleAt != null ? Number(p.nextCycleAt) : null,
    totalContributed: p.totalContributed.toString(),
    totalPaidOut: p.totalPaidOut.toString(),
    solidarityBalance: p.solidarityBalance.toString(),
    escrowBalance: p.escrowBalance.toString(),
    health: structuralHealth(p.defaultedMembers, p.membersTarget),
    updatedAtUnix: Math.floor(p.updatedAt.getTime() / 1000),
  };

  return {
    pool,
    members: members.map((m) => ({
      wallet: m.wallet,
      slotIndex: m.slotIndex,
      reputationLevel: m.reputationLevel,
      contributionsPaid: m.contributionsPaid,
      onTimeCount: m.onTimeCount,
      lateCount: m.lateCount,
      defaulted: m.defaulted,
      paidOut: m.paidOut,
      escrowBalance: m.escrowBalance.toString(),
    })),
    timeline: events.map((e) => ({
      txSig: e.txSig,
      eventType: e.eventType,
      subjectWallet: e.subjectWallet,
      cycle: e.cycle,
      slotIndex: e.slotIndex,
      onChainTsUnix: Number(e.onChainTs),
      dueTsUnix: e.dueTs != null ? Number(e.dueTs) : null,
      deltaSeconds: e.deltaSeconds,
      graceUsed: e.graceUsed,
      defaultReason: e.defaultReason,
      defaultReasonProvenance: e.defaultReasonProvenance,
    })),
  };
}

// ─── Users: behavioral profile per wallet (the moat — ADR 0009) ────────────
//
// Identity = WALLET (reputation is per-wallet on-chain; escape-valve mints a
// NEW identity — no cross-wallet linking). The canonical score/level comes
// from the on-chain ReputationProfile (fetched via RPC in the route); the
// helpers here expose the indexer-side STRUCTURAL + behavioral-derived view,
// all aggregated ACROSS pools (a wallet joins many). Derived metrics are
// "experimental"; behavioral.ts is the single source of timing semantics.

export interface AdminUserRow {
  wallet: string;
  /** Distinct pools this wallet is a member of. */
  pools: number;
  /** Max on-chain reputationLevel snapshot across memberships (DB; the
   *  canonical live level is on the profile via RPC). */
  level: number;
  timedContributions: number;
  onTime: number;
  onTimeRateBps: number | null;
  defaults: number;
}

export async function listUsersForAdmin(prisma: PrismaClient): Promise<AdminUserRow[]> {
  const members = await prisma.member.findMany({
    select: { wallet: true, poolId: true, reputationLevel: true },
  });
  const byWallet = new Map<string, { pools: Set<string>; level: number }>();
  for (const m of members) {
    const e = byWallet.get(m.wallet) ?? { pools: new Set<string>(), level: 0 };
    e.pools.add(m.poolId);
    e.level = Math.max(e.level, m.reputationLevel);
    byWallet.set(m.wallet, e);
  }

  const [timed, onTime, defaults] = await Promise.all([
    prisma.event.groupBy({
      by: ["subjectWallet"],
      where: { eventType: "Contribute", dueTs: { not: null } },
      _count: { _all: true },
    }),
    prisma.event.groupBy({
      by: ["subjectWallet"],
      where: { eventType: "Contribute", dueTs: { not: null }, deltaSeconds: { lte: 0 } },
      _count: { _all: true },
    }),
    prisma.event.groupBy({
      by: ["subjectWallet"],
      where: { eventType: "Default" },
      _count: { _all: true },
    }),
  ]);
  const timedMap = new Map(timed.map((r) => [r.subjectWallet, r._count._all]));
  const onTimeMap = new Map(onTime.map((r) => [r.subjectWallet, r._count._all]));
  const defMap = new Map(defaults.map((r) => [r.subjectWallet, r._count._all]));

  return [...byWallet.entries()]
    .map(([wallet, info]) => {
      const t = timedMap.get(wallet) ?? 0;
      const ot = onTimeMap.get(wallet) ?? 0;
      return {
        wallet,
        pools: info.pools.size,
        level: info.level,
        timedContributions: t,
        onTime: ot,
        onTimeRateBps: t > 0 ? Math.round((ot / t) * 10_000) : null,
        defaults: defMap.get(wallet) ?? 0,
      };
    })
    .sort((a, b) => b.defaults - a.defaults || a.wallet.localeCompare(b.wallet));
}

// ─── User profile: across-pool behavioral view (derived · experimental) ────

export interface UserBehavioral {
  timedContributions: number;
  onTime: number;
  late: number;
  graceUsed: number;
  onTimeRateBps: number | null;
  avgDelaySecondsLate: number | null;
  defaults: number;
  /**
   * Recovery (experimental heuristic, ADR 0009): an on-time-or-grace
   * contribution that landed AFTER the wallet's first setback (a
   * past-grace late contribution or a default). Boolean, not a score.
   */
  hadSetback: boolean;
  recovered: boolean;
}

export interface UserTimelineEntry extends TimelineEntry {
  poolPda: string;
}

export interface UserProfile {
  wallet: string;
  firstEventUnix: number | null;
  pools: { total: number; active: number; completed: number };
  /** Chain-truth counters summed across memberships (Member account, via
   *  backfill) — cross-check against the events-derived `behavioral`. */
  chainCounters: {
    onTimeCount: number;
    lateCount: number;
    contributionsPaid: number;
    defaultedMemberships: number;
  };
  behavioral: UserBehavioral;
  timeline: UserTimelineEntry[];
}

export async function getUserProfile(
  prisma: PrismaClient,
  wallet: string,
): Promise<UserProfile | null> {
  const [members, events] = await Promise.all([
    prisma.member.findMany({
      where: { wallet },
      include: { pool: { select: { status: true } } },
    }),
    prisma.event.findMany({
      where: { subjectWallet: wallet },
      orderBy: [{ onChainTs: "asc" }],
    }),
  ]);
  if (members.length === 0 && events.length === 0) return null;

  const active = members.filter((m) => m.pool?.status === "Active").length;
  const completed = members.filter((m) => m.pool?.status === "Completed").length;

  const chainCounters = members.reduce(
    (acc, m) => ({
      onTimeCount: acc.onTimeCount + m.onTimeCount,
      lateCount: acc.lateCount + m.lateCount,
      contributionsPaid: acc.contributionsPaid + m.contributionsPaid,
      defaultedMemberships: acc.defaultedMemberships + (m.defaulted ? 1 : 0),
    }),
    { onTimeCount: 0, lateCount: 0, contributionsPaid: 0, defaultedMemberships: 0 },
  );

  // Behavioral aggregates from the projected events (behavioral.ts timing).
  const contribTimed = events.filter((e) => e.eventType === "Contribute" && e.dueTs != null);
  const onTime = contribTimed.filter((e) => (e.deltaSeconds ?? 0) <= 0).length;
  const lateRows = contribTimed.filter((e) => (e.deltaSeconds ?? 0) > 0);
  const graceUsed = events.filter((e) => e.eventType === "Contribute" && e.graceUsed).length;
  const defaults = events.filter((e) => e.eventType === "Default").length;
  const avgDelaySecondsLate =
    lateRows.length > 0
      ? Math.round(lateRows.reduce((s, e) => s + (e.deltaSeconds ?? 0), 0) / lateRows.length)
      : null;

  // Recovery (experimental): on-time/grace contribution after a setback.
  const setbackTimes = events
    .filter(
      (e) =>
        e.eventType === "Default" ||
        (e.eventType === "Contribute" && (e.deltaSeconds ?? 0) > 0 && !e.graceUsed),
    )
    .map((e) => Number(e.onChainTs));
  const hadSetback = setbackTimes.length > 0;
  const firstSetback = hadSetback ? Math.min(...setbackTimes) : Infinity;
  const recovered =
    hadSetback &&
    events.some(
      (e) =>
        e.eventType === "Contribute" &&
        ((e.deltaSeconds ?? 1) <= 0 || e.graceUsed) &&
        Number(e.onChainTs) > firstSetback,
    );

  return {
    wallet,
    firstEventUnix: events.length > 0 ? Number(events[0]!.onChainTs) : null,
    pools: { total: members.length, active, completed },
    chainCounters,
    behavioral: {
      timedContributions: contribTimed.length,
      onTime,
      late: lateRows.length,
      graceUsed,
      onTimeRateBps:
        contribTimed.length > 0 ? Math.round((onTime / contribTimed.length) * 10_000) : null,
      avgDelaySecondsLate,
      defaults,
      hadSetback,
      recovered,
    },
    timeline: events.map((e) => ({
      txSig: e.txSig,
      eventType: e.eventType,
      subjectWallet: e.subjectWallet,
      poolPda: e.poolPda,
      cycle: e.cycle,
      slotIndex: e.slotIndex,
      onChainTsUnix: Number(e.onChainTs),
      dueTsUnix: e.dueTs != null ? Number(e.dueTs) : null,
      deltaSeconds: e.deltaSeconds,
      graceUsed: e.graceUsed,
      defaultReason: e.defaultReason,
      defaultReasonProvenance: e.defaultReasonProvenance,
    })),
  };
}

// ─── Events: filterable "black-box recorder" + export (ADR 0009) ───────────
//
// The single normalized `events` table is the queryable/exportable record.
// Filters are exact (pool, wallet, type) + a behavioral timing facet +
// a time window. The SAME filter drives the paginated table and the export,
// so the export reproduces exactly what the operator saw.

export interface EventFilter {
  poolPda?: string;
  subjectWallet?: string;
  eventType?: "Contribute" | "Claim" | "Default";
  /** Behavioral facet (Contribute only; forces eventType=Contribute). */
  timing?: "on_time" | "grace" | "late";
  /** Inclusive on_chain_ts window, unix seconds. */
  fromUnix?: number;
  toUnix?: number;
}

export interface EventRow {
  txSig: string;
  eventType: string;
  subjectWallet: string;
  poolPda: string;
  cycle: number;
  slotIndex: number;
  slotNumber: string;
  onChainTsUnix: number;
  dueTsUnix: number | null;
  deltaSeconds: number | null;
  graceUsed: boolean;
  defaultReason: string | null;
  defaultReasonProvenance: string | null;
}

function buildEventWhere(f: EventFilter): Prisma.EventWhereInput {
  const where: Prisma.EventWhereInput = {};
  if (f.poolPda) where.poolPda = f.poolPda;
  if (f.subjectWallet) where.subjectWallet = f.subjectWallet;
  if (f.eventType) where.eventType = f.eventType;
  if (f.fromUnix != null || f.toUnix != null) {
    const ts: Prisma.BigIntFilter = {};
    if (f.fromUnix != null) ts.gte = BigInt(f.fromUnix);
    if (f.toUnix != null) ts.lte = BigInt(f.toUnix);
    where.onChainTs = ts;
  }
  if (f.timing) {
    where.eventType = "Contribute"; // timing only applies to contributions
    if (f.timing === "on_time") where.deltaSeconds = { lte: 0 };
    else if (f.timing === "grace") where.graceUsed = true;
    else if (f.timing === "late") {
      where.graceUsed = false;
      where.deltaSeconds = { gt: 0 };
    }
  }
  return where;
}

type RawEventRow = {
  txSig: string;
  eventType: string;
  subjectWallet: string;
  poolPda: string;
  cycle: number;
  slotIndex: number;
  slotNumber: bigint;
  onChainTs: bigint;
  dueTs: bigint | null;
  deltaSeconds: number | null;
  graceUsed: boolean;
  defaultReason: string | null;
  defaultReasonProvenance: string | null;
};

function mapEventRow(e: RawEventRow): EventRow {
  return {
    txSig: e.txSig,
    eventType: e.eventType,
    subjectWallet: e.subjectWallet,
    poolPda: e.poolPda,
    cycle: e.cycle,
    slotIndex: e.slotIndex,
    slotNumber: e.slotNumber.toString(),
    onChainTsUnix: Number(e.onChainTs),
    dueTsUnix: e.dueTs != null ? Number(e.dueTs) : null,
    deltaSeconds: e.deltaSeconds,
    graceUsed: e.graceUsed,
    defaultReason: e.defaultReason,
    defaultReasonProvenance: e.defaultReasonProvenance,
  };
}

export interface EventQueryResult {
  rows: EventRow[];
  total: number;
  limit: number;
  offset: number;
}

/** Paginated, filtered events for the recorder table (newest first). */
export async function queryEvents(
  prisma: PrismaClient,
  filter: EventFilter,
  opts: { limit?: number; offset?: number },
): Promise<EventQueryResult> {
  const where = buildEventWhere(filter);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const [total, rows] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      orderBy: [{ onChainTs: "desc" }, { txSig: "asc" }],
      take: limit,
      skip: offset,
    }),
  ]);
  return { rows: rows.map(mapEventRow), total, limit, offset };
}

/** All matching rows (chronological), capped — the export payload. */
export async function exportEventRows(
  prisma: PrismaClient,
  filter: EventFilter,
  cap = 50_000,
): Promise<EventRow[]> {
  const rows = await prisma.event.findMany({
    where: buildEventWhere(filter),
    orderBy: [{ onChainTs: "asc" }, { txSig: "asc" }],
    take: cap,
  });
  return rows.map(mapEventRow);
}

const CSV_COLUMNS: (keyof EventRow)[] = [
  "onChainTsUnix",
  "eventType",
  "subjectWallet",
  "poolPda",
  "cycle",
  "slotIndex",
  "slotNumber",
  "dueTsUnix",
  "deltaSeconds",
  "graceUsed",
  "defaultReason",
  "defaultReasonProvenance",
  "txSig",
];

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function eventsToCsv(rows: EventRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(","));
  return [header, ...lines].join("\n");
}

/** Record an export in the append-only audit trail (who/when/filter/count). */
export async function recordExportAudit(
  prisma: PrismaClient,
  args: { actor: string; format: "csv" | "json"; filter: EventFilter; rowCount: number },
): Promise<void> {
  await prisma.exportAudit.create({
    data: {
      actor: args.actor,
      format: args.format,
      filter: args.filter as Prisma.InputJsonValue,
      rowCount: args.rowCount,
    },
  });
}

// ─── Economy: protocol-wide financial + risk + moat aggregates (ADR 0009) ──
//
// INSTRUMENTATION, NOT TRACTION. On devnet these are test/seed numbers — the
// SAME panel measures mainnet once traffic arrives. Everything here is a
// direct sum / count / percentage from the indexer (pools + members + the
// typed event tables); correlation/cohort analysis is INSIGHTS (deferred
// until real volume). Filters re-scope the natural domain of each block.

export interface EconomyFilter {
  status?: "Forming" | "Active" | "Completed" | "Liquidated" | "Closed";
  level?: 1 | 2 | 3;
  fromUnix?: number;
  toUnix?: number;
}

export interface Economy {
  capital: {
    /** Σ pool.credit_amount — credit committed across pools (capability). */
    committedCredit: string;
    /** Σ buffers held in vaults (solidarity + escrow + guarantee) per indexer. */
    custodied: string;
    contributed: string;
    paidOut: string;
    /** Σ pool.yield_accrued — mock-adapter on devnet; real Kamino on mainnet. */
    yieldAccrued: string;
    /** Σ pool.total_protocol_fee_accrued → treasury. */
    protocolFees: string;
    guaranteeFund: string;
    solidarity: string;
  };
  risk: {
    totalMembers: number;
    defaultedMembers: number;
    defaultRateBps: number | null;
    /** Σ collateral SEIZED by settle_default (coverage, NOT protocol loss). */
    seizedTotal: string;
    seizedSolidarity: string;
    seizedEscrow: string;
    seizedStake: string;
    defaultEvents: number;
    defaultsByPool: { poolPda: string; defaulted: number }[];
  };
  moat: {
    /** Distinct-wallet count by on-chain level snapshot (via backfill). */
    levelDistribution: { l1: number; l2: number; l3: number };
    distinctWallets: number;
    onTime: number;
    timedContributions: number;
    onTimeRateBps: number | null;
    /** Wallets in 2+ pools + retention share. */
    repeatWallets: number;
    retentionBps: number | null;
  };
  health: {
    byStatus: Record<string, number>;
    totalPools: number;
    completionRateBps: number | null;
  };
  indexer: IndexerHealth;
}

function sumBig(rows: bigint[]): bigint {
  return rows.reduce((a, b) => a + b, 0n);
}

export async function getEconomy(
  prisma: PrismaClient,
  filter: EconomyFilter = {},
): Promise<Economy> {
  const [pools, members, indexer] = await Promise.all([
    prisma.pool.findMany(),
    prisma.member.findMany({
      select: { wallet: true, poolId: true, reputationLevel: true, defaulted: true },
    }),
    computeIndexerHealth(prisma),
  ]);

  // ── Capital (scoped by pool status when filtered) ──
  const capPools = filter.status ? pools.filter((p) => p.status === filter.status) : pools;
  const capital = {
    committedCredit: sumBig(capPools.map((p) => p.creditAmount)).toString(),
    custodied: sumBig(
      capPools.map((p) => p.solidarityBalance + p.escrowBalance + p.guaranteeFundBalance),
    ).toString(),
    contributed: sumBig(capPools.map((p) => p.totalContributed)).toString(),
    paidOut: sumBig(capPools.map((p) => p.totalPaidOut)).toString(),
    yieldAccrued: sumBig(capPools.map((p) => p.yieldAccrued)).toString(),
    protocolFees: sumBig(capPools.map((p) => p.totalProtocolFeeAccrued)).toString(),
    guaranteeFund: sumBig(capPools.map((p) => p.guaranteeFundBalance)).toString(),
    solidarity: sumBig(capPools.map((p) => p.solidarityBalance)).toString(),
  };

  // ── Risk (members scoped by level; seizures scoped by time window) ──
  const riskMembers = filter.level
    ? members.filter((m) => m.reputationLevel === filter.level)
    : members;
  const defaultedMembers = riskMembers.filter((m) => m.defaulted).length;
  const tsWindow: Prisma.BigIntFilter = {};
  if (filter.fromUnix != null) tsWindow.gte = BigInt(filter.fromUnix);
  if (filter.toUnix != null) tsWindow.lte = BigInt(filter.toUnix);
  const seizeWhere: Prisma.DefaultEventWhereInput = { resolvedAt: { not: null } };
  if (filter.fromUnix != null || filter.toUnix != null) seizeWhere.blockTime = tsWindow;
  const [seize, defaultEventsCount, defaultsByPoolRows] = await Promise.all([
    prisma.defaultEvent.aggregate({
      where: seizeWhere,
      _sum: { seizedSolidarity: true, seizedEscrow: true, seizedStake: true },
    }),
    prisma.defaultEvent.count({ where: seizeWhere }),
    prisma.event.groupBy({
      by: ["poolPda"],
      where: { eventType: "Default" },
      _count: { _all: true },
    }),
  ]);
  const seizedSol = seize._sum.seizedSolidarity ?? 0n;
  const seizedEsc = seize._sum.seizedEscrow ?? 0n;
  const seizedStk = seize._sum.seizedStake ?? 0n;
  const risk = {
    totalMembers: riskMembers.length,
    defaultedMembers,
    defaultRateBps:
      riskMembers.length > 0 ? Math.round((defaultedMembers / riskMembers.length) * 10_000) : null,
    seizedTotal: (seizedSol + seizedEsc + seizedStk).toString(),
    seizedSolidarity: seizedSol.toString(),
    seizedEscrow: seizedEsc.toString(),
    seizedStake: seizedStk.toString(),
    defaultEvents: defaultEventsCount,
    defaultsByPool: defaultsByPoolRows.map((r) => ({
      poolPda: r.poolPda,
      defaulted: r._count._all,
    })),
  };

  // ── Moat (protocol-wide distribution; on-time scoped by window) ──
  const walletMaxLevel = new Map<string, number>();
  const walletPools = new Map<string, Set<string>>();
  for (const m of members) {
    walletMaxLevel.set(m.wallet, Math.max(walletMaxLevel.get(m.wallet) ?? 0, m.reputationLevel));
    const set = walletPools.get(m.wallet) ?? new Set<string>();
    set.add(m.poolId);
    walletPools.set(m.wallet, set);
  }
  const dist = { l1: 0, l2: 0, l3: 0 };
  for (const lv of walletMaxLevel.values()) {
    if (lv >= 3) dist.l3 += 1;
    else if (lv === 2) dist.l2 += 1;
    else dist.l1 += 1;
  }
  const distinctWallets = walletMaxLevel.size;
  const repeatWallets = [...walletPools.values()].filter((s) => s.size >= 2).length;
  const contribTimedWhere: Prisma.EventWhereInput = {
    eventType: "Contribute",
    dueTs: { not: null },
  };
  if (filter.fromUnix != null || filter.toUnix != null) contribTimedWhere.onChainTs = tsWindow;
  const [timed, onTime] = await Promise.all([
    prisma.event.count({ where: contribTimedWhere }),
    prisma.event.count({ where: { ...contribTimedWhere, deltaSeconds: { lte: 0 } } }),
  ]);
  const moat = {
    levelDistribution: dist,
    distinctWallets,
    onTime,
    timedContributions: timed,
    onTimeRateBps: timed > 0 ? Math.round((onTime / timed) * 10_000) : null,
    repeatWallets,
    retentionBps:
      distinctWallets > 0 ? Math.round((repeatWallets / distinctWallets) * 10_000) : null,
  };

  // ── Health (status breakdown over ALL pools) ──
  const byStatus: Record<string, number> = {
    Forming: 0,
    Active: 0,
    Completed: 0,
    Liquidated: 0,
    Closed: 0,
  };
  for (const p of pools) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  const health = {
    byStatus,
    totalPools: pools.length,
    completionRateBps:
      pools.length > 0 ? Math.round((byStatus.Completed! / pools.length) * 10_000) : null,
  };

  return { capital, risk, moat, health, indexer };
}

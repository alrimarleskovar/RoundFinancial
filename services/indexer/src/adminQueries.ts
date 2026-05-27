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

import type { PrismaClient } from "@prisma/client";

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

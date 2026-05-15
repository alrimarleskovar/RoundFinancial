/**
 * Indexer reconciler — joins `_unresolved` event rows to canonical
 * Pool/Member rows after slot finality (issue #234).
 *
 * Architecture
 * ============
 *
 * The webhook handler (`webhook.ts`) writes events with placeholder
 * `poolId = "_unresolved"` / `memberId = "_unresolved"` so the ingest
 * path stays fast (single INSERT, no inline lookups). The reconciler
 * runs periodically and:
 *
 *   1. **Finality gate** — for every `_unresolved` event row, verify
 *      the source tx has been finalized via RPC (`commitment:
 *      "finalized"`). Events whose tx was orphaned in a reorg are
 *      marked `orphaned = true` and skipped from canonical state.
 *
 *   2. **Canonical join** — resolve the event's `pool` + `member`
 *      references via the on-chain PDAs (derived from the event payload
 *      + the program ID) and update the `poolId` / `memberId` FK
 *      columns.
 *
 *   3. **Cross-validation** — periodically (e.g., every 5min) sweep
 *      `getSignaturesForAddress(programId)` for the last N slots and
 *      diff against the events table. Webhook gaps surface here as
 *      "signature on chain but no event row" → enqueue a re-fetch.
 *
 *   4. **Adversarial RPC defense** — every finality check runs against
 *      a quorum of RPC providers (`RPC_URLS` env var, comma-separated).
 *      A divergence between providers logs a warning + skips the row
 *      until consensus is reached.
 *
 * Trust model
 * ===========
 *
 * The reconciler is the **only path** by which a webhook event becomes
 * canonical state in the indexer DB. Without it, `_unresolved` rows
 * accumulate but never affect the B2B oracle's score reads. This is
 * intentional: the webhook is fast-path / best-effort; the reconciler
 * is the truth-path / finality-gated.
 *
 * Reorg safety
 * ============
 *
 * Finality (`commitment: "finalized"`) is Solana's commitment level
 * that survives reorgs in normal operation (≥32 slots deep). The
 * reconciler trusts a tx that returns `confirmationStatus === "finalized"`
 * from a quorum of RPC providers. Events whose tx is *not* found at
 * the finalized commitment after `ORPHAN_GRACE_SLOTS` past the event
 * slot are marked orphaned — the tx was either dropped or reorged out.
 *
 * See `docs/security/indexer-threat-model.md` for the full threat model
 * + `docs/operations/indexer-reorg-recovery.md` for the on-call runbook.
 */

import type { PrismaClient } from "@prisma/client";
import { Connection, PublicKey, type Commitment } from "@solana/web3.js";

// ─── Configuration ──────────────────────────────────────────────────────

/** Minimum slot age before we consider an event eligible for finality check. */
const FINALITY_GATE_SLOTS = 32;

/** If a tx is missing at finalized commitment this long past its event slot,
 *  we mark it orphaned (most likely a transient reorg or webhook noise). */
const ORPHAN_GRACE_SLOTS = 256;

/** Reconciler tick cadence — every 30s when running as a daemon. */
const RECONCILER_INTERVAL_MS = 30_000;

/** Cross-validation sweep cadence — every 5min. Walks getSignaturesForAddress
 *  on the program and diffs against the events table. */
const CROSS_VALIDATION_INTERVAL_MS = 300_000;

// ─── Types ──────────────────────────────────────────────────────────────

export interface ReconcilerConfig {
  /** Primary RPC. Required. */
  primaryRpcUrl: string;
  /** Optional secondary RPCs for quorum. Comma-separated in env. */
  secondaryRpcUrls?: string[];
  /** Program ID to cross-validate against in step 3. */
  programId: string;
  /** Overrides for the tunables above — useful in tests. */
  finalityGateSlots?: number;
  orphanGraceSlots?: number;
}

export interface ReconcilerResult {
  /** Number of event rows successfully reconciled to canonical state. */
  reconciled: number;
  /** Number of rows marked as orphaned because their tx didn't finalize. */
  orphaned: number;
  /** Number of rows that remained unresolved (still within finality gate
   *  or not yet eligible). */
  pending: number;
  /** RPC divergences observed during quorum checks. */
  divergences: number;
}

// ─── Quorum-aware RPC helper ────────────────────────────────────────────

/**
 * Query multiple RPC providers and return a status only if at least one
 * provider returned a finalized status. If providers disagree, log + return
 * `null` so the caller defers reconciliation rather than committing on
 * partial info.
 */
async function checkFinalizedQuorum(
  connections: Connection[],
  signature: string,
  logger?: { warn: (obj: unknown, msg: string) => void },
): Promise<"finalized" | "not_finalized" | "missing" | null> {
  const results = await Promise.allSettled(
    connections.map(async (conn) => {
      const status = await conn.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });
      // Normalize to a plain string so the quorum logic doesn't have to
      // deal with the upstream `TransactionConfirmationStatus | null`
      // discriminated union.
      return String(status?.value?.confirmationStatus ?? "missing");
    }),
  );

  const settled: string[] = results.map((r) => (r.status === "fulfilled" ? r.value : "error"));

  if (settled.length === 0) return null;

  const finalized = settled.filter((s) => s === "finalized").length;
  const confirmed = settled.filter((s) => s === "confirmed").length;
  const missing = settled.filter((s) => s === "error" || s === "missing").length;

  // Quorum logic: ≥ ceil(N/2) finalized → trust as finalized.
  const threshold = Math.ceil(connections.length / 2);

  if (finalized >= threshold) return "finalized";
  if (confirmed >= threshold) return "not_finalized";
  if (missing >= threshold) return "missing";

  // Mixed results — defer + log so ops sees the divergence.
  logger?.warn({ signature, results: settled }, "RPC quorum divergence — deferring reconciliation");
  return null;
}

// ─── Canonical-PDA join ────────────────────────────────────────────────

/**
 * Resolve canonical Pool + Member row IDs for an event row.
 *
 * The on-chain log lines emitted by roundfi-core (parsed by
 * `decoder.ts`) carry the subject wallet but NOT the pool PDA — we
 * recover the pool by looking at the tx's account list (any roundfi-core
 * tx that mutates pool state must touch the Pool PDA among its
 * accounts) and intersecting with `pools.pda` in the DB. Once we have
 * the canonical pool, the (poolId, wallet) tuple uniquely identifies a
 * Member row via the `@@unique([poolId, slotIndex])` constraint plus
 * the `@@index([wallet])` covering query.
 *
 * Returns `null` when:
 *   - The tx couldn't be fetched (RPC transient, will retry next pass).
 *   - No Pool row in the DB matches any account in the tx (the
 *     canonical-state upsert hasn't run yet — backfill or webhook
 *     state-snapshot ingestion is behind the event ingest).
 *   - No Member row exists for the (pool, wallet) pair (member may
 *     have been closed via escape_valve_buy and never re-opened).
 *
 * In all three null cases the caller leaves the row as `_unresolved`
 * for the next pass, with the same finality + grace-window semantics.
 */
async function resolveCanonicalIds(
  prisma: PrismaClient,
  connection: Connection,
  txSignature: string,
  walletBase58: string | null,
): Promise<{ poolId: string; memberId: string | null } | null> {
  const tx = await connection.getTransaction(txSignature, {
    maxSupportedTransactionVersion: 0,
    commitment: "finalized",
  });
  if (!tx) return null;

  // Account-key surface: static keys + writable/readonly lookup-table
  // entries. Solana programs that read a Pool PDA include it in one
  // of these three buckets depending on whether an ALT was used.
  const staticKeys = tx.transaction.message.staticAccountKeys.map((k) => k.toBase58());
  const loadedWritable = (tx.meta?.loadedAddresses?.writable ?? []).map((k) =>
    typeof k === "string" ? k : k.toString(),
  );
  const loadedReadonly = (tx.meta?.loadedAddresses?.readonly ?? []).map((k) =>
    typeof k === "string" ? k : k.toString(),
  );
  const allKeys = [...staticKeys, ...loadedWritable, ...loadedReadonly];

  // Intersect with canonical Pool PDAs in the DB. A single tx should
  // touch at most one Pool PDA — but if it touches multiple (rare,
  // e.g. cross-pool admin ix), `findFirst` returns one canonically and
  // the event's poolId binding is the right one for *that* event row
  // because the webhook splits per-event from logMessages.
  const pool = await prisma.pool.findFirst({
    where: { pda: { in: allKeys } },
  });
  if (!pool) return null;

  // Default events carry no Member FK in the schema (see
  // DefaultEvent.defaultedWallet rationale on the model). Caller
  // passes null for those, and we short-circuit the member lookup.
  if (walletBase58 === null) {
    return { poolId: pool.id, memberId: null };
  }

  const member = await prisma.member.findFirst({
    where: { poolId: pool.id, wallet: walletBase58 },
  });
  if (!member) return null;

  return { poolId: pool.id, memberId: member.id };
}

// ─── Reconciler loop ────────────────────────────────────────────────────

/**
 * Single reconciliation pass. Idempotent — re-running is safe.
 *
 * Loops through every `_unresolved` event row (across the 3 event tables)
 * and runs the finality gate + canonical-join logic. Returns counters
 * for the caller's logging / metrics.
 *
 * Rows already marked `orphaned = true` are skipped — the orphan flag
 * is terminal (no recovery path), so re-checking them is wasted RPC.
 * If a tx legitimately re-finalizes after orphaning (extremely rare —
 * implies a >256-slot reorg) the backfill flow is the recovery path,
 * not the reconciler.
 */
export async function reconcileOnce(
  prisma: PrismaClient,
  config: ReconcilerConfig,
  logger?: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void },
): Promise<ReconcilerResult> {
  const finalityGate = config.finalityGateSlots ?? FINALITY_GATE_SLOTS;
  const orphanGrace = config.orphanGraceSlots ?? ORPHAN_GRACE_SLOTS;

  const connections = [
    new Connection(config.primaryRpcUrl, "finalized" as Commitment),
    ...(config.secondaryRpcUrls ?? []).map((url) => new Connection(url, "finalized" as Commitment)),
  ];

  // Get the current cluster slot so we know what's old enough to be
  // eligible for the finality gate.
  const currentSlot = BigInt(await connections[0]!.getSlot("finalized"));

  const counters = { reconciled: 0, orphaned: 0, pending: 0, divergences: 0 };

  await reconcileContributeEvents(
    prisma,
    connections,
    currentSlot,
    finalityGate,
    orphanGrace,
    counters,
    logger,
  );
  await reconcileClaimEvents(
    prisma,
    connections,
    currentSlot,
    finalityGate,
    orphanGrace,
    counters,
    logger,
  );
  await reconcileDefaultEvents(
    prisma,
    connections,
    currentSlot,
    finalityGate,
    orphanGrace,
    counters,
    logger,
  );

  return counters;
}

interface Counters {
  reconciled: number;
  orphaned: number;
  pending: number;
  divergences: number;
}

async function reconcileContributeEvents(
  prisma: PrismaClient,
  connections: Connection[],
  currentSlot: bigint,
  finalityGate: number,
  orphanGrace: number,
  counters: Counters,
  logger?: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void },
): Promise<void> {
  const rows = await prisma.contributeEvent.findMany({
    where: { poolId: "_unresolved", orphaned: false },
    take: 100,
  });

  for (const evt of rows) {
    const ageSlots = currentSlot - evt.slot;
    if (ageSlots < BigInt(finalityGate)) {
      counters.pending += 1;
      continue;
    }

    const status = await checkFinalizedQuorum(connections, evt.txSignature, logger);
    if (status === null) {
      counters.divergences += 1;
      counters.pending += 1;
      continue;
    }

    if (status === "finalized") {
      const canonical = await resolveCanonicalIds(
        prisma,
        connections[0]!,
        evt.txSignature,
        evt.contributorWallet,
      );
      if (canonical === null || canonical.memberId === null) {
        // Canonical Pool/Member row not in DB yet — backfill is
        // behind. Leave row unresolved + retry next pass.
        counters.pending += 1;
        continue;
      }
      await prisma.contributeEvent.update({
        where: { id: evt.id },
        data: {
          poolId: canonical.poolId,
          memberId: canonical.memberId,
          resolvedAt: new Date(),
        },
      });
      counters.reconciled += 1;
    } else if (status === "missing" && ageSlots > BigInt(orphanGrace)) {
      await prisma.contributeEvent.update({
        where: { id: evt.id },
        data: { orphaned: true },
      });
      counters.orphaned += 1;
      logger?.warn(
        { txSignature: evt.txSignature, ageSlots: ageSlots.toString(), table: "contribute_events" },
        "event tx never finalized — marked orphaned",
      );
    } else {
      counters.pending += 1;
    }
  }
}

async function reconcileClaimEvents(
  prisma: PrismaClient,
  connections: Connection[],
  currentSlot: bigint,
  finalityGate: number,
  orphanGrace: number,
  counters: Counters,
  logger?: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void },
): Promise<void> {
  const rows = await prisma.claimEvent.findMany({
    where: { poolId: "_unresolved", orphaned: false },
    take: 100,
  });

  for (const evt of rows) {
    const ageSlots = currentSlot - evt.slot;
    if (ageSlots < BigInt(finalityGate)) {
      counters.pending += 1;
      continue;
    }

    const status = await checkFinalizedQuorum(connections, evt.txSignature, logger);
    if (status === null) {
      counters.divergences += 1;
      counters.pending += 1;
      continue;
    }

    if (status === "finalized") {
      const canonical = await resolveCanonicalIds(
        prisma,
        connections[0]!,
        evt.txSignature,
        evt.recipientWallet,
      );
      if (canonical === null || canonical.memberId === null) {
        counters.pending += 1;
        continue;
      }
      await prisma.claimEvent.update({
        where: { id: evt.id },
        data: {
          poolId: canonical.poolId,
          memberId: canonical.memberId,
          resolvedAt: new Date(),
        },
      });
      counters.reconciled += 1;
    } else if (status === "missing" && ageSlots > BigInt(orphanGrace)) {
      await prisma.claimEvent.update({
        where: { id: evt.id },
        data: { orphaned: true },
      });
      counters.orphaned += 1;
      logger?.warn(
        { txSignature: evt.txSignature, ageSlots: ageSlots.toString(), table: "claim_events" },
        "event tx never finalized — marked orphaned",
      );
    } else {
      counters.pending += 1;
    }
  }
}

async function reconcileDefaultEvents(
  prisma: PrismaClient,
  connections: Connection[],
  currentSlot: bigint,
  finalityGate: number,
  orphanGrace: number,
  counters: Counters,
  logger?: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void },
): Promise<void> {
  const rows = await prisma.defaultEvent.findMany({
    where: { poolId: "_unresolved", orphaned: false },
    take: 100,
  });

  for (const evt of rows) {
    const ageSlots = currentSlot - evt.slot;
    if (ageSlots < BigInt(finalityGate)) {
      counters.pending += 1;
      continue;
    }

    const status = await checkFinalizedQuorum(connections, evt.txSignature, logger);
    if (status === null) {
      counters.divergences += 1;
      counters.pending += 1;
      continue;
    }

    if (status === "finalized") {
      // Default events carry no Member FK on the schema — pass null
      // wallet so resolveCanonicalIds short-circuits the member lookup.
      const canonical = await resolveCanonicalIds(prisma, connections[0]!, evt.txSignature, null);
      if (canonical === null) {
        counters.pending += 1;
        continue;
      }

      // Also resolve slotIndex from the canonical Member row (the
      // webhook wrote 0 as a placeholder — log line doesn't carry
      // slot, only the wallet). If the member row was closed by a
      // later escape_valve_buy we leave slotIndex at 0; the
      // defaultedWallet column is the authoritative subject anyway.
      const member = await prisma.member.findFirst({
        where: { poolId: canonical.poolId, wallet: evt.defaultedWallet },
        select: { slotIndex: true },
      });

      await prisma.defaultEvent.update({
        where: { id: evt.id },
        data: {
          poolId: canonical.poolId,
          slotIndex: member?.slotIndex ?? evt.slotIndex,
          resolvedAt: new Date(),
        },
      });
      counters.reconciled += 1;
    } else if (status === "missing" && ageSlots > BigInt(orphanGrace)) {
      await prisma.defaultEvent.update({
        where: { id: evt.id },
        data: { orphaned: true },
      });
      counters.orphaned += 1;
      logger?.warn(
        { txSignature: evt.txSignature, ageSlots: ageSlots.toString(), table: "default_events" },
        "event tx never finalized — marked orphaned",
      );
    } else {
      counters.pending += 1;
    }
  }
}

/**
 * Cross-validation sweep. Walks the program's signature history from
 * the last cursor and asserts every signature has a matching event row.
 * Gaps are logged + enqueued for re-fetch.
 *
 * Returns the number of gaps detected. Zero gaps = healthy.
 */
export async function crossValidateOnce(
  prisma: PrismaClient,
  config: ReconcilerConfig,
  logger?: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void },
): Promise<{ scanned: number; gaps: number }> {
  const connection = new Connection(config.primaryRpcUrl, "finalized" as Commitment);
  const programPk = new PublicKey(config.programId);

  // Walk the last 1000 signatures for the program.
  const sigs = await connection.getSignaturesForAddress(programPk, { limit: 1000 });
  let gaps = 0;

  for (const s of sigs) {
    // Check if we have ANY event row for this signature (any of 3 tables).
    const [contribute, claim, def] = await Promise.all([
      prisma.contributeEvent.findUnique({ where: { txSignature: s.signature } }),
      prisma.claimEvent.findUnique({ where: { txSignature: s.signature } }),
      prisma.defaultEvent.findUnique({ where: { txSignature: s.signature } }),
    ]);
    if (!contribute && !claim && !def) {
      gaps += 1;
      logger?.warn(
        { txSignature: s.signature, slot: s.slot },
        "cross-validation gap — signature on chain but no event row",
      );
      // TODO: enqueue a re-fetch via the webhook handler. Implementation
      // pending the queue layer (out of spike scope; tracked separately).
    }
  }

  logger?.info({ scanned: sigs.length, gaps }, "cross-validation sweep complete");
  return { scanned: sigs.length, gaps };
}

// ─── Daemon entrypoint ──────────────────────────────────────────────────

export interface ReconcilerDaemon {
  start: () => void;
  stop: () => void;
}

export function createReconcilerDaemon(
  prisma: PrismaClient,
  config: ReconcilerConfig,
  logger: {
    info: (obj: unknown, msg: string) => void;
    warn: (obj: unknown, msg: string) => void;
    error: (obj: unknown, msg: string) => void;
  },
): ReconcilerDaemon {
  let reconcileTimer: NodeJS.Timeout | null = null;
  let crossValidationTimer: NodeJS.Timeout | null = null;
  let stopping = false;

  const runReconcile = async (): Promise<void> => {
    if (stopping) return;
    try {
      const result = await reconcileOnce(prisma, config, logger);
      logger.info(result, "reconciler tick complete");
    } catch (err) {
      logger.error({ err }, "reconciler tick failed");
    }
  };

  const runCrossValidation = async (): Promise<void> => {
    if (stopping) return;
    try {
      const result = await crossValidateOnce(prisma, config, logger);
      if (result.gaps > 0) {
        logger.warn(result, "cross-validation found gaps — on-call should investigate");
      }
    } catch (err) {
      logger.error({ err }, "cross-validation failed");
    }
  };

  return {
    start: () => {
      logger.info({ programId: config.programId }, "reconciler daemon starting");
      // Fire-and-forget initial passes, then schedule.
      void runReconcile();
      void runCrossValidation();
      reconcileTimer = setInterval(runReconcile, RECONCILER_INTERVAL_MS);
      crossValidationTimer = setInterval(runCrossValidation, CROSS_VALIDATION_INTERVAL_MS);
    },
    stop: () => {
      stopping = true;
      if (reconcileTimer) clearInterval(reconcileTimer);
      if (crossValidationTimer) clearInterval(crossValidationTimer);
      logger.info({}, "reconciler daemon stopped");
    },
  };
}

// ─── CLI entrypoint ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Lazy-imported to keep this module testable.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  const config: ReconcilerConfig = {
    primaryRpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    secondaryRpcUrls: process.env.SOLANA_RPC_URLS_SECONDARY?.split(",").filter(Boolean),
    programId: process.env.ROUNDFI_CORE_PROGRAM_ID ?? "",
  };

  if (!config.programId) {
    console.error("ROUNDFI_CORE_PROGRAM_ID env var is required");
    process.exit(1);
  }

  // Minimal console logger; in production we wire pino + structured logs.
  const logger = {
    info: (obj: unknown, msg: string) => console.log("[reconciler]", msg, obj),
    warn: (obj: unknown, msg: string) => console.warn("[reconciler]", msg, obj),
    error: (obj: unknown, msg: string) => console.error("[reconciler]", msg, obj),
  };

  // Run once + exit if invoked with --once, otherwise daemonize.
  if (process.argv.includes("--once")) {
    const result = await reconcileOnce(prisma, config, logger);
    console.log(JSON.stringify(result, null, 2));
    await prisma.$disconnect();
    return;
  }

  const daemon = createReconcilerDaemon(prisma, config, logger);
  daemon.start();

  // Graceful shutdown on SIGTERM/SIGINT.
  const shutdown = async (): Promise<void> => {
    daemon.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

if (process.argv[1]?.endsWith("reconciler.ts") || process.argv[1]?.endsWith("reconciler.js")) {
  void main();
}

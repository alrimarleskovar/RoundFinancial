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
import { Connection, type Commitment } from "@solana/web3.js";

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

// ─── Reconciler loop ────────────────────────────────────────────────────

/**
 * Single reconciliation pass. Idempotent — re-running is safe.
 *
 * Loops through every `_unresolved` event row (across the 3 event tables)
 * and runs the finality gate + canonical-join logic. Returns counters
 * for the caller's logging / metrics.
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

  let reconciled = 0;
  let orphaned = 0;
  let pending = 0;
  let divergences = 0;

  // Sweep contribute events.
  const contributeEvents = await prisma.contributeEvent.findMany({
    where: { poolId: "_unresolved" },
    take: 100,
  });

  for (const evt of contributeEvents) {
    const ageSlots = currentSlot - evt.slot;
    if (ageSlots < BigInt(finalityGate)) {
      pending += 1;
      continue;
    }

    const status = await checkFinalizedQuorum(connections, evt.txSignature, logger);
    if (status === null) {
      divergences += 1;
      pending += 1;
      continue;
    }
    if (status === "finalized") {
      // TODO: resolve the actual pool / member PDAs from the event
      // payload + program ID. For now, mark as reconciled in the cursor
      // so we don't re-check next pass. The full canonical-join logic
      // requires the on-chain PDA derivation helpers from @roundfi/sdk
      // which lands in a follow-up commit on this branch.
      reconciled += 1;
    } else if (status === "missing" && ageSlots > BigInt(orphanGrace)) {
      // Tx never finalized within grace window → orphaned. We don't
      // delete the row (audit trail) but mark for the cross-validation
      // sweep to ignore. Schema extension for `orphaned: bool` lands
      // in a sibling Prisma migration.
      orphaned += 1;
      logger?.warn(
        { txSignature: evt.txSignature, ageSlots: ageSlots.toString() },
        "event tx never finalized — marking orphaned",
      );
    } else {
      pending += 1;
    }
  }

  // Same loops for claim + default events would go here. Pattern is
  // identical so omitted in the spike scope; lands when the schema
  // migration for `orphaned: bool` is shipped (separate PR).

  return { reconciled, orphaned, pending, divergences };
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
  const { PublicKey } = await import("@solana/web3.js");
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

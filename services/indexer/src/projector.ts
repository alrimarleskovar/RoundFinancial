/**
 * Event projector — derives the canonical normalized `events` rows from
 * the already-reconciled typed event tables (ADR 0009, FALLBACK shape).
 *
 * Why a projector instead of collapsing the schema
 * =================================================
 * Per ADR 0009 we kept the typed tables (contribute/claim/default) as the
 * ingestion + reconciliation surface and made `events` a deterministic
 * PROJECTION of the resolved typed rows. This leaves the load-bearing
 * `reconciler.ts` finality/orphan/RPC-quorum truth-path (ADR 0005)
 * untouched while still giving the admin a single normalized, exportable
 * query surface. Because every projected column is a pure function of
 * (typed row + pool schedule), `events` carries zero drift and is fully
 * rebuildable from zero (`rebuildEvents`) — never write-once.
 *
 * Behavioral derivation (dueTs / deltaSeconds / graceUsed) uses the ONE
 * shared definition in `@roundfi/sdk` `behavioral.ts` — the same code the
 * app renders, mirroring the on-chain program (ADR 0009 §5). It runs here
 * (post-resolution) because `dueTs` needs `Pool.startedAt`, only known
 * once the reconciler has resolved the row's canonical pool.
 *
 * Eligibility: only RESOLVED, non-orphaned typed rows are projected.
 * Orphaned rows stay in the typed tables for audit but are excluded from
 * this canonical surface (ADR 0005 / 0009).
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { dueTs as computeDueTs, deltaSeconds, usedGrace } from "@roundfi/sdk";

import type { Logger } from "./log.js";

export interface ProjectionResult {
  contribute: number;
  claim: number;
  default: number;
}

/**
 * Convert a bigint-bearing object into a JSON-safe shape (bigints → base-10
 * strings). The `details` JSONB preserves every type-specific field for
 * export/audit without bloating the normalized columns; Prisma's `Json`
 * scalar cannot serialize bigints, so amounts land as decimal strings.
 */
function jsonAmounts(
  obj: Record<string, bigint | number | boolean | string>,
): Prisma.InputJsonValue {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return out;
}

/**
 * Behavioral derivation shared by every event type. `cycle` comes from the
 * on-chain log (the cycle CURRENT at the tx's slot — ADR 0009 backfill
 * care #1), and `dueTs` is the deadline of that cycle. Returns `dueTs =
 * null` while the pool was not yet Active (startedAt null/0).
 */
function deriveSchedule(
  pool: { startedAt: bigint | null; cycleDurationSec: bigint },
  cycle: number,
): bigint | null {
  return computeDueTs(pool.startedAt ?? 0n, pool.cycleDurationSec, cycle);
}

/**
 * Inferred default cause (ADR 0009 amendment 3b). The contract records no
 * reason — `settle_default` only seizes the missed installment — so the
 * trigger is always a missed deadline past grace. Provenance is ALWAYS
 * `Inferred` so the admin never presents it as on-chain fact. Cascade-
 * exhaustion refinements (InsufficientStake / SolvencyGuardTriggered) and
 * the escape-valve path are documented in ADR 0009 and tracked as future
 * refinements; we emit the conservative, correct base case here.
 */
function inferDefaultReason(): {
  defaultReason: "MissedDeadline";
  defaultReasonProvenance: "Inferred";
} {
  return { defaultReason: "MissedDeadline", defaultReasonProvenance: "Inferred" };
}

/**
 * Upsert (idempotent) the projected `events` row for one resolved
 * ContributeEvent. `deltaSeconds` / `graceUsed` are filled only here —
 * payment timing is meaningful for contributions, not payouts/seizures.
 */
async function projectContribute(
  prisma: PrismaClient,
  row: {
    txSignature: string;
    cycle: number;
    slotIndex: number;
    slot: bigint;
    blockTime: bigint;
    resolvedAt: Date | null;
    poolId: string;
    memberId: string;
    schemaId: number;
    onTime: boolean;
    solidarityAmt: bigint;
    escrowAmt: bigint;
    poolFloatAmt: bigint;
  },
  pool: { id: string; pda: string; startedAt: bigint | null; cycleDurationSec: bigint },
  member: { wallet: string },
): Promise<void> {
  const due = deriveSchedule(pool, row.cycle);
  await prisma.event.upsert({
    where: { txSig_eventType: { txSig: row.txSignature, eventType: "Contribute" } },
    create: {
      txSig: row.txSignature,
      eventType: "Contribute",
      subjectWallet: member.wallet,
      poolId: pool.id,
      poolPda: pool.pda,
      memberId: row.memberId,
      cycle: row.cycle,
      slotIndex: row.slotIndex,
      slotNumber: row.slot,
      onChainTs: row.blockTime,
      dueTs: due,
      deltaSeconds: due === null ? null : deltaSeconds(row.blockTime, due),
      graceUsed: due === null ? false : usedGrace(row.blockTime, due),
      details: jsonAmounts({
        schemaId: row.schemaId,
        onTime: row.onTime,
        solidarityAmt: row.solidarityAmt,
        escrowAmt: row.escrowAmt,
        poolFloatAmt: row.poolFloatAmt,
      }),
      resolvedAt: row.resolvedAt,
      builtAt: new Date(),
    },
    update: {
      subjectWallet: member.wallet,
      poolId: pool.id,
      poolPda: pool.pda,
      memberId: row.memberId,
      cycle: row.cycle,
      slotIndex: row.slotIndex,
      slotNumber: row.slot,
      onChainTs: row.blockTime,
      dueTs: due,
      deltaSeconds: due === null ? null : deltaSeconds(row.blockTime, due),
      graceUsed: due === null ? false : usedGrace(row.blockTime, due),
      details: jsonAmounts({
        schemaId: row.schemaId,
        onTime: row.onTime,
        solidarityAmt: row.solidarityAmt,
        escrowAmt: row.escrowAmt,
        poolFloatAmt: row.poolFloatAmt,
      }),
      resolvedAt: row.resolvedAt,
      builtAt: new Date(),
    },
  });
}

async function projectClaim(
  prisma: PrismaClient,
  row: {
    txSignature: string;
    cycle: number;
    slotIndex: number;
    slot: bigint;
    blockTime: bigint;
    resolvedAt: Date | null;
    poolId: string;
    memberId: string;
    amountPaid: bigint;
  },
  pool: { id: string; pda: string; startedAt: bigint | null; cycleDurationSec: bigint },
  member: { wallet: string },
): Promise<void> {
  const due = deriveSchedule(pool, row.cycle);
  const data = {
    subjectWallet: member.wallet,
    poolId: pool.id,
    poolPda: pool.pda,
    memberId: row.memberId,
    cycle: row.cycle,
    slotIndex: row.slotIndex,
    slotNumber: row.slot,
    onChainTs: row.blockTime,
    dueTs: due,
    // No payment timing for a payout.
    deltaSeconds: null,
    graceUsed: false,
    details: jsonAmounts({ amountPaid: row.amountPaid }),
    resolvedAt: row.resolvedAt,
    builtAt: new Date(),
  };
  await prisma.event.upsert({
    where: { txSig_eventType: { txSig: row.txSignature, eventType: "Claim" } },
    create: { txSig: row.txSignature, eventType: "Claim", ...data },
    update: data,
  });
}

async function projectDefault(
  prisma: PrismaClient,
  row: {
    txSignature: string;
    cycle: number;
    slotIndex: number;
    slot: bigint;
    blockTime: bigint;
    resolvedAt: Date | null;
    poolId: string;
    defaultedWallet: string;
    seizedSolidarity: bigint;
    seizedEscrow: bigint;
    seizedStake: bigint;
    dInit: bigint;
    dRem: bigint;
    cInit: bigint;
    cAfter: bigint;
  },
  pool: { id: string; pda: string; startedAt: bigint | null; cycleDurationSec: bigint },
): Promise<void> {
  const due = deriveSchedule(pool, row.cycle);
  const reason = inferDefaultReason();
  const data = {
    subjectWallet: row.defaultedWallet,
    poolId: pool.id,
    poolPda: pool.pda,
    memberId: null,
    cycle: row.cycle,
    slotIndex: row.slotIndex,
    slotNumber: row.slot,
    onChainTs: row.blockTime,
    dueTs: due,
    deltaSeconds: null,
    graceUsed: false,
    defaultReason: reason.defaultReason,
    defaultReasonProvenance: reason.defaultReasonProvenance,
    details: jsonAmounts({
      seizedSolidarity: row.seizedSolidarity,
      seizedEscrow: row.seizedEscrow,
      seizedStake: row.seizedStake,
      dInit: row.dInit,
      dRem: row.dRem,
      cInit: row.cInit,
      cAfter: row.cAfter,
    }),
    resolvedAt: row.resolvedAt,
    builtAt: new Date(),
  };
  await prisma.event.upsert({
    where: { txSig_eventType: { txSig: row.txSignature, eventType: "Default" } },
    create: { txSig: row.txSignature, eventType: "Default", ...data },
    update: data,
  });
}

/**
 * Rebuild the entire `events` table from the resolved typed rows. Proves
 * the table is NOT write-once: running this from zero reconstructs every
 * row with identical derived values (ADR 0009 close-out criterion #4).
 *
 * Truncate-then-project rather than incremental so a rebuild is total +
 * deterministic. On devnet (≈1 pool) this is trivially cheap.
 */
export async function rebuildEvents(
  prisma: PrismaClient,
  logger?: Logger,
): Promise<ProjectionResult> {
  await prisma.event.deleteMany({});

  const result: ProjectionResult = { contribute: 0, claim: 0, default: 0 };

  const contributes = await prisma.contributeEvent.findMany({
    where: { orphaned: false, resolvedAt: { not: null }, poolId: { not: "_unresolved" } },
    include: { pool: true, member: true },
  });
  for (const row of contributes) {
    await projectContribute(prisma, row, row.pool, row.member);
    result.contribute += 1;
  }

  const claims = await prisma.claimEvent.findMany({
    where: { orphaned: false, resolvedAt: { not: null }, poolId: { not: "_unresolved" } },
    include: { pool: true, member: true },
  });
  for (const row of claims) {
    await projectClaim(prisma, row, row.pool, row.member);
    result.claim += 1;
  }

  const defaults = await prisma.defaultEvent.findMany({
    where: { orphaned: false, resolvedAt: { not: null }, poolId: { not: "_unresolved" } },
    include: { pool: true },
  });
  for (const row of defaults) {
    await projectDefault(prisma, row, row.pool);
    result.default += 1;
  }

  logger?.info({ event_type: "projector_rebuild", ...result }, "events projection rebuilt");
  return result;
}

// ─── CLI entrypoint ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const { createLogger } = await import("./log.js");
  const prisma = new PrismaClient();
  const logger = createLogger({ service: "projector" });
  try {
    const result = await rebuildEvents(prisma, logger);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("projector.ts") || process.argv[1]?.endsWith("projector.js")) {
  void main();
}

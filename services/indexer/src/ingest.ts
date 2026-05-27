/**
 * Shared event-ingestion helpers (ADR 0009 follow-up #2). The SAME pipeline
 * is used by two ingress paths so they can never drift:
 *   - the live Helius webhook (`webhook.ts`), and
 *   - the signature-replay backfill (`backfill-events.ts`).
 *
 * Resolve-when-possible, else NULL (ADR 0009 decision B):
 *   - if the canonical Pool (and Member) state is ALREADY in the DB — the
 *     backfill case, since the state backfill runs first — the row is
 *     resolved AT INGEST: real poolId/memberId FK + resolvedAt set, so the
 *     projector picks it up immediately without waiting for the reconciler.
 *   - otherwise — the webhook fast-path, which may fire before the account
 *     state is ingested — poolId/memberId land NULL and the reconciler
 *     resolves them later. NULL is the FK-valid "not yet resolved" marker
 *     (the old "_unresolved" string violated the FK on every insert).
 *
 * Idempotent: every event row is keyed by a UNIQUE `txSignature` and the
 * upsert `update` is a no-op, so re-runs are safe.
 */

import type { PrismaClient } from "@prisma/client";

import type { CoreEvent } from "./decoder.js";

export interface IngestContext {
  txSignature: string;
  slot: bigint;
  blockTime: bigint;
  /**
   * Account pubkeys (base58) from the transaction. Used to resolve the
   * canonical pool at ingest by intersecting with `pools.pda`. Pass the
   * tx's account keys (backfill) for immediate resolution; omit/empty
   * (webhook fast-path) to defer to the reconciler.
   */
  accountKeys?: readonly string[];
}

/** Canonical pool id whose PDA appears in the tx's account list, or null. */
async function resolvePoolId(
  prisma: PrismaClient,
  accountKeys: readonly string[] | undefined,
): Promise<string | null> {
  if (!accountKeys || accountKeys.length === 0) return null;
  const pool = await prisma.pool.findFirst({
    where: { pda: { in: [...accountKeys] } },
    select: { id: true },
  });
  return pool?.id ?? null;
}

async function resolveMemberId(
  prisma: PrismaClient,
  poolId: string,
  slotIndex: number,
): Promise<string | null> {
  const member = await prisma.member.findFirst({
    where: { poolId, slotIndex },
    select: { id: true },
  });
  return member?.id ?? null;
}

/**
 * Upsert the decoded events from one transaction. Returns the number of
 * event rows written (0 if all were duplicates / no recognized events).
 */
export async function upsertEventsFromLogs(
  prisma: PrismaClient,
  ctx: IngestContext,
  events: readonly CoreEvent[],
): Promise<number> {
  const { txSignature, slot, blockTime, accountKeys } = ctx;
  const resolvedPoolId = await resolvePoolId(prisma, accountKeys);
  let written = 0;

  for (const evt of events) {
    if (evt.kind === "contribute") {
      // All-or-nothing resolution (mirrors the reconciler): set the FK only
      // when BOTH pool and member resolve; otherwise leave NULL for the
      // reconciler. A half-resolved row (poolId set, memberId null) would be
      // skipped by the reconciler's `poolId: null` query and get stuck.
      const memberId = resolvedPoolId
        ? await resolveMemberId(prisma, resolvedPoolId, evt.slotIndex)
        : null;
      const resolved = resolvedPoolId !== null && memberId !== null;
      await prisma.contributeEvent.upsert({
        where: { txSignature },
        create: {
          txSignature,
          poolId: resolved ? resolvedPoolId : null,
          memberId: resolved ? memberId : null,
          contributorWallet: null,
          cycle: evt.cycle,
          slotIndex: evt.slotIndex,
          schemaId: evt.onTime ? 1 : 2,
          installment: 0n,
          solidarityAmt: evt.solidarityAmt,
          escrowAmt: evt.escrowAmt,
          poolFloatAmt: evt.poolAmt,
          onTime: evt.onTime,
          blockTime,
          slot,
          resolvedAt: resolved ? new Date() : null,
        },
        update: {},
      });
    } else if (evt.kind === "claim") {
      const memberId = resolvedPoolId
        ? await resolveMemberId(prisma, resolvedPoolId, evt.slotIndex)
        : null;
      const resolved = resolvedPoolId !== null && memberId !== null;
      await prisma.claimEvent.upsert({
        where: { txSignature },
        create: {
          txSignature,
          poolId: resolved ? resolvedPoolId : null,
          memberId: resolved ? memberId : null,
          recipientWallet: null,
          cycle: evt.cycle,
          slotIndex: evt.slotIndex,
          amountPaid: evt.credit,
          blockTime,
          slot,
          resolvedAt: resolved ? new Date() : null,
        },
        update: {},
      });
    } else {
      // DefaultEvent has no Member FK — resolve poolId only. The defaulted
      // wallet is authoritative; slotIndex is refined from the member row
      // (poolId, defaultedWallet) when present (it may have been closed).
      let slotIndex = 0;
      if (resolvedPoolId) {
        const member = await prisma.member.findFirst({
          where: { poolId: resolvedPoolId, wallet: evt.member },
          select: { slotIndex: true },
        });
        slotIndex = member?.slotIndex ?? 0;
      }
      await prisma.defaultEvent.upsert({
        where: { txSignature },
        create: {
          txSignature,
          poolId: resolvedPoolId,
          defaultedWallet: evt.member,
          cycle: evt.cycle,
          slotIndex,
          seizedSolidarity: evt.seizedSolidarity,
          seizedEscrow: evt.seizedEscrow,
          seizedStake: evt.seizedStake,
          dInit: 0n,
          dRem: evt.dRem,
          cInit: evt.cInit,
          cAfter: evt.cAfter,
          blockTime,
          slot,
          resolvedAt: resolvedPoolId !== null ? new Date() : null,
        },
        update: {},
      });
    }
    written += 1;
  }

  return written;
}

/**
 * Advance the indexer cursor to the highest slot processed. The cursor is
 * what `computeIndexerHealth` reads for the lag gauge, so BOTH ingress
 * paths bump it — otherwise (the pre-#2 bug) a state-only backfill left
 * `lastSlot` null and the lag read "unknown". Monotonic: never moves
 * backwards.
 */
export async function bumpCursor(
  prisma: PrismaClient,
  programId: string,
  slot: bigint,
  sig: string,
): Promise<void> {
  const existing = await prisma.indexerCursor.findUnique({ where: { programId } });
  if (existing && existing.lastSlot >= slot) return;
  await prisma.indexerCursor.upsert({
    where: { programId },
    create: { programId, lastSlot: slot, lastSig: sig },
    update: { lastSlot: slot, lastSig: sig },
  });
}

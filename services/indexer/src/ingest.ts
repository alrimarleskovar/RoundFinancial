/**
 * Shared event-ingestion helpers (ADR 0009 follow-up #2). The SAME upsert
 * pipeline is used by two ingress paths so they can never drift:
 *   - the live Helius webhook (`webhook.ts`), and
 *   - the signature-replay backfill (`backfill-events.ts`).
 *
 * Both decode `meta.logMessages` via `decoder.parseLogMessages` and land
 * append-only event rows with `_unresolved` FK placeholders; the
 * reconciler later resolves them to canonical Pool/Member ids and the
 * projector derives the normalized `events` rows. Idempotent: every event
 * row is keyed by a UNIQUE `txSignature`, so re-running is safe.
 */

import type { PrismaClient } from "@prisma/client";

import type { CoreEvent } from "./decoder.js";

export interface IngestContext {
  txSignature: string;
  slot: bigint;
  blockTime: bigint;
}

/**
 * Upsert the decoded events from one transaction. Returns the number of
 * event rows written (0 if all were duplicates / no recognized events).
 * Mirrors the per-kind shape the schema expects; FK + slotIndex resolution
 * is the reconciler's job (rows start `_unresolved`).
 */
export async function upsertEventsFromLogs(
  prisma: PrismaClient,
  ctx: IngestContext,
  events: readonly CoreEvent[],
): Promise<number> {
  const { txSignature, slot, blockTime } = ctx;
  let written = 0;

  for (const evt of events) {
    if (evt.kind === "contribute") {
      await prisma.contributeEvent.upsert({
        where: { txSignature },
        create: {
          txSignature,
          poolId: "_unresolved",
          memberId: "_unresolved",
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
        },
        update: {},
      });
    } else if (evt.kind === "claim") {
      await prisma.claimEvent.upsert({
        where: { txSignature },
        create: {
          txSignature,
          poolId: "_unresolved",
          memberId: "_unresolved",
          recipientWallet: null,
          cycle: evt.cycle,
          slotIndex: evt.slotIndex,
          amountPaid: evt.credit,
          blockTime,
          slot,
        },
        update: {},
      });
    } else {
      await prisma.defaultEvent.upsert({
        where: { txSignature },
        create: {
          txSignature,
          poolId: "_unresolved",
          defaultedWallet: evt.member,
          cycle: evt.cycle,
          slotIndex: 0,
          seizedSolidarity: evt.seizedSolidarity,
          seizedEscrow: evt.seizedEscrow,
          seizedStake: evt.seizedStake,
          dInit: 0n,
          dRem: evt.dRem,
          cInit: evt.cInit,
          cAfter: evt.cAfter,
          blockTime,
          slot,
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
 * paths must bump it — otherwise (the pre-#2 bug) a state-only backfill
 * left `lastSlot` null and the lag read "unknown". Monotonic: never moves
 * the cursor backwards.
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

/**
 * Helius webhook → Postgres event store handler.
 *
 * Per-tx flow:
 *   1. Reject txs with `transactionError` set (re-orgs / failed sends).
 *   2. Parse `meta.logMessages` via decoder.ts → typed events.
 *   3. For each event, upsert the affected Pool/Member rows + insert
 *      an immutable event row.
 *   4. Bump the indexer cursor to the latest seen slot.
 *
 * Idempotence: every event row has `txSignature` UNIQUE — re-runs
 * (Helius retry on 5xx) are safe; the insert no-ops via `skipDuplicates`
 * on the contribute/claim/default tables.
 *
 * What this scaffold does NOT do yet:
 *   - upsert Pool/Member rows from on-chain account state (requires
 *     a follow-up RPC call per affected account; the backfiller does
 *     this; an event-driven equivalent is tracked in issue #234 —
 *     indexer reconciler hardening).
 *   - resolve the `Pool` and `Member` rows for events. The current
 *     impl writes to `unresolved_*` placeholder fields and a periodic
 *     reconciler ties them to canonical rows.
 *
 * For the hackathon scaffold we record the raw event + tx metadata
 * and skip the FK resolution. Phase 3 will tighten this once the
 * service runs against real RPC + DB.
 */

import type { PrismaClient } from "@prisma/client";

import { parseLogMessages } from "./decoder.js";

interface IncomingTx {
  signature: string;
  slot: number;
  timestamp: number | null;
  transactionError?: { error?: unknown } | null;
  meta?: { logMessages?: string[] | null };
}

export interface HandleResult {
  processed: boolean;
  eventCount: number;
  reason?: string;
}

export async function handleHeliusWebhook(
  prisma: PrismaClient,
  tx: IncomingTx,
): Promise<HandleResult> {
  if (tx.transactionError) {
    // Failed txs still emit a `meta.logMessages` array, but we don't
    // index them here — the seed-default flow demonstrates that
    // "EscrowLocked" is durable evidence, but the indexer's job is
    // accepted-state tracking, not failed-tx forensics. A separate
    // failed_tx table can land if/when the API layer wants to expose it.
    return { processed: false, eventCount: 0, reason: "tx_failed" };
  }

  const logs = tx.meta?.logMessages;
  if (!logs || logs.length === 0) {
    return { processed: false, eventCount: 0, reason: "no_logs" };
  }

  const events = parseLogMessages(logs);
  if (events.length === 0) {
    return { processed: false, eventCount: 0, reason: "no_recognized_events" };
  }

  const blockTime = BigInt(tx.timestamp ?? Math.floor(Date.now() / 1000));
  const slot = BigInt(tx.slot);

  // The scaffold writes events with denormalized poolPda/memberWallet
  // strings rather than FK relations. A reconciler joins those to
  // canonical Pool/Member rows in a separate pass — keeps the webhook
  // path fast (single insert per event) and decouples ingestion from
  // the slower upsert path.
  for (const evt of events) {
    if (evt.kind === "contribute") {
      await prisma.contributeEvent.upsert({
        where: { txSignature: tx.signature },
        create: {
          txSignature: tx.signature,
          // Placeholder relations — reconciler fills these. A full
          // implementation would resolve these inline; the scaffold
          // accepts dangling FK targets for write speed.
          poolId: "_unresolved",
          memberId: "_unresolved",
          cycle: evt.cycle,
          schemaId: evt.onTime ? 1 : 2,
          installment: evt.installment,
          solidarityAmt: evt.solidarityAmt,
          escrowAmt: evt.escrowAmt,
          poolFloatAmt: evt.poolFloatAmt,
          onTime: evt.onTime,
          blockTime,
          slot,
        },
        update: {},
      });
    } else if (evt.kind === "claim") {
      await prisma.claimEvent.upsert({
        where: { txSignature: tx.signature },
        create: {
          txSignature: tx.signature,
          poolId: "_unresolved",
          memberId: "_unresolved",
          cycle: evt.cycle,
          slotIndex: evt.slotIndex,
          amountPaid: evt.amount,
          blockTime,
          slot,
        },
        update: {},
      });
    } else {
      await prisma.defaultEvent.upsert({
        where: { txSignature: tx.signature },
        create: {
          txSignature: tx.signature,
          poolId: "_unresolved",
          defaultedWallet: evt.member,
          cycle: evt.cycle,
          // slotIndex resolution: log-line doesn't carry slot; resolved
          // by the reconciler via member→slot lookup (tracked in #234).
          // Placeholder 0 here is intentional and joined to canonical
          // state post-confirmation, never read on the fund-movement path.
          slotIndex: 0,
          seizedSolidarity: evt.seizedSolidarity,
          seizedEscrow: evt.seizedEscrow,
          seizedStake: evt.seizedStake,
          dInit: evt.dInit,
          dRem: evt.dRem,
          cInit: evt.cInit,
          cAfter: evt.cAfter,
          blockTime,
          slot,
        },
        update: {},
      });
    }
  }

  // Bump cursor for the indexer's lag metric.
  await prisma.indexerCursor.upsert({
    where: { programId: process.env.ROUNDFI_CORE_PROGRAM_ID ?? "_default" },
    create: {
      programId: process.env.ROUNDFI_CORE_PROGRAM_ID ?? "_default",
      lastSlot: slot,
      lastSig: tx.signature,
    },
    update: {
      lastSlot: slot,
      lastSig: tx.signature,
    },
  });

  return { processed: true, eventCount: events.length };
}

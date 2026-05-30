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
import { bumpCursor, upsertEventsFromLogs } from "./ingest.js";

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

  // Shared ingestion pipeline (ADR 0009 #2) — identical to the
  // signature-replay backfill so the two ingress paths can't drift. Writes
  // append-only rows with `_unresolved` FK placeholders; the reconciler
  // resolves them and the projector derives the normalized `events` rows.
  await upsertEventsFromLogs(prisma, { txSignature: tx.signature, slot, blockTime }, events);
  await bumpCursor(prisma, process.env.ROUNDFI_CORE_PROGRAM_ID ?? "_default", slot, tx.signature);

  return { processed: true, eventCount: events.length };
}

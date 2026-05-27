/**
 * Event backfill via signature replay (ADR 0009 follow-up #2). Hydrates the
 * event tables from history WITHOUT Helius: walks the core program's
 * signatures, re-fetches each tx, and runs the SAME decode + upsert
 * pipeline the webhook uses (`ingest.upsertEventsFromLogs`). This is what
 * unblocks the on-devnet exact-value smoke (ADR 0009 #5) — once events have
 * real rows, `project-events` fills due_ts/delta/grace via behavioral.ts.
 *
 * The state backfill (`backfill.ts`, getProgramAccounts) gives current
 * Pool/Member state; THIS gives the event log. Run both on first hydrate.
 *
 * Usage:
 *   ROUNDFI_CORE_PROGRAM_ID=<core> SOLANA_RPC_URL=<rpc> DATABASE_URL=<pg> \
 *   pnpm --filter @roundfi/indexer backfill:events
 *
 * Idempotent: event rows are keyed by UNIQUE txSignature, so re-runs are
 * safe. Public devnet rate-limits (429) — getTransaction calls are spaced +
 * retried with exponential backoff; point SOLANA_RPC_URL at a dedicated RPC
 * for large histories.
 */

import { Connection, PublicKey, type ConfirmedSignatureInfo } from "@solana/web3.js";
import { PrismaClient } from "@prisma/client";

import { parseLogMessages } from "./decoder.js";
import { bumpCursor, upsertEventsFromLogs } from "./ingest.js";
import { createLogger } from "./log.js";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const CORE_PROGRAM = process.env.ROUNDFI_CORE_PROGRAM_ID;

/** Page size for getSignaturesForAddress (max 1000). */
const SIG_PAGE = 1000;
/** Hard cap on signatures scanned per run — devnet canary history is small. */
const MAX_SIGNATURES = 10_000;
/** Spacing between getTransaction calls (ms) to be gentle on public RPC. */
const TX_SPACING_MS = 60;
/** Max retries per getTransaction on transient/rate-limit errors. */
const MAX_RETRIES = 4;

const logger = createLogger({ service: "backfill-events" });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function isRateLimit(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|rate.?limit|too many requests/i.test(msg);
}

/** getTransaction with exponential backoff on rate-limit / transient errors. */
async function fetchTxWithRetry(connection: Connection, signature: string) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
    } catch (err) {
      if (attempt === MAX_RETRIES || !isRateLimit(err)) throw err;
      const backoff = 2 ** attempt * 250; // 250ms, 500, 1000, 2000
      logger.warn(
        { event_type: "rpc_backoff", signature, attempt, backoffMs: backoff },
        "getTransaction rate-limited — backing off",
      );
      await sleep(backoff);
    }
  }
  return null;
}

/** Walk the program's full signature history (newest→oldest), paginated. */
async function collectSignatures(
  connection: Connection,
  programId: PublicKey,
): Promise<ConfirmedSignatureInfo[]> {
  const out: ConfirmedSignatureInfo[] = [];
  let before: string | undefined;
  while (out.length < MAX_SIGNATURES) {
    const page = await connection.getSignaturesForAddress(programId, { limit: SIG_PAGE, before });
    if (page.length === 0) break;
    out.push(...page);
    before = page[page.length - 1]!.signature;
    if (page.length < SIG_PAGE) break;
  }
  return out;
}

async function main(): Promise<void> {
  if (!CORE_PROGRAM) {
    logger.error({ event_type: "startup" }, "ROUNDFI_CORE_PROGRAM_ID env var is required");
    process.exit(1);
  }
  const programId = new PublicKey(CORE_PROGRAM);
  const connection = new Connection(RPC, "confirmed");
  const prisma = new PrismaClient();
  const startedAt = Date.now();

  let scanned = 0;
  let withEvents = 0;
  let eventsWritten = 0;
  let failed = 0;
  let maxSlot = 0n;
  let maxSig = "";

  try {
    logger.info(
      { event_type: "backfill_events_start", rpc: RPC, programId: CORE_PROGRAM },
      "start",
    );
    const sigs = await collectSignatures(connection, programId);
    logger.info({ event_type: "backfill_events_sigs", count: sigs.length }, "signatures collected");

    for (const info of sigs) {
      scanned += 1;
      // Skip failed txs — same policy as the webhook (accepted-state only).
      if (info.err) continue;
      let tx;
      try {
        tx = await fetchTxWithRetry(connection, info.signature);
      } catch (err) {
        failed += 1;
        logger.error(
          { event_type: "tx_fetch_failed", signature: info.signature, error: err },
          "getTransaction failed after retries",
        );
        continue;
      }
      await sleep(TX_SPACING_MS);
      const logs = tx?.meta?.logMessages;
      if (!logs || logs.length === 0) continue;

      const events = parseLogMessages(logs);
      if (events.length === 0) continue;

      const slot = BigInt(tx!.slot);
      const blockTime = BigInt(tx!.blockTime ?? Math.floor(Date.now() / 1000));
      const n = await upsertEventsFromLogs(
        prisma,
        { txSignature: info.signature, slot, blockTime },
        events,
      );
      if (n > 0) {
        withEvents += 1;
        eventsWritten += n;
      }
      if (slot > maxSlot) {
        maxSlot = slot;
        maxSig = info.signature;
      }
    }

    // Advance the cursor to the highest slot we processed so the lag gauge
    // reads a real number (ADR 0009 #2 / nit #4).
    if (maxSlot > 0n) await bumpCursor(prisma, CORE_PROGRAM, maxSlot, maxSig);

    logger.info(
      {
        event_type: "backfill_events_complete",
        scanned,
        withEvents,
        eventsWritten,
        failed,
        maxSlot: maxSlot.toString(),
        durationMs: Date.now() - startedAt,
      },
      "backfill events done",
    );
  } catch (err) {
    logger.error({ event_type: "backfill_events_failed", error: err }, "backfill events failed");
    await prisma.$disconnect();
    process.exit(1);
  }
  await prisma.$disconnect();
}

if (
  process.argv[1]?.endsWith("backfill-events.ts") ||
  process.argv[1]?.endsWith("backfill-events.js")
) {
  void main();
}

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

import "dotenv/config";
import { createHash } from "node:crypto";

import { Connection, PublicKey, type ConfirmedSignatureInfo } from "@solana/web3.js";
import { makePrismaClient } from "./db.js";

import { parseLogMessages } from "./decoder.js";
import { bumpCursor, upsertEventsFromLogs } from "./ingest.js";
import { createLogger } from "./log.js";
import {
  decideTxQuorum,
  parseRpcUrls,
  quorumThreshold,
  type ProviderResult,
  type TxFingerprint,
} from "./rpcQuorum.js";

const RPC_FALLBACK = "https://api.devnet.solana.com";
const RPC_URLS = parseRpcUrls({
  rpcUrls: process.env.SOLANA_RPC_URLS,
  rpcUrl: process.env.SOLANA_RPC_URL,
  fallback: RPC_FALLBACK,
});
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

/** Type alias for the `getTransaction` return value — let the toolchain
 *  pick it up so we don't track upstream type changes by hand. */
type GetTransactionResult = Awaited<ReturnType<Connection["getTransaction"]>>;

/** getTransaction with exponential backoff on rate-limit / transient errors. */
async function fetchTxWithRetry(
  connection: Connection,
  signature: string,
): Promise<GetTransactionResult> {
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

/** Fingerprint a tx for quorum equality. The tuple captures what the
 *  ingest path actually reads — `slot`, `blockTime`, and the log
 *  messages — so a mismatch on any of these signals a divergent provider. */
function fingerprintTx(tx: NonNullable<GetTransactionResult>): TxFingerprint {
  const logs = tx.meta?.logMessages ?? [];
  const logsHash = createHash("sha256").update(logs.join("\n")).digest("hex");
  return {
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    logsHash,
  };
}

/**
 * Fetch a tx across the configured RPC quorum (Wave 9.1). Returns the
 * canonical tx when ≥ ceil(N/2) providers agree on its fingerprint,
 * `null` when they agree the tx is not on-chain yet, or `undefined`
 * (divergent — skip this round) otherwise.
 *
 * With N=1 this collapses to the original `fetchTxWithRetry` path with
 * threshold 1, so deployments that haven't opted into the plural URL
 * env see no behavior change.
 */
async function fetchTxWithQuorum(
  connections: readonly Connection[],
  signature: string,
): Promise<
  | { verdict: "ok"; tx: NonNullable<GetTransactionResult> }
  | { verdict: "missing" }
  | { verdict: "skip"; reason: string }
> {
  // Run all providers in parallel; each carries its own retry loop.
  const settled = await Promise.allSettled(connections.map((c) => fetchTxWithRetry(c, signature)));
  const txsRaw: Array<NonNullable<GetTransactionResult>> = [];
  const results: ProviderResult[] = settled.map((r) => {
    if (r.status === "rejected") return { kind: "error" };
    if (r.value === null) return { kind: "null" };
    txsRaw.push(r.value);
    return { kind: "tx", fingerprint: fingerprintTx(r.value) };
  });

  const verdict = decideTxQuorum(results);
  if (verdict.kind === "consensus_null") return { verdict: "missing" };
  if (verdict.kind === "divergence") {
    logger.warn(
      {
        event_type: "rpc_quorum_divergence",
        signature,
        reason: verdict.reason,
        providers: results.length,
      },
      "RPC quorum divergence on getTransaction — skipping this row",
    );
    return { verdict: "skip", reason: verdict.reason };
  }
  // Find a tx whose fingerprint matches the consensus. Any of the
  // tied providers works — they agreed byte-for-byte by definition.
  const fp = verdict.fingerprint;
  const tx = txsRaw.find(
    (t) =>
      t.slot === fp.slot &&
      (t.blockTime ?? null) === fp.blockTime &&
      createHash("sha256")
        .update((t.meta?.logMessages ?? []).join("\n"))
        .digest("hex") === fp.logsHash,
  );
  if (!tx) {
    // Should not happen — we filtered into txsRaw at the same moment we
    // built the fingerprints — but defend so the runtime can't crash.
    return { verdict: "skip", reason: "consensus_fingerprint_not_found" };
  }
  return { verdict: "ok", tx };
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
  // Quorum: build a Connection per configured URL. With one URL this
  // behaves exactly like the previous single-Connection path; with N
  // URLs every getTransaction is fanned out + consensus-checked.
  const connections = RPC_URLS.map((url) => new Connection(url, "confirmed"));
  // The signatures-list call goes against the primary RPC only —
  // disagreement here is fine (we'll re-check each candidate sig
  // individually via getTransaction with quorum, which is where any
  // forged signature would be caught — it has no canonical tx to
  // back it).
  const connection = connections[0]!;
  const prisma = makePrismaClient();
  const startedAt = Date.now();

  let scanned = 0;
  let withEvents = 0;
  let eventsWritten = 0;
  let failed = 0;
  let maxSlot = 0n;
  let maxSig = "";

  try {
    logger.info(
      {
        event_type: "backfill_events_start",
        rpcs: RPC_URLS,
        quorumThreshold: quorumThreshold(RPC_URLS.length),
        programId: CORE_PROGRAM,
      },
      "start",
    );
    const sigs = await collectSignatures(connection, programId);
    logger.info({ event_type: "backfill_events_sigs", count: sigs.length }, "signatures collected");

    let skippedDivergent = 0;
    for (const info of sigs) {
      scanned += 1;
      // Skip failed txs — same policy as the webhook (accepted-state only).
      if (info.err) continue;
      const fetched = await fetchTxWithQuorum(connections, info.signature);
      await sleep(TX_SPACING_MS);
      if (fetched.verdict === "missing") continue;
      if (fetched.verdict === "skip") {
        // Quorum divergence or all-error — log + count, retry next run.
        // We deliberately do NOT count this as `failed` (which connotes
        // a transient RPC error); divergence is its own category so
        // operators can alert on it independently.
        skippedDivergent += 1;
        continue;
      }
      const tx = fetched.tx;
      const logs = tx.meta?.logMessages;
      if (!logs || logs.length === 0) continue;

      const events = parseLogMessages(logs);
      if (events.length === 0) continue;

      const slot = BigInt(tx.slot);
      const blockTime = BigInt(tx.blockTime ?? Math.floor(Date.now() / 1000));
      // Account keys for resolve-at-ingest (the Pool PDA is among them on
      // any core tx). Static keys + ALT-loaded addresses, like the reconciler.
      const msg = tx.transaction.message;
      const accountKeys = [
        ...msg.staticAccountKeys.map((k) => k.toBase58()),
        ...(tx.meta?.loadedAddresses?.writable ?? []).map((k) => k.toString()),
        ...(tx.meta?.loadedAddresses?.readonly ?? []).map((k) => k.toString()),
      ];
      const n = await upsertEventsFromLogs(
        prisma,
        { txSignature: info.signature, slot, blockTime, accountKeys },
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
    // Surface quorum skips at INFO level — non-zero in any healthy run
    // is signal worth investigating (one provider drifted), but doesn't
    // block ingest (we retry next run).
    if (skippedDivergent > 0) {
      logger.warn(
        { event_type: "backfill_events_quorum_skips", count: skippedDivergent },
        "tx rows skipped due to RPC quorum divergence — will retry next run",
      );
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

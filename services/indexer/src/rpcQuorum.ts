/**
 * RPC quorum primitive for the backfill-events path (Wave 9.1 —
 * closes the "single RPC trust" finding from the Wave 9 indexer
 * survey).
 *
 * Why it matters
 * --------------
 * `backfill-events` walks `getSignaturesForAddress` + `getTransaction`
 * against `SOLANA_RPC_URL` and writes the result straight into the
 * canonical `events` table the B2B oracle (Phase 3) will read. A single
 * lying / stale / MITM'd RPC could inject phantom txs or rewrite
 * `slot` / `blockTime` on real ones, poisoning every downstream
 * consumer. The reconciler already has a `checkFinalizedQuorum` for
 * its finality decisions (`reconciler.ts:111`); this module is the
 * symmetric primitive for the ingest-time tx fetch.
 *
 * Trust model
 * -----------
 * Pass M RPC URLs (CSV via `SOLANA_RPC_URLS`, falling back to the
 * legacy single `SOLANA_RPC_URL` so existing deployments need no
 * config change). For each tx signature, fetch from ALL M providers in
 * parallel and ask:
 *
 *   - did ≥ `quorumThreshold(M)` providers return a non-null tx whose
 *     (slot, blockTime, logsHash) tuple matches? → consensus tx, ingest.
 *   - did ≥ `quorumThreshold(M)` providers return null (tx not yet on-
 *     chain)? → consensus "not landed yet", skip until next run.
 *   - anything else? → divergence: log + skip without ingesting. The
 *     next backfill run re-tries with a fresh fetch.
 *
 * Backward compat: with M=1 (the default if only `SOLANA_RPC_URL` is
 * set) `quorumThreshold(1) = 1`, so a single-RPC deployment behaves
 * exactly as before — same fetch path, same retry, same ingest. The
 * quorum activates only when the operator opts in by providing ≥ 2 URLs.
 *
 * This module is PURE about the *decision* layer (`decideTxQuorum`)
 * so the `js` CI lane can unit-test it without a Solana RPC. The
 * I/O wrapper (`fetchTxWithQuorum`) lives in `backfill-events.ts`
 * alongside the existing `fetchTxWithRetry` it replaces.
 */

/**
 * Minimum tx shape we need to fingerprint for consensus. We do NOT
 * compare full tx bodies — that would false-positive on serialization
 * quirks between RPC providers (e.g. account key ordering after
 * address-table loading). The tuple here is what the ingest path
 * actually consumes: slot, blockTime, and the `meta.logMessages`
 * array (joined + hashed to avoid carrying the array around).
 */
export interface TxFingerprint {
  slot: number;
  blockTime: number | null;
  /** Stable hash of `meta.logMessages.join("\n")` — fail-fast on any
   *  per-log byte difference between providers. */
  logsHash: string;
}

/** Per-provider outcome shape the decision layer expects. */
export type ProviderResult =
  /** Provider returned a tx; carry its fingerprint. */
  | { kind: "tx"; fingerprint: TxFingerprint }
  /** Provider returned null (signature not on-chain / unknown). */
  | { kind: "null" }
  /** Provider threw / errored — treated as "no signal", not as "null". */
  | { kind: "error" };

export type QuorumVerdict =
  /** ≥ threshold providers agreed on a non-null tx with the same fingerprint. */
  | { kind: "consensus_tx"; fingerprint: TxFingerprint }
  /** ≥ threshold providers agreed the tx is null (not on-chain yet). */
  | { kind: "consensus_null" }
  /** No consensus — providers disagreed, or too many errored. Skip + log. */
  | { kind: "divergence"; reason: string };

/**
 * Strict-majority quorum threshold: ⌊N/2⌋ + 1.
 *
 * Single source of truth for every site that decides on a quorum of
 * RPC responses (decideTxQuorum here, checkFinalizedQuorum in
 * reconciler.ts, and the start-up telemetry in backfill-events.ts).
 *
 * Why strict majority instead of ⌈N/2⌉
 * ------------------------------------
 * `ceil(N/2)` equals 1 for N=2 — the most common cheap multi-RPC
 * setup. With threshold=1 a single lying / divergent / null-returning
 * provider single-handedly fixes the verdict:
 *   - `[tx-A, tx-B]` (fingerprints diverge) → both buckets have
 *     count=1 ≥ 1, `best` wins by Map insertion order. One divergent
 *     RPC INJECTS its fingerprint without any real agreement.
 *   - `[tx, null]` → `nulls (1) >= threshold (1)` fires first
 *     (decideTxQuorum) or `missing (1) >= threshold (1)` fires
 *     (reconciler), CENSORING a real tx (or, in the reconciler,
 *     deleting a real event from the canonical table).
 *
 * `floor(N/2)+1` gives strict majority for any N, so 1 dishonest
 * provider out of 2 (or 2 out of 4) cannot single-handedly decide a
 * verdict. For odd N it is identical to `ceil(N/2)` (no change). For
 * N=1 it is 1 (back-compat preserved). Edge case N=0 returns 0; the
 * callers all early-return on empty input.
 */
export function quorumThreshold(n: number): number {
  if (n <= 0) return 0;
  return Math.floor(n / 2) + 1;
}

/**
 * Decide whether a set of per-provider results reaches consensus.
 *
 * Threshold is `quorumThreshold(results.length)` — strict majority.
 * Matches the convention used by `reconciler.ts::checkFinalizedQuorum`
 * and the telemetry in `backfill-events.ts`. With N=1 the threshold is
 * 1, so a single provider's outcome IS the verdict — the back-compat
 * path.
 *
 * Errors do NOT count toward any consensus (they are "no signal", not
 * "vote for null"). A run where every provider errors returns
 * `divergence` with `reason: "all_errors"` so the caller skips +
 * retries on the next pass.
 */
export function decideTxQuorum(results: readonly ProviderResult[]): QuorumVerdict {
  if (results.length === 0) {
    return { kind: "divergence", reason: "no_providers" };
  }
  const threshold = quorumThreshold(results.length);
  const errors = results.filter((r) => r.kind === "error").length;
  if (errors === results.length) {
    return { kind: "divergence", reason: "all_errors" };
  }
  const nulls = results.filter((r) => r.kind === "null").length;
  if (nulls >= threshold) {
    return { kind: "consensus_null" };
  }
  // Group tx results by fingerprint identity (slot + blockTime + logsHash).
  const txs = results.filter(
    (r): r is { kind: "tx"; fingerprint: TxFingerprint } => r.kind === "tx",
  );
  const buckets = new Map<string, { fingerprint: TxFingerprint; count: number }>();
  for (const r of txs) {
    const key = `${r.fingerprint.slot}|${r.fingerprint.blockTime ?? "null"}|${r.fingerprint.logsHash}`;
    const existing = buckets.get(key);
    if (existing) existing.count += 1;
    else buckets.set(key, { fingerprint: r.fingerprint, count: 1 });
  }
  // Find the largest agreeing bucket.
  let best: { fingerprint: TxFingerprint; count: number } | null = null;
  for (const b of buckets.values()) {
    if (!best || b.count > best.count) best = b;
  }
  if (best && best.count >= threshold) {
    return { kind: "consensus_tx", fingerprint: best.fingerprint };
  }
  return {
    kind: "divergence",
    reason: `no_quorum (${results.length} providers, threshold ${threshold}; ${txs.length} tx / ${nulls} null / ${errors} error)`,
  };
}

/**
 * Parse the operator-facing CSV env (`SOLANA_RPC_URLS`) into a list of
 * URLs, falling back to the legacy single (`SOLANA_RPC_URL`) when the
 * plural is unset. Empty / whitespace entries are filtered out. The
 * result is the canonical list passed to `fetchTxWithQuorum`.
 */
export function parseRpcUrls(args: {
  rpcUrls?: string | undefined;
  rpcUrl?: string | undefined;
  fallback: string;
}): string[] {
  if (args.rpcUrls) {
    const parsed = args.rpcUrls
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parsed.length > 0) return parsed;
  }
  if (args.rpcUrl && args.rpcUrl.trim().length > 0) return [args.rpcUrl.trim()];
  return [args.fallback];
}

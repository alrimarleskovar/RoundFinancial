/**
 * Sliding-window rate limiter primitives for the admin auth endpoints
 * (RoundFi internal audit follow-up — defense-in-depth for
 * /api/admin/auth/nonce and /api/admin/auth/verify, which previously
 * had no throttle and were exposed to brute-force / DoS).
 *
 * This module is PURE: it owns the windowing algorithm + the client-key
 * extraction, with NO global state and NO storage. The actual store
 * (in-memory vs Postgres-shared) lives in `sharedStore.ts`, which calls
 * `slidingWindowDecision` for both backends so the two share one source
 * of truth for the math. Keeping the algorithm here (prisma-free) lets
 * the `js` CI lane unit-test it without a database.
 *
 * Algorithm
 * ---------
 * Sliding window log: a per-key list of request timestamps. Drop entries
 * older than `windowMs`, check the survivors against `max`, and either
 * record the new timestamp or compute `retryAfterMs` from the oldest
 * live entry. The function is total + deterministic given (timestamps,
 * windowMs, max, now) — the store just supplies the persisted timestamps
 * and writes back the result.
 */

export interface RateLimitVerdict {
  ok: boolean;
  /** Milliseconds until at least one slot frees up. 0 when `ok: true`. */
  retryAfterMs: number;
  /** Number of slots remaining in the current window after this call. */
  remaining: number;
}

export interface SlidingWindowDecision extends RateLimitVerdict {
  /**
   * The timestamps the store should persist for this key after the call.
   * On accept this is `liveEntries ++ [now]`; on reject it is the trimmed
   * `liveEntries` (so the store can prune expired rows even when
   * rejecting). The store writes these back (in-memory: replace the
   * array; Postgres: the DELETE + optional INSERT already reflect it).
   */
  nextTimestamps: number[];
}

/**
 * Pure sliding-window decision. `prevTimestamps` is the key's persisted
 * hit log (any order is tolerated, but callers pass ascending). Returns
 * the verdict plus the timestamps to persist. No I/O, no globals.
 */
export function slidingWindowDecision(
  prevTimestamps: readonly number[],
  windowMs: number,
  max: number,
  now: number,
): SlidingWindowDecision {
  const cutoff = now - windowMs;
  const live = prevTimestamps.filter((t) => t > cutoff).sort((a, b) => a - b);
  if (live.length >= max) {
    const oldest = live[0]!;
    return {
      ok: false,
      retryAfterMs: Math.max(0, oldest + windowMs - now),
      remaining: 0,
      nextTimestamps: live,
    };
  }
  const next = [...live, now];
  return { ok: true, retryAfterMs: 0, remaining: max - next.length, nextTimestamps: next };
}

/**
 * Stable client key from a Next.js `Request`. Prefer the first hop of
 * `X-Forwarded-For` (Vercel + standard reverse proxies), then
 * `X-Real-IP`, else `"unknown"`. Note that `"unknown"` groups every
 * un-proxied client under one bucket — fail-CLOSED for a shared limit.
 *
 * We never trust the LAST hop of X-Forwarded-For: a client can append
 * arbitrary entries before our edge, but the first entry past the edge
 * is what the proxy itself stamped. Vercel documents this behavior at
 * https://vercel.com/docs/edge-network/headers#x-forwarded-for.
 */
export function clientKeyFromRequest(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = req.headers.get("x-real-ip");
  if (xri) {
    const trimmed = xri.trim();
    if (trimmed) return trimmed;
  }
  return "unknown";
}

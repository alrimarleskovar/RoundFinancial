/**
 * In-memory sliding-window rate limiter for the admin auth endpoints
 * (RoundFi internal audit follow-up — defense-in-depth for
 * /api/admin/auth/nonce and /api/admin/auth/verify, which previously
 * had no throttle and were exposed to brute-force / DoS).
 *
 * Trust model + limitations
 * -------------------------
 * The buckets live in `module-scope` — they don't survive process
 * restart and don't sync across instances. This is the SAME limitation
 * that `challenge.ts:usedTokens` already has (the canary runs one
 * instance). Wave 2 of the hardening plan promotes BOTH stores to
 * Postgres-backed in lockstep so they share a transactional source of
 * truth. Until then, this gate stops brute-force from a single client
 * but does NOT stop a distributed attacker hitting multiple instances
 * behind a load balancer — the latter is the multi-instance gap
 * documented in the audit report.
 *
 * Algorithm
 * ---------
 * Sliding window log: a per-key array of request timestamps. On each
 * call we drop entries older than `windowMs`, check the remaining
 * count against `max`, and either record the new timestamp or compute
 * `retryAfterMs` from the oldest live entry. Cleanup is lazy — we only
 * touch a key when a request for it arrives — so an unused key
 * eventually decays to an empty array without a sweeper.
 *
 * O(N) per call where N = max (typically ≤ 10). The simplicity buys
 * deterministic test behavior; a real token-bucket would also work but
 * adds floating-point clock-rate math we don't need at these volumes.
 */

const buckets = new Map<string, number[]>();

export interface RateLimitVerdict {
  ok: boolean;
  /** Milliseconds until at least one slot frees up. 0 when `ok: true`. */
  retryAfterMs: number;
  /** Number of slots remaining in the current window after this call. */
  remaining: number;
}

export interface RateLimitArgs {
  /** Caller-provided composite key (e.g. `"nonce:1.2.3.4"`). */
  key: string;
  windowMs: number;
  max: number;
  /** Optional clock injection — required for deterministic tests. */
  now?: number;
}

export function checkRateLimit(args: RateLimitArgs): RateLimitVerdict {
  const now = args.now ?? Date.now();
  const cutoff = now - args.windowMs;
  const prev = buckets.get(args.key) ?? [];
  // Drop expired entries. Timestamps are append-only and monotonic
  // within a key, so a leading-edge scan is sufficient.
  let i = 0;
  while (i < prev.length && prev[i]! <= cutoff) i += 1;
  const live = i === 0 ? prev.slice() : prev.slice(i);
  if (live.length >= args.max) {
    const oldest = live[0]!;
    const retryAfterMs = Math.max(0, oldest + args.windowMs - now);
    // Store the trimmed log even on rejection so memory stays bounded.
    buckets.set(args.key, live);
    return { ok: false, retryAfterMs, remaining: 0 };
  }
  live.push(now);
  buckets.set(args.key, live);
  return { ok: true, retryAfterMs: 0, remaining: args.max - live.length };
}

/** Test seam — clears all buckets between cases. */
export function __resetRateLimitForTest(): void {
  buckets.clear();
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

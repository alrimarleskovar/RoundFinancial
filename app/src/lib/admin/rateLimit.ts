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

// ─── Unknown-bucket-collapse observer (INFO-1 — Onda 6) ──────────────────
//
// `clientKeyFromRequest` falls back to "unknown" when neither
// X-Forwarded-For nor X-Real-IP is set. That is fail-CLOSED for a SHARED
// rate-limit bucket — but if a production deploy misses the proxy
// configuration (Vercel sets XFF natively, but self-hosted behind a
// misconfigured nginx / K8s ingress / Docker without a forward-proxy
// will not), EVERY caller collapses into "unknown" and they DoS each
// other on the auth endpoints. The 5/min on /verify becomes 5/min for
// the entire fleet of legitimate admins combined.
//
// This is hard to notice from outside (the limiter still "works"). The
// fix is operational visibility: count the share of "unknown" requests,
// and when it crosses a sane threshold in a production-like env, emit a
// loud structured warn that names the misconfiguration so the operator
// sees it in the log stream and fixes the proxy.
//
// The sampling guards keep the warn from spamming: a minimum sample
// floor before the ratio is meaningful, plus a cooldown so we warn at
// most every 5 minutes per process.

interface UnknownBucketHealth {
  totalSamples: number;
  unknownSamples: number;
  lastWarnAtMs: number;
}

const health: UnknownBucketHealth = {
  totalSamples: 0,
  unknownSamples: 0,
  lastWarnAtMs: 0,
};

const MIN_SAMPLES_BEFORE_WARN = 50;
const UNKNOWN_BUCKET_WARN_THRESHOLD = 0.5; // 50%
const WARN_COOLDOWN_MS = 5 * 60_000; // 5 minutes

export interface ObserveClientKeyOptions {
  /** Override Date.now() for deterministic tests. */
  now?: number;
  /**
   * Override env detection. Defaults to NODE_ENV. The observer only
   * warns when this looks production-like — local dev legitimately
   * has no XFF and shouldn't pollute logs.
   */
  env?: string;
  /** Override the logger; defaults to console.warn. */
  logger?: (msg: string, ctx: Record<string, unknown>) => void;
}

function isProductionLikeNodeEnv(env: string | undefined): boolean {
  return env === "production";
}

/**
 * Observe a client key after `clientKeyFromRequest`, count "unknown"
 * vs total, and emit a one-shot warn (rate-limited to once per
 * `WARN_COOLDOWN_MS`) when the share of "unknown" requests crosses
 * `UNKNOWN_BUCKET_WARN_THRESHOLD` in a production-like environment.
 *
 * Cheap: O(1), bounded state (just two counters + a timestamp). Safe
 * to call on every admin request. The logger is injectable so tests
 * can assert what we'd emit without spying on console.
 */
export function observeClientKey(key: string, options?: ObserveClientKeyOptions): void {
  health.totalSamples += 1;
  if (key === "unknown") health.unknownSamples += 1;

  const env = options?.env ?? process.env.NODE_ENV;
  if (!isProductionLikeNodeEnv(env)) return;
  if (health.totalSamples < MIN_SAMPLES_BEFORE_WARN) return;

  const now = options?.now ?? Date.now();
  // Cooldown applies only AFTER the first warn fires. Using `> 0` as the
  // "have we warned at least once" sentinel keeps the first warn from
  // being suppressed by an early `now` (e.g. in deterministic tests
  // where `now` starts at 1_000).
  if (health.lastWarnAtMs > 0 && now - health.lastWarnAtMs < WARN_COOLDOWN_MS) return;

  const ratio = health.unknownSamples / health.totalSamples;
  if (ratio < UNKNOWN_BUCKET_WARN_THRESHOLD) return;

  health.lastWarnAtMs = now;
  const log =
    options?.logger ??
    ((msg: string, ctx: Record<string, unknown>) => {
      // eslint-disable-next-line no-console
      console.warn(msg, ctx);
    });
  log(
    "[admin/rate-limit] Rate-limit bucket collapsed to 'unknown' — your " +
      "reverse proxy is NOT forwarding X-Forwarded-For / X-Real-IP. " +
      "All un-keyed admin requests now share ONE rate-limit bucket, so " +
      "legitimate admins can DoS each other on /api/admin/auth/*.",
    {
      totalSamples: health.totalSamples,
      unknownSamples: health.unknownSamples,
      ratio: Number(ratio.toFixed(3)),
      threshold: UNKNOWN_BUCKET_WARN_THRESHOLD,
      cooldownMs: WARN_COOLDOWN_MS,
    },
  );
}

/** Test seam — zero the counters between cases. */
export function __resetClientKeyHealthForTest(): void {
  health.totalSamples = 0;
  health.unknownSamples = 0;
  health.lastWarnAtMs = 0;
}

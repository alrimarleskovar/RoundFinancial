/**
 * Pluggable shared store for the admin auth side effects — SIWS single-
 * use guard + rate-limit hit log (RoundFi internal audit Wave 2).
 *
 * Why this module exists
 * ----------------------
 * The single-use challenge set and the rate-limit buckets were
 * originally module-scope (in-memory). That is correct for ONE instance
 * but has two gaps the audit flagged:
 *   - it does not survive process restart, and
 *   - it does not sync across instances behind a load balancer.
 * A distributed attacker (or a Vercel scale-up) bypasses an in-memory
 * limit by spreading requests across instances, and a restart re-opens
 * a brief replay window.
 *
 * This module abstracts both side effects behind small async
 * interfaces with two backends:
 *   - `memory` (default): the original behavior — single-instance
 *     correct, no DB, so the `js` CI lane + the single-instance canary
 *     keep working unchanged.
 *   - `postgres`: shared, durable, atomic across instances — selected
 *     by `ADMIN_SHARED_STORE=postgres` (only meaningful where
 *     DATABASE_URL is set, i.e. the same DB the admin console already
 *     reads). The single-use guard uses an insert-or-conflict on the
 *     token PK (no read-modify-write race); the rate limiter runs the
 *     same `slidingWindowDecision` math inside a transaction.
 *
 * Prisma is imported DYNAMICALLY inside the Postgres methods only, so
 * the in-memory path (and the prisma-free `js` test lane) never needs
 * `@roundfi/indexer/db` to resolve or a DB to connect.
 */

import { slidingWindowDecision, type RateLimitVerdict } from "./rateLimit.js";

// ─── Interfaces ──────────────────────────────────────────────────────────

export interface ChallengeStore {
  /**
   * Atomically consume a challenge token. Returns `true` on FIRST use
   * (caller may proceed), `false` if it was already consumed (replay).
   * `expiresAtMs` is the absolute UNIX-ms time after which the row may
   * be swept (issuedAt + CHALLENGE_TTL_MS).
   */
  consume(token: string, expiresAtMs: number): Promise<boolean>;
}

export interface RateLimitStore {
  check(args: {
    key: string;
    windowMs: number;
    max: number;
    now?: number;
  }): Promise<RateLimitVerdict>;
}

// ─── In-memory backend (default) ─────────────────────────────────────────

const usedTokens = new Set<string>();
const buckets = new Map<string, number[]>();

const inMemoryChallengeStore: ChallengeStore = {
  async consume(token: string): Promise<boolean> {
    if (usedTokens.has(token)) return false;
    usedTokens.add(token);
    return true;
  },
};

const inMemoryRateLimitStore: RateLimitStore = {
  async check({ key, windowMs, max, now }): Promise<RateLimitVerdict> {
    const t = now ?? Date.now();
    const decision = slidingWindowDecision(buckets.get(key) ?? [], windowMs, max, t);
    // Persist the trimmed log (bounded) on both accept + reject.
    buckets.set(key, decision.nextTimestamps);
    return { ok: decision.ok, retryAfterMs: decision.retryAfterMs, remaining: decision.remaining };
  },
};

// ─── Postgres backend (opt-in) ───────────────────────────────────────────

/** True when a Prisma error is a unique-constraint violation (P2002). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

const postgresChallengeStore: ChallengeStore = {
  async consume(token: string, expiresAtMs: number): Promise<boolean> {
    const { getPrisma } = await import("@roundfi/indexer/db");
    const prisma = getPrisma();
    // Opportunistic sweep of expired rows — keeps the table bounded
    // without a cron. ~3% of calls pay for it; failures are swallowed
    // (cleanup is best-effort, never blocks a sign-in).
    if (Math.random() < 0.03) {
      try {
        await prisma.adminChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      } catch {
        /* best-effort */
      }
    }
    try {
      await prisma.adminChallenge.create({
        data: { token, pubkey: "", expiresAt: new Date(expiresAtMs) },
      });
      return true; // first use
    } catch (err) {
      if (isUniqueViolation(err)) return false; // replay
      throw err;
    }
  },
};

const postgresRateLimitStore: RateLimitStore = {
  async check({ key, windowMs, max, now }): Promise<RateLimitVerdict> {
    const { getPrisma } = await import("@roundfi/indexer/db");
    const prisma = getPrisma();
    const t = now ?? Date.now();
    const cutoff = new Date(t - windowMs);
    // Transaction bounds the read-decide-write. Under Read Committed a
    // tiny race remains (two concurrent txns can both pass the count
    // before either inserts) — acceptable for an auth limiter at this
    // volume; a per-key advisory lock would close it if ever needed.
    return prisma.$transaction(async (tx) => {
      await tx.adminRateLimitHit.deleteMany({ where: { bucketKey: key, hitAt: { lte: cutoff } } });
      const live = await tx.adminRateLimitHit.findMany({
        where: { bucketKey: key },
        select: { hitAt: true },
        orderBy: { hitAt: "asc" },
      });
      const decision = slidingWindowDecision(
        live.map((r) => r.hitAt.getTime()),
        windowMs,
        max,
        t,
      );
      if (decision.ok) {
        await tx.adminRateLimitHit.create({ data: { bucketKey: key, hitAt: new Date(t) } });
      }
      return {
        ok: decision.ok,
        retryAfterMs: decision.retryAfterMs,
        remaining: decision.remaining,
      };
    });
  },
};

// ─── Selector ────────────────────────────────────────────────────────────

/** Which backend the env selects. Default `memory` preserves behavior. */
export function sharedStoreBackend(): "memory" | "postgres" {
  return process.env.ADMIN_SHARED_STORE === "postgres" ? "postgres" : "memory";
}

export function getChallengeStore(): ChallengeStore {
  return sharedStoreBackend() === "postgres" ? postgresChallengeStore : inMemoryChallengeStore;
}

export function getRateLimitStore(): RateLimitStore {
  return sharedStoreBackend() === "postgres" ? postgresRateLimitStore : inMemoryRateLimitStore;
}

// ─── Test seam ───────────────────────────────────────────────────────────

/** Clears the in-memory backends between unit-test cases. */
export function __resetInMemoryStoresForTest(): void {
  usedTokens.clear();
  buckets.clear();
}

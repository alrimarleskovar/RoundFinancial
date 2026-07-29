/**
 * Local cache for sealed free-bid envelopes (ADR 0012 Fase 3).
 *
 * The envelope's secret is DERIVED, not stored — `saltFromSignature` in
 * the SDK reproduces it from a wallet signature on any device, and
 * `recoverBidParcels` finds the amount by scanning the tiny
 * whole-installment space against the on-chain `commit_hash`. So this
 * module is a convenience, not a dependency: losing it costs the bidder
 * one extra signature at reveal time, nothing more.
 *
 * That ordering is deliberate. A commit-reveal UI whose only copy of the
 * secret lives in `localStorage` quietly makes "clear your cache" and
 * "open it on your phone" into ways to lose an auction with no recourse —
 * and no on-chain code can rescue that. Treating storage as a cache means
 * the failure mode is friction, not loss.
 *
 * Every access is try/caught for the same reasons `poolCache` documents:
 * SSR (no `localStorage`), privacy mode, and quota errors that throw on
 * the getter itself.
 */

const PREFIX = "roundfi:bid:v1";

export interface StoredEnvelope {
  /** Installments the bid buys. */
  parcels: number;
  /** Decimal string — bigint doesn't survive JSON. */
  salt: string;
  /** Unix seconds, for display ("selado há 2h"). */
  sealedAt: number;
}

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function keyFor(pool: string, cycle: number, bidder: string): string {
  return `${PREFIX}:${pool}:${cycle}:${bidder}`;
}

export function saveEnvelope(
  pool: string,
  cycle: number,
  bidder: string,
  env: StoredEnvelope,
): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(keyFor(pool, cycle, bidder), JSON.stringify(env));
  } catch {
    // Quota or privacy mode — the derive path still recovers the envelope.
  }
}

export function loadEnvelope(pool: string, cycle: number, bidder: string): StoredEnvelope | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(keyFor(pool, cycle, bidder));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredEnvelope>;
    if (
      typeof parsed.parcels !== "number" ||
      !Number.isInteger(parsed.parcels) ||
      parsed.parcels < 1 ||
      typeof parsed.salt !== "string" ||
      parsed.salt.length === 0
    ) {
      return null;
    }
    // A malformed salt would fail the on-chain hash check anyway; catching
    // it here keeps the "recover with your wallet" path reachable instead
    // of firing a doomed reveal.
    try {
      if (BigInt(parsed.salt) <= 0n) return null;
    } catch {
      return null;
    }
    return {
      parcels: parsed.parcels,
      salt: parsed.salt,
      sealedAt: typeof parsed.sealedAt === "number" ? parsed.sealedAt : 0,
    };
  } catch {
    return null;
  }
}

/** Drop the cache entry once the envelope is opened (or the cycle passed). */
export function clearEnvelope(pool: string, cycle: number, bidder: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(keyFor(pool, cycle, bidder));
  } catch {
    /* nothing to do */
  }
}

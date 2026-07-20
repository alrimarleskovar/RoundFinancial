/**
 * poolCache — stale-while-revalidate persistence for on-chain reads.
 *
 * The problem: every navigation to /home, /grupos or /carteira mounted the
 * pool hooks at `status: "loading"`, so the page painted its EMPTY state
 * ("Nenhum ciclo de crédito ativo") for the several seconds the 14-call RPC
 * fan-out took, then snapped to the real state. The chain state changes on
 * the order of hours (cycle boundaries), so throwing away the last-known
 * snapshot on every mount was pure waste.
 *
 * The fix: a two-tier cache — a module-level Map (same-session navigations
 * pay zero parse cost) over `localStorage` (survives reloads and new tabs).
 * Hooks hydrate synchronously from here on mount and paint the last-known
 * state instantly, then their normal `load()` revalidates against the chain
 * and replaces it — the same freshness as before, without the blank flash.
 *
 * Serialization: the SDK view objects carry `PublicKey`, `bigint` and
 * `Buffer` values, which JSON can't round-trip. A tiny recursive codec maps
 * them to tagged sentinels (`{$pubkey}`, `{$bigint}`, `{$bytes}`) and back,
 * reconstructing real instances on read (`.equals()` etc. keep working).
 *
 * Safety properties:
 *   - versioned keys (`CACHE_VERSION`): any view-shape change invalidates
 *     old entries instead of decoding garbage;
 *   - 24h TTL: an ancient snapshot is worse than a spinner;
 *   - every localStorage touch is try/caught (quota, privacy mode, SSR) —
 *     cache failures degrade to exactly today's behavior, never an error;
 *   - callers key entries by seedKey AND account address, so re-pinning a
 *     pool PDA (it happened to pool8) can't paint another account's state.
 */

import { PublicKey } from "@solana/web3.js";

const CACHE_VERSION = 1;
const TTL_MS = 24 * 60 * 60 * 1000;
const PREFIX = `roundfi:cache:v${CACHE_VERSION}`;

// Wallet-scoped kinds (timeline/profile/txhistory/txclass) key by the wallet's
// base58 — callers own the keying; the cache is agnostic.
type Kind = "pool" | "members" | "draw" | "timeline" | "profile" | "txhistory" | "txclass";

// Tier 1 — same-session memory. Holds the DECODED value (no re-parse).
const mem = new Map<string, { ts: number; value: unknown }>();

/** Tagged-sentinel encoder for PublicKey / bigint / Buffer inside plain data. */
export function encodeCacheValue(v: unknown): unknown {
  if (typeof v === "bigint") return { $bigint: v.toString() };
  if (v instanceof PublicKey) return { $pubkey: v.toBase58() };
  if (v instanceof Uint8Array) return { $bytes: Buffer.from(v).toString("base64") };
  if (Array.isArray(v)) return v.map(encodeCacheValue);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, encodeCacheValue(x)]),
    );
  }
  return v;
}

export function decodeCacheValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decodeCacheValue);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.$bigint === "string" && Object.keys(o).length === 1) return BigInt(o.$bigint);
    if (typeof o.$pubkey === "string" && Object.keys(o).length === 1)
      return new PublicKey(o.$pubkey);
    if (typeof o.$bytes === "string" && Object.keys(o).length === 1)
      return Buffer.from(o.$bytes, "base64");
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decodeCacheValue(x)]));
  }
  return v;
}

function storageKey(kind: Kind, key: string): string {
  return `${PREFIX}:${kind}:${key}`;
}

function storage(): Storage | null {
  try {
    // globalThis works in both worlds: browser (=== window.localStorage) and
    // node/SSR (undefined → memory-tier only). Guarded because privacy modes
    // can throw on the localStorage getter itself.
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** Last-known value for (kind, key), or null when absent/stale/corrupt. */
export function cacheGet<T>(kind: Kind, key: string): T | null {
  const sk = storageKey(kind, key);
  const hit = mem.get(sk);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.value as T;
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(sk);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: number; data?: unknown };
    if (typeof parsed.ts !== "number" || Date.now() - parsed.ts >= TTL_MS) return null;
    const value = decodeCacheValue(parsed.data);
    mem.set(sk, { ts: parsed.ts, value });
    return value as T;
  } catch {
    return null;
  }
}

export function cacheSet(kind: Kind, key: string, value: unknown): void {
  const sk = storageKey(kind, key);
  mem.set(sk, { ts: Date.now(), value });
  const store = storage();
  if (!store) return;
  try {
    store.setItem(sk, JSON.stringify({ ts: Date.now(), data: encodeCacheValue(value) }));
  } catch {
    /* quota / privacy mode — memory tier still works */
  }
}

/** Drop an entry (e.g. the account no longer exists on-chain). */
export function cacheDelete(kind: Kind, key: string): void {
  const sk = storageKey(kind, key);
  mem.delete(sk);
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(sk);
  } catch {
    /* ignore */
  }
}

/** Test hook — resets the memory tier so specs can exercise the storage path. */
export function __clearMemoryCacheForTests(): void {
  mem.clear();
}

/**
 * Server-side admin auth wiring (ADR 0009 §1). Reads env, resolves the
 * effective allowlist (env operators ∪ best-effort on-chain authority),
 * and exposes `requireAdmin(req)` — the gate EVERY protected
 * `/api/admin/**` route handler calls. The gate is on the endpoint, not
 * the UI.
 *
 * Node runtime only (uses node:crypto via the session/siws modules).
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { protocolConfigPda } from "@roundfi/sdk";

import { buildAllowlist, isAllowed } from "./allowlist.js";
import { ADMIN_SESSION_COOKIE, verifySession } from "./session.js";
import { DEFAULT_ADMIN_DOMAIN } from "./siws.js";

/** Devnet core program id (pinned in services/indexer/README + scripts/devnet). */
const DEFAULT_CORE_PROGRAM_ID = "8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw";

/**
 * Session-signing secret. Fail-CLOSED: auth must never run on a fabricated
 * secret, so a missing env throws (the route handler turns this into a 500
 * with a clear message) rather than silently minting forgeable sessions.
 */
export function getSessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "ADMIN_SESSION_SECRET is unset or too short (>=16 chars). Admin auth refuses to run " +
        "without a real signing secret (ADR 0009 — fail-closed).",
    );
  }
  return secret;
}

export function getAdminDomain(): string {
  return process.env.ADMIN_DOMAIN ?? DEFAULT_ADMIN_DOMAIN;
}

// ─── On-chain authority (best-effort, cached) ────────────────────────────

/**
 * Split-TTL cache for the on-chain authority lookup (RoundFi internal
 * audit follow-up). Successful reads stick for 5 minutes — the authority
 * is stable across redeploys, so a long TTL is cheap. Failures stick for
 * only 30 seconds: a uniform 5-minute TTL meant a single transient RPC
 * blip at boot poisoned the cache for the full window, dropping the
 * on-chain authority out of the effective allowlist even after the RPC
 * recovered. 30 seconds is short enough that a flaky RPC heals itself
 * quickly, long enough that a sustained outage doesn't hammer the RPC.
 */
const AUTHORITY_TTL_HIT_MS = 5 * 60_000;
const AUTHORITY_TTL_MISS_MS = 30_000;

let authorityCache: { value: string | null; expiresAt: number } | null = null;

/**
 * Underlying RPC fetcher — separated from `fetchProtocolAuthority` so it
 * can be replaced in tests via `__setAuthorityFetcherForTest`. Returns
 * the base58 authority on success, null on any failure (which is logged
 * for ops visibility — see audit follow-up).
 */
type AuthorityFetcher = (rpcUrl: string, programId: string) => Promise<string | null>;

const defaultAuthorityFetcher: AuthorityFetcher = async (rpcUrl, programId) => {
  try {
    const [configPda] = protocolConfigPda(new PublicKey(programId));
    const info = await new Connection(rpcUrl, "confirmed").getAccountInfo(configPda, "confirmed");
    if (!info) {
      console.warn(
        "[admin/auth] ProtocolConfig account not found at the derived PDA — " +
          "verify ROUNDFI_CORE_PROGRAM_ID is the deployed program id. " +
          "Falling back to ADMIN_ALLOWLIST.",
      );
      return null;
    }
    if (info.data.length < 40) {
      console.warn(
        `[admin/auth] ProtocolConfig data too short (${info.data.length} bytes, ` +
          `need >=40 for discriminator + authority Pubkey). ` +
          `Falling back to ADMIN_ALLOWLIST.`,
      );
      return null;
    }
    return new PublicKey(info.data.subarray(8, 40)).toBase58();
  } catch (err) {
    // Sanitized: log the message only, not the full Connection state /
    // RPC URL, since this lands in shared infra logs.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[admin/auth] On-chain authority read failed: ${msg}. ` +
        `Falling back to ADMIN_ALLOWLIST until next retry (TTL ${AUTHORITY_TTL_MISS_MS}ms).`,
    );
    return null;
  }
};

let authorityFetcher: AuthorityFetcher = defaultAuthorityFetcher;

/**
 * Best-effort read of `ProtocolConfig.authority` so the protocol owner is
 * always allowed without being re-listed. IDL-free (ADR 0002 style):
 * authority is the first field of the account, bytes 8..40 (8-byte Anchor
 * discriminator + Pubkey). Returns null on any RPC/parse failure — the
 * env allowlist is the durable floor, so a failed read NEVER opens the
 * gate. See `resolveAllowlist` for the union-with-env behavior.
 *
 * Caching: split-TTL (see `AUTHORITY_TTL_*`). A miss caches null for a
 * short window so a transient RPC failure heals quickly without spamming
 * the RPC on every admin request.
 */
export async function fetchProtocolAuthority(): Promise<string | null> {
  if (authorityCache && authorityCache.expiresAt > Date.now()) return authorityCache.value;
  const rpc = process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL;
  const coreId = process.env.ROUNDFI_CORE_PROGRAM_ID ?? DEFAULT_CORE_PROGRAM_ID;
  let value: string | null = null;
  if (!rpc) {
    console.warn(
      "[admin/auth] Neither SOLANA_RPC_URL nor NEXT_PUBLIC_RPC_URL is set — " +
        "skipping on-chain authority lookup. Console access is restricted to " +
        "ADMIN_ALLOWLIST entries.",
    );
  } else {
    // Defensive wrap: the contract of `fetchProtocolAuthority` is
    // "best-effort, never throws." `defaultAuthorityFetcher` honors
    // that internally, but a substituted fetcher might not — this
    // guarantees the contract regardless.
    try {
      value = await authorityFetcher(rpc, coreId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[admin/auth] Authority fetcher threw unexpectedly: ${msg}.`);
      value = null;
    }
  }
  const ttl = value === null ? AUTHORITY_TTL_MISS_MS : AUTHORITY_TTL_HIT_MS;
  authorityCache = { value, expiresAt: Date.now() + ttl };
  return value;
}

export async function resolveAllowlist(): Promise<Set<string>> {
  const allowlist = buildAllowlist({
    envValue: process.env.ADMIN_ALLOWLIST,
    authority: await fetchProtocolAuthority(),
  });
  if (allowlist.size === 0) {
    // Effective allowlist is empty — every admin request will 403. This
    // is FAIL-CLOSED (correct), but invisible to the operator. Log loud
    // so a "why is no one able to log in" question has a one-line answer
    // in the logs. Emitted per resolve so log volume itself signals the
    // misconfiguration's persistence (the cache miss TTL bounds this).
    console.error(
      "[admin/auth] Effective allowlist is EMPTY — every /api/admin/** request " +
        "will reject with 403. Set ADMIN_ALLOWLIST (env) or configure " +
        "SOLANA_RPC_URL so the on-chain authority can be read.",
    );
  }
  return allowlist;
}

// ─── Test seams ──────────────────────────────────────────────────────────
// Exported for unit tests under tests/admin_authority_cache.spec.ts. They
// are no-ops in production paths (no caller invokes them).

export function __setAuthorityFetcherForTest(f: AuthorityFetcher | null): void {
  authorityFetcher = f ?? defaultAuthorityFetcher;
}

export function __clearAuthorityCacheForTest(): void {
  authorityCache = null;
}

// ─── The endpoint gate ───────────────────────────────────────────────────

export type AdminGate = { ok: true; pubkey: string } | { ok: false; status: number; error: string };

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * Authorize a request: valid session cookie AND the session pubkey is in
 * the effective allowlist. Returns a discriminated result so handlers can
 * answer a uniform 401 without leaking which check failed.
 */
export async function requireAdmin(req: Request): Promise<AdminGate> {
  const token = readCookie(req, ADMIN_SESSION_COOKIE);
  if (!token) return { ok: false, status: 401, error: "no_session" };

  let secret: string;
  try {
    secret = getSessionSecret();
  } catch {
    return { ok: false, status: 500, error: "server_misconfigured" };
  }

  const session = verifySession({ secret, token });
  if (!session) return { ok: false, status: 401, error: "invalid_session" };

  const allowlist = await resolveAllowlist();
  if (!isAllowed(session.pubkey, allowlist)) {
    return { ok: false, status: 403, error: "not_allowlisted" };
  }
  return { ok: true, pubkey: session.pubkey };
}

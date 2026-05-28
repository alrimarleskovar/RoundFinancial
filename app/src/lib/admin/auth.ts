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

let authorityCache: { value: string | null; expiresAt: number } | null = null;
const AUTHORITY_TTL_MS = 5 * 60_000;

/**
 * Best-effort read of `ProtocolConfig.authority` so the protocol owner is
 * always allowed without being re-listed. IDL-free (ADR 0002 style):
 * authority is the first field of the account, bytes 8..40 (8-byte Anchor
 * discriminator + Pubkey). Returns null on any RPC/parse failure — the env
 * allowlist is the durable floor, so a failed read never opens the gate.
 */
export async function fetchProtocolAuthority(): Promise<string | null> {
  if (authorityCache && authorityCache.expiresAt > Date.now()) return authorityCache.value;
  let value: string | null = null;
  try {
    const rpc = process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL;
    const coreId = process.env.ROUNDFI_CORE_PROGRAM_ID ?? DEFAULT_CORE_PROGRAM_ID;
    if (rpc) {
      const [configPda] = protocolConfigPda(new PublicKey(coreId));
      const info = await new Connection(rpc, "confirmed").getAccountInfo(configPda, "confirmed");
      if (info && info.data.length >= 40) {
        value = new PublicKey(info.data.subarray(8, 40)).toBase58();
      }
    }
  } catch {
    value = null;
  }
  authorityCache = { value, expiresAt: Date.now() + AUTHORITY_TTL_MS };
  return value;
}

export async function resolveAllowlist(): Promise<Set<string>> {
  return buildAllowlist({
    envValue: process.env.ADMIN_ALLOWLIST,
    authority: await fetchProtocolAuthority(),
  });
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

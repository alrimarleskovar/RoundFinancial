/**
 * Admin session token — a short-lived, HMAC-signed bearer of the
 * authenticated pubkey (ADR 0009 §1). Stored in an httpOnly cookie so it
 * is never readable by client JS. Stateless: the server verifies the HMAC
 * + expiry without a session store.
 *
 * Format: `base64url(payloadJson).base64url(hmacSha256)`. The payload is
 * `{ sub: pubkey, exp: epochSeconds }`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Cookie name for the admin session. */
export const ADMIN_SESSION_COOKIE = "rfi_admin_session";

/** Session lifetime. Short — the console is internal + re-auth is cheap. */
export const SESSION_TTL_SECONDS = 30 * 60;

interface SessionPayload {
  sub: string;
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signSession(args: {
  secret: string;
  pubkey: string;
  now?: number;
  ttlSeconds?: number;
}): string {
  const nowSec = Math.floor((args.now ?? Date.now()) / 1000);
  const payload: SessionPayload = {
    sub: args.pubkey,
    exp: nowSec + (args.ttlSeconds ?? SESSION_TTL_SECONDS),
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", args.secret).update(body).digest());
  return `${body}.${sig}`;
}

/**
 * Verify a session token. Returns the authenticated pubkey, or null on any
 * tamper / expiry / malformed input (never throws).
 */
export function verifySession(args: { secret: string; token: string; now?: number }): {
  pubkey: string;
} | null {
  try {
    const [body, sig] = args.token.split(".");
    if (!body || !sig) return null;
    const expected = b64url(createHmac("sha256", args.secret).update(body).digest());
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    const nowSec = Math.floor((args.now ?? Date.now()) / 1000);
    if (typeof payload.exp !== "number" || payload.exp < nowSec) return null;
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    return { pubkey: payload.sub };
  } catch {
    return null;
  }
}

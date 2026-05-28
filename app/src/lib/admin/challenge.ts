/**
 * Stateless SIWS challenge (nonce) issuance + verification (ADR 0009 §1).
 *
 * The challenge is bound to the pubkey + issued-at by an HMAC over the
 * server secret, so we don't need a shared nonce store across instances:
 * the server can re-derive and validate the challenge it issued. A short
 * TTL bounds the replay window; an in-memory single-use set is layered on
 * top as best-effort defense-in-depth (effective on a single instance —
 * the canary runs one).
 *
 * This module is pure except for the optional single-use set; the secret
 * and clock are passed in so it is fully unit-testable without env/Next.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { buildSignInMessage } from "./siws.js";

/** Challenge validity window. Kept short — the user signs immediately. */
export const CHALLENGE_TTL_MS = 5 * 60_000;

export interface IssuedChallenge {
  pubkey: string;
  nonce: string;
  issuedAt: number;
  /** The exact string the wallet must sign. */
  message: string;
  /** HMAC binding (pubkey, nonce, issuedAt, domain) to the server secret. */
  challengeToken: string;
}

function challengeHmac(
  secret: string,
  domain: string,
  pubkey: string,
  nonce: string,
  issuedAt: number,
): string {
  return createHmac("sha256", secret)
    .update(`${domain}|${pubkey}|${nonce}|${issuedAt}`)
    .digest("hex");
}

export function issueChallenge(args: {
  secret: string;
  domain: string;
  pubkey: string;
  now?: number;
}): IssuedChallenge {
  const issuedAt = args.now ?? Date.now();
  const nonce = randomBytes(16).toString("hex");
  const message = buildSignInMessage({ domain: args.domain, pubkey: args.pubkey, nonce, issuedAt });
  const challengeToken = challengeHmac(args.secret, args.domain, args.pubkey, nonce, issuedAt);
  return { pubkey: args.pubkey, nonce, issuedAt, message, challengeToken };
}

/** Best-effort single-use guard — see module note about single-instance scope. */
const usedTokens = new Set<string>();

export type ChallengeVerdict =
  | { ok: true; message: string }
  | { ok: false; reason: "expired" | "bad_token" | "replayed" };

/**
 * Validate a challenge presented at /verify and return the exact message
 * the signature must cover. On success the token is consumed (single-use).
 */
export function verifyChallenge(args: {
  secret: string;
  domain: string;
  pubkey: string;
  nonce: string;
  issuedAt: number;
  challengeToken: string;
  now?: number;
}): ChallengeVerdict {
  const now = args.now ?? Date.now();
  if (now - args.issuedAt > CHALLENGE_TTL_MS || args.issuedAt > now) {
    return { ok: false, reason: "expired" };
  }
  const expected = challengeHmac(args.secret, args.domain, args.pubkey, args.nonce, args.issuedAt);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(args.challengeToken, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_token" };
  }
  if (usedTokens.has(args.challengeToken)) {
    return { ok: false, reason: "replayed" };
  }
  usedTokens.add(args.challengeToken);
  const message = buildSignInMessage({
    domain: args.domain,
    pubkey: args.pubkey,
    nonce: args.nonce,
    issuedAt: args.issuedAt,
  });
  return { ok: true, message };
}

/** Test seam — clears the single-use set between cases. */
export function __resetUsedTokensForTest(): void {
  usedTokens.clear();
}

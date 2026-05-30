/**
 * Stateless SIWS challenge (nonce) issuance + verification (ADR 0009 §1).
 *
 * The challenge is bound to the pubkey + issued-at by an HMAC over the
 * server secret, so we don't need a shared nonce store to VALIDATE it:
 * the server re-derives and checks the HMAC. A short TTL bounds the
 * replay window. SINGLE-USE (consume-once) is enforced separately by a
 * pluggable store (`sharedStore.ts`) — in-memory for a single instance,
 * Postgres-shared for multi-instance (RoundFi internal audit Wave 2).
 *
 * This module is PURE (no state, no I/O): the secret + clock are passed
 * in, so it is fully unit-testable without env / Next / DB. The single-
 * use side effect was moved OUT of here into the store.
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

export type ChallengeShapeVerdict =
  | { ok: true; message: string }
  | { ok: false; reason: "expired" | "bad_token" };

/**
 * Validate a challenge's SHAPE — TTL window + HMAC binding — and return
 * the exact message the signature must cover. PURE: this does NOT
 * enforce single-use (that is the store's job, post-shape-check), so it
 * has no side effects and is safe to call repeatedly in tests.
 *
 * Single-use is deliberately layered AFTER signature verification in the
 * route (see verify/route.ts): consuming only on a valid signature means
 * a bad-signature submission can't burn a legitimate user's nonce, while
 * the store's atomic insert-or-conflict still fully prevents replay.
 */
export function verifyChallengeShape(args: {
  secret: string;
  domain: string;
  pubkey: string;
  nonce: string;
  issuedAt: number;
  challengeToken: string;
  now?: number;
}): ChallengeShapeVerdict {
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
  const message = buildSignInMessage({
    domain: args.domain,
    pubkey: args.pubkey,
    nonce: args.nonce,
    issuedAt: args.issuedAt,
  });
  return { ok: true, message };
}

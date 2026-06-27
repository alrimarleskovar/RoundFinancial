/**
 * Stateless SIWS challenge for the email opt-in flow — the notification twin
 * of `lib/admin/challenge.ts`.
 *
 * The wallet signs a message that names BOTH the wallet AND the email AND the
 * action (subscribe / unsubscribe), and the challengeToken HMACs all of them
 * together with a server secret. So:
 *   - the server re-derives + checks the HMAC without a nonce store (stateless
 *     SHAPE validation, bounded by a short TTL), and
 *   - a token issued for (wallet, emailA, subscribe) can NEVER be replayed for
 *     a different email or action — both are inside the signed bytes AND the
 *     HMAC. The distinct domain + distinct secret (NOTIFY_SIGNING_SECRET) also
 *     keep it disjoint from the admin-console challenge space.
 *
 * PURE (no state, no I/O): secret + clock are passed in, so it is fully
 * unit-testable without env / Next / DB. Single-use (consume-once) is layered
 * on AFTER signature verification in the route, via the shared challenge store.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Challenge validity window. Short — the user signs immediately. */
export const EMAIL_CHALLENGE_TTL_MS = 5 * 60_000;

export type EmailAction = "subscribe" | "unsubscribe";

export interface EmailMessageParts {
  domain: string;
  /** base58 Solana address binding the email. */
  pubkey: string;
  /** Normalized (trimmed + lowercased) email. */
  email: string;
  action: EmailAction;
  /** Opaque random challenge (hex), bound into the token. */
  nonce: string;
  /** Issued-at, epoch milliseconds. Rendered as ISO in the message. */
  issuedAt: number;
}

/**
 * Canonical, deterministic message the wallet signs. The server reconstructs
 * this byte-for-byte from the challenge it issued, so the client cannot smuggle
 * a different email/action past verification.
 */
export function buildEmailMessage(parts: EmailMessageParts): string {
  const issuedAtIso = new Date(parts.issuedAt).toISOString();
  const verb =
    parts.action === "subscribe"
      ? `Subscribe ${parts.email} to RoundFi alerts`
      : `Unsubscribe ${parts.email} from RoundFi alerts`;
  return [
    `${parts.domain} wants you to set a notification preference with your Solana account:`,
    parts.pubkey,
    "",
    `${verb} (due-date reminders, new pools, score changes).`,
    "",
    `Email: ${parts.email}`,
    `Action: ${parts.action}`,
    `Nonce: ${parts.nonce}`,
    `Issued At: ${issuedAtIso}`,
  ].join("\n");
}

/** Nonce shape `issueEmailChallenge` produces: 16 random bytes as hex. Pinned
 *  so `verify` rejects anything else up front (defense-in-depth). */
export const EMAIL_NONCE_RE = /^[0-9a-f]{32}$/;

function emailHmac(
  secret: string,
  domain: string,
  pubkey: string,
  email: string,
  action: EmailAction,
  nonce: string,
  issuedAt: number,
): string {
  // CANONICAL input — JSON-encode the tuple instead of `|`-joining it. `email`
  // is attacker-controlled free text; a `|`-delimited concat let two different
  // (email, action, nonce) tuples re-split to the same byte string (a real
  // collision, contained today only by the ed25519 gate). JSON delimits every
  // field with quotes and escapes any internal quote/backslash, so distinct
  // tuples can never serialize identically — the token binds the tuple on its
  // own, not on the signature. (Admin's HMAC stays collision-free because all
  // its fields are pipe-free base58/hex/number; this one carries free text, so
  // it must encode unambiguously.)
  return createHmac("sha256", secret)
    .update(JSON.stringify([domain, pubkey, email, action, nonce, issuedAt]))
    .digest("hex");
}

export interface IssuedEmailChallenge {
  pubkey: string;
  email: string;
  action: EmailAction;
  nonce: string;
  issuedAt: number;
  /** The exact string the wallet must sign. */
  message: string;
  /** HMAC binding (domain, pubkey, email, action, nonce, issuedAt) to secret. */
  challengeToken: string;
}

export function issueEmailChallenge(args: {
  secret: string;
  domain: string;
  pubkey: string;
  email: string;
  action: EmailAction;
  now?: number;
}): IssuedEmailChallenge {
  const issuedAt = args.now ?? Date.now();
  const nonce = randomBytes(16).toString("hex");
  const message = buildEmailMessage({
    domain: args.domain,
    pubkey: args.pubkey,
    email: args.email,
    action: args.action,
    nonce,
    issuedAt,
  });
  const challengeToken = emailHmac(
    args.secret,
    args.domain,
    args.pubkey,
    args.email,
    args.action,
    nonce,
    issuedAt,
  );
  return {
    pubkey: args.pubkey,
    email: args.email,
    action: args.action,
    nonce,
    issuedAt,
    message,
    challengeToken,
  };
}

export type EmailChallengeVerdict =
  | { ok: true; message: string }
  | { ok: false; reason: "expired" | "bad_token" };

/**
 * Validate a challenge's SHAPE — TTL window + HMAC over the full
 * (domain, pubkey, email, action, nonce, issuedAt) tuple — and return the
 * exact message the signature must cover. PURE: does NOT enforce single-use
 * (the route does that, post-signature, via the shared store) so it has no
 * side effects and is safe to call repeatedly in tests.
 */
export function verifyEmailChallengeShape(args: {
  secret: string;
  domain: string;
  pubkey: string;
  email: string;
  action: EmailAction;
  nonce: string;
  issuedAt: number;
  challengeToken: string;
  now?: number;
}): EmailChallengeVerdict {
  const now = args.now ?? Date.now();
  // Reject a non-finite issuedAt up front: `NaN > now` and `now - NaN > TTL`
  // are both false, so without this a NaN slips through the time window and
  // leans entirely on the HMAC to catch it. Fail it here instead.
  if (
    !Number.isFinite(args.issuedAt) ||
    now - args.issuedAt > EMAIL_CHALLENGE_TTL_MS ||
    args.issuedAt > now
  ) {
    return { ok: false, reason: "expired" };
  }
  // Nonce must be the exact shape we issue. The HMAC already binds it, but
  // pinning the charset rejects malformed input before the constant-time
  // compare and documents the contract.
  if (!EMAIL_NONCE_RE.test(args.nonce)) {
    return { ok: false, reason: "bad_token" };
  }
  const expected = emailHmac(
    args.secret,
    args.domain,
    args.pubkey,
    args.email,
    args.action,
    args.nonce,
    args.issuedAt,
  );
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(args.challengeToken, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_token" };
  }
  const message = buildEmailMessage({
    domain: args.domain,
    pubkey: args.pubkey,
    email: args.email,
    action: args.action,
    nonce: args.nonce,
    issuedAt: args.issuedAt,
  });
  return { ok: true, message };
}

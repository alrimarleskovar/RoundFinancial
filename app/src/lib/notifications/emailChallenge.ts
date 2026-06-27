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

function emailHmac(
  secret: string,
  domain: string,
  pubkey: string,
  email: string,
  action: EmailAction,
  nonce: string,
  issuedAt: number,
): string {
  return createHmac("sha256", secret)
    .update(`${domain}|${pubkey}|${email}|${action}|${nonce}|${issuedAt}`)
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
  if (now - args.issuedAt > EMAIL_CHALLENGE_TTL_MS || args.issuedAt > now) {
    return { ok: false, reason: "expired" };
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

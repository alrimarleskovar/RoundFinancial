/**
 * Server-side config for the wallet-bound email-notification feature.
 *
 * The whole feature is DARK unless `EMAIL_NOTIFICATIONS_ENABLED=true`, so it
 * can ship to main + a devnet deploy without exposing anything in a mainnet
 * build (the canary-readiness rule: a new surface must be explicitly enabled,
 * never on-by-accident). The signing secret is fail-CLOSED like the admin
 * console's — opt-in must never run on a fabricated secret.
 *
 * Node runtime only (the challenge module uses node:crypto).
 */

/** Default domain shown in the signed opt-in message; override via env. */
export const DEFAULT_NOTIFY_DOMAIN = "alerts.roundfi";

/** Feature flag. Dark by default — every notification route 404s when off. */
export function emailNotificationsEnabled(): boolean {
  return process.env.EMAIL_NOTIFICATIONS_ENABLED === "true";
}

/**
 * HMAC secret binding the opt-in challenge. Fail-CLOSED: a missing/short env
 * throws (the route turns it into a 500) rather than signing challenges with a
 * guessable key. DISTINCT from ADMIN_SESSION_SECRET on purpose — the two
 * security domains must not share a key, so an admin challenge can never be
 * cross-replayed as an email opt-in even if the message formats were similar.
 */
export function getNotifySecret(): string {
  const secret = process.env.NOTIFY_SIGNING_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "NOTIFY_SIGNING_SECRET is unset or too short (>=16 chars). Email opt-in refuses " +
        "to run without a real signing secret (fail-closed, same posture as admin auth).",
    );
  }
  return secret;
}

export function getNotifyDomain(): string {
  return process.env.NOTIFY_DOMAIN ?? DEFAULT_NOTIFY_DOMAIN;
}

// ─── Email validation ────────────────────────────────────────────────────

/** RFC-5321 caps the address at 254 chars; we also require one @ and a dot
 *  in the domain. Deliberately conservative — the wallet signature proves
 *  ownership of the KEY, not the inbox (inbox-confirmation is a later PR), so
 *  this is a format gate, not a deliverability guarantee. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_EMAIL_LEN = 254;

/** Canonical form: trimmed + lowercased. The signed message embeds THIS, so
 *  issue + verify reconstruct the exact same bytes regardless of the casing
 *  the user typed. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  const e = normalizeEmail(raw);
  return e.length > 0 && e.length <= MAX_EMAIL_LEN && EMAIL_RE.test(e);
}

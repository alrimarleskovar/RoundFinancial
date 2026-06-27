// POST /api/notifications/email — verify a signed opt-in challenge and apply it
// (subscribe → bind the email opted-in; unsubscribe → mark opted-out). The
// notification twin of the admin /verify route: SHAPE → signature → single-use
// → effect. Dark unless EMAIL_NOTIFICATIONS_ENABLED=true.
//
// Security: the wallet must produce a valid ed25519 signature over the exact
// message — which names the wallet, the email, and the action — so only the
// key owner can bind/clear an address for their wallet. Single-use consumption
// (shared challenge store) blocks replay; the bind itself is an idempotent
// upsert, so a re-submit within the TTL is harmless even before that.

import { NextResponse } from "next/server";

import { clientKeyFromRequest } from "@/lib/admin/rateLimit";
import { getChallengeStore, getRateLimitStore } from "@/lib/admin/sharedStore";
import { verifySignInSignature } from "@/lib/admin/siws";
import {
  emailNotificationsEnabled,
  getNotifyDomain,
  getNotifySecret,
  isValidEmail,
  normalizeEmail,
} from "@/lib/notifications/config";
import {
  EMAIL_CHALLENGE_TTL_MS,
  verifyEmailChallengeShape,
  type EmailAction,
} from "@/lib/notifications/emailChallenge";
import { getEmailStore } from "@/lib/notifications/emailStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RL_WINDOW_MS = 60_000;
const RL_MAX = Math.max(1, Number(process.env.NOTIFY_RL_CONFIRM_PER_MIN ?? 5));

function isEmailAction(v: unknown): v is EmailAction {
  return v === "subscribe" || v === "unsubscribe";
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!emailNotificationsEnabled()) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 404 });
  }

  const clientKey = clientKeyFromRequest(req);
  const rl = await getRateLimitStore().check({
    key: `notify-email-confirm:${clientKey}`,
    windowMs: RL_WINDOW_MS,
    max: RL_MAX,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let secret: string;
  try {
    secret = getNotifySecret();
  } catch {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const { pubkey, email, action, nonce, issuedAt, challengeToken, signature, lang } = body as {
    pubkey?: unknown;
    email?: unknown;
    action?: unknown;
    nonce?: unknown;
    issuedAt?: unknown;
    challengeToken?: unknown;
    signature?: unknown;
    lang?: unknown;
  };
  if (
    typeof pubkey !== "string" ||
    typeof email !== "string" ||
    !isEmailAction(action) ||
    typeof nonce !== "string" ||
    typeof issuedAt !== "number" ||
    !Number.isFinite(issuedAt) ||
    typeof challengeToken !== "string" ||
    typeof signature !== "string"
  ) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  const normEmail = normalizeEmail(email);
  // Delivery-language preference — only pt/en supported, default pt. Optional
  // and NOT bound by the signature (a non-sensitive preference, not identity).
  const prefLang = lang === "en" ? "en" : "pt";

  // 1. Challenge SHAPE — HMAC over (domain, pubkey, email, action, nonce,
  //    issuedAt) + TTL. Single-use is enforced at step 3 (post-signature) so a
  //    bad-signature submission can't burn a legitimate user's nonce.
  const challenge = verifyEmailChallengeShape({
    secret,
    domain: getNotifyDomain(),
    pubkey,
    email: normEmail,
    action,
    nonce,
    issuedAt,
    challengeToken,
  });
  if (!challenge.ok) {
    return NextResponse.json({ error: "challenge_rejected" }, { status: 401 });
  }

  // 2. Signature must be a valid ed25519 sig of the exact message by pubkey.
  let sigBytes: Uint8Array;
  try {
    sigBytes = new Uint8Array(Buffer.from(signature, "base64"));
  } catch {
    return NextResponse.json({ error: "invalid_signature_encoding" }, { status: 400 });
  }
  if (!verifySignInSignature(pubkey, challenge.message, sigBytes)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  // 3. Single-use — consume the token atomically (insert-or-conflict). The
  //    shared store is a generic consumed-token sink; the email token's HMAC is
  //    disjoint from any admin token's, so the two never collide.
  const firstUse = await getChallengeStore().consume(
    challengeToken,
    issuedAt + EMAIL_CHALLENGE_TTL_MS,
  );
  if (!firstUse) {
    return NextResponse.json({ error: "challenge_rejected" }, { status: 401 });
  }

  // 4. Apply the effect.
  const store = getEmailStore();
  if (action === "subscribe") {
    await store.subscribe(pubkey, normEmail, challengeToken, prefLang);
    return NextResponse.json({ ok: true, action, optedIn: true, lang: prefLang });
  }
  const existed = await store.unsubscribe(pubkey, challengeToken);
  return NextResponse.json({ ok: true, action, optedIn: false, existed });
}

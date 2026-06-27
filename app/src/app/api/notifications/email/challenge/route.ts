// POST /api/notifications/email/challenge — issue a SIWS challenge for binding
// (or clearing) an email on a wallet. Stateless (HMAC-bound over wallet + email
// + action); the client signs the returned `message` and posts it back to
// POST /api/notifications/email. The notification twin of the admin nonce route.
//
// Dark unless EMAIL_NOTIFICATIONS_ENABLED=true. Rate-limited per client to keep
// challenge issuance from being a DoS / email-enumeration channel.

import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { clientKeyFromRequest } from "@/lib/admin/rateLimit";
import { getRateLimitStore } from "@/lib/admin/sharedStore";
import {
  emailNotificationsEnabled,
  getNotifyDomain,
  getNotifySecret,
  isValidEmail,
  normalizeEmail,
} from "@/lib/notifications/config";
import {
  EMAIL_CHALLENGE_TTL_MS,
  issueEmailChallenge,
  type EmailAction,
} from "@/lib/notifications/emailChallenge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RL_WINDOW_MS = 60_000;
const RL_MAX = Math.max(1, Number(process.env.NOTIFY_RL_CHALLENGE_PER_MIN ?? 10));

function isEmailAction(v: unknown): v is EmailAction {
  return v === "subscribe" || v === "unsubscribe";
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!emailNotificationsEnabled()) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 404 });
  }

  const clientKey = clientKeyFromRequest(req);
  const rl = await getRateLimitStore().check({
    key: `notify-email-challenge:${clientKey}`,
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
  const { pubkey, email, action } = body as {
    pubkey?: unknown;
    email?: unknown;
    action?: unknown;
  };
  if (typeof pubkey !== "string" || typeof email !== "string" || !isEmailAction(action)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  try {
    new PublicKey(pubkey); // reject non-base58 / wrong-length early
  } catch {
    return NextResponse.json({ error: "invalid_pubkey" }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const challenge = issueEmailChallenge({
    secret,
    domain: getNotifyDomain(),
    pubkey,
    email: normalizeEmail(email),
    action,
  });
  return NextResponse.json({
    pubkey: challenge.pubkey,
    email: challenge.email,
    action: challenge.action,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.issuedAt + EMAIL_CHALLENGE_TTL_MS,
    message: challenge.message,
    challengeToken: challenge.challengeToken,
  });
}

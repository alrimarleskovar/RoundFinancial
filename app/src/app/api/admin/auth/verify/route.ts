// POST /api/admin/auth/verify — verify a signed SIWS challenge and, if the
// pubkey is allowlisted, mint an httpOnly session cookie. ADR 0009 §1.
//
// Rate-limited per client (RoundFi internal audit follow-up) — the
// stricter cap (5/min/IP vs the nonce endpoint's 10) reflects that an
// attacker shouldn't need many attempts: each /verify involves a
// signed message from a wallet the attacker doesn't control. Override
// via ADMIN_RL_VERIFY_PER_MIN.

import { NextResponse } from "next/server";

import { getAdminDomain, getSessionSecret, resolveAllowlist } from "@/lib/admin/auth";
import { isAllowed } from "@/lib/admin/allowlist";
import { CHALLENGE_TTL_MS, verifyChallengeShape } from "@/lib/admin/challenge";
import { clientKeyFromRequest } from "@/lib/admin/rateLimit";
import { getChallengeStore, getRateLimitStore } from "@/lib/admin/sharedStore";
import {
  ADMIN_SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  adminCookieOptions,
  signSession,
} from "@/lib/admin/session";
import { verifySignInSignature } from "@/lib/admin/siws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERIFY_RL_WINDOW_MS = 60_000;
const VERIFY_RL_MAX = Math.max(1, Number(process.env.ADMIN_RL_VERIFY_PER_MIN ?? 5));

interface VerifyBody {
  pubkey?: unknown;
  nonce?: unknown;
  issuedAt?: unknown;
  challengeToken?: unknown;
  /** base64-encoded 64-byte ed25519 signature. */
  signature?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  const rl = await getRateLimitStore().check({
    key: `admin-auth-verify:${clientKeyFromRequest(req)}`,
    windowMs: VERIFY_RL_WINDOW_MS,
    max: VERIFY_RL_MAX,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  let secret: string;
  try {
    secret = getSessionSecret();
  } catch {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  let body: VerifyBody;
  try {
    body = (await req.json()) as VerifyBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { pubkey, nonce, issuedAt, challengeToken, signature } = body;
  if (
    typeof pubkey !== "string" ||
    typeof nonce !== "string" ||
    typeof issuedAt !== "number" ||
    typeof challengeToken !== "string" ||
    typeof signature !== "string"
  ) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  // 1. Challenge SHAPE — must be one we issued, unexpired. HMAC + TTL
  //    only; single-use is enforced at step 3 (after signature) so a
  //    bad-signature submission can't burn a legitimate user's nonce.
  const challenge = verifyChallengeShape({
    secret,
    domain: getAdminDomain(),
    pubkey,
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

  // 3. Single-use — consume the challenge token ATOMICALLY. The store's
  //    insert-or-conflict (Postgres) / set-add (memory) returns false on
  //    a replay. Consuming here (post-signature) prevents signature
  //    replay while keeping a bad-signature attempt from burning the
  //    nonce. The race between concurrent valid replays is resolved by
  //    the atomic insert: exactly one consume wins.
  const firstUse = await getChallengeStore().consume(challengeToken, issuedAt + CHALLENGE_TTL_MS);
  if (!firstUse) {
    return NextResponse.json({ error: "challenge_rejected" }, { status: 401 });
  }

  // 4. Authorization — pubkey must be allowlisted (env ∪ on-chain authority).
  const allowlist = await resolveAllowlist();
  if (!isAllowed(pubkey, allowlist)) {
    return NextResponse.json({ error: "not_allowlisted" }, { status: 403 });
  }

  // 5. Mint the session.
  const token = signSession({ secret, pubkey });
  const res = NextResponse.json({ ok: true, pubkey });
  res.cookies.set(ADMIN_SESSION_COOKIE, token, adminCookieOptions(SESSION_TTL_SECONDS));
  return res;
}

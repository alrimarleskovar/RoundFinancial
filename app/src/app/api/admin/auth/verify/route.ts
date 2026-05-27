// POST /api/admin/auth/verify — verify a signed SIWS challenge and, if the
// pubkey is allowlisted, mint an httpOnly session cookie. ADR 0009 §1.

import { NextResponse } from "next/server";

import { getAdminDomain, getSessionSecret, resolveAllowlist } from "@/lib/admin/auth";
import { isAllowed } from "@/lib/admin/allowlist";
import { verifyChallenge } from "@/lib/admin/challenge";
import { ADMIN_SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@/lib/admin/session";
import { verifySignInSignature } from "@/lib/admin/siws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface VerifyBody {
  pubkey?: unknown;
  nonce?: unknown;
  issuedAt?: unknown;
  challengeToken?: unknown;
  /** base64-encoded 64-byte ed25519 signature. */
  signature?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
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

  // 1. Challenge must be one we issued, unexpired, unused.
  const challenge = verifyChallenge({
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

  // 3. Authorization — pubkey must be allowlisted (env ∪ on-chain authority).
  const allowlist = await resolveAllowlist();
  if (!isAllowed(pubkey, allowlist)) {
    return NextResponse.json({ error: "not_allowlisted" }, { status: 403 });
  }

  // 4. Mint the session.
  const token = signSession({ secret, pubkey });
  const res = NextResponse.json({ ok: true, pubkey });
  res.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}

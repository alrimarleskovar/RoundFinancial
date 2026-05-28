// POST /api/admin/auth/nonce — issue a SIWS challenge for a pubkey.
// Stateless (HMAC-bound); the client signs the returned `message` and
// posts it back to /verify. ADR 0009 §1.

import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { getAdminDomain, getSessionSecret } from "@/lib/admin/auth";
import { CHALLENGE_TTL_MS, issueChallenge } from "@/lib/admin/challenge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let secret: string;
  try {
    secret = getSessionSecret();
  } catch {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const pubkey = (body as { pubkey?: unknown }).pubkey;
  if (typeof pubkey !== "string") {
    return NextResponse.json({ error: "missing_pubkey" }, { status: 400 });
  }
  try {
    new PublicKey(pubkey); // reject non-base58 / wrong-length input early
  } catch {
    return NextResponse.json({ error: "invalid_pubkey" }, { status: 400 });
  }

  const challenge = issueChallenge({ secret, domain: getAdminDomain(), pubkey });
  return NextResponse.json({
    pubkey: challenge.pubkey,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.issuedAt + CHALLENGE_TTL_MS,
    message: challenge.message,
    challengeToken: challenge.challengeToken,
  });
}

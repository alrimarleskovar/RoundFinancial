// POST /api/admin/auth/nonce — issue a SIWS challenge for a pubkey.
// Stateless (HMAC-bound); the client signs the returned `message` and
// posts it back to /verify. ADR 0009 §1.
//
// Rate-limited per client (RoundFi internal audit follow-up) — the
// canary previously exposed unlimited nonce issuance, a DoS surface
// and a soft enumeration channel. Defaults: 10 req/min/IP. Override
// via ADMIN_RL_NONCE_PER_MIN.

import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { getAdminDomain, getSessionSecret } from "@/lib/admin/auth";
import { CHALLENGE_TTL_MS, issueChallenge } from "@/lib/admin/challenge";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/admin/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NONCE_RL_WINDOW_MS = 60_000;
const NONCE_RL_MAX = Math.max(1, Number(process.env.ADMIN_RL_NONCE_PER_MIN ?? 10));

export async function POST(req: Request): Promise<NextResponse> {
  const rl = checkRateLimit({
    key: `admin-auth-nonce:${clientKeyFromRequest(req)}`,
    windowMs: NONCE_RL_WINDOW_MS,
    max: NONCE_RL_MAX,
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

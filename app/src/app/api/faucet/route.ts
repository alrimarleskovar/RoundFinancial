// POST /api/faucet — server-side devnet SOL faucet.
//
// The in-UI "Airdrop 1 SOL" button used to call connection.requestAirdrop()
// against the public devnet RPC (api.devnet.solana.com), whose faucet method
// is aggressively rate-limited → HTTP 429 "rate_limited" on the very first
// try, blocking onboarding for the team and testers. This route instead
// transfers SOL from a team-funded devnet keypair (SystemProgram.transfer),
// so the in-app faucet is deterministic and works 100% through the UI.
//
// Config (server-only env — set in Vercel, NOT NEXT_PUBLIC):
//   DEVNET_FAUCET_SECRET — the funded devnet keypair, as a base64-encoded
//     JSON byte array OR a raw JSON byte array string ("[12,34,...]").
//   SOLANA_RPC_URL (optional) — devnet RPC; defaults to the public devnet.
// The operator keeps the faucet keypair topped up (faucet.solana.com).
//
// Anti-abuse (stateless, devnet-only, low-stakes):
//   - amount capped at 1 SOL / request
//   - refuses if the recipient already holds >= 2 SOL ("you have enough"),
//     so a fresh 0-SOL wallet always passes but the keypair can't be drained
//     by repeat hits to one address
//   - short per-address in-memory cooldown (best-effort; resets on cold start)
//   - refuses (clear error) if the faucet keypair itself is low on SOL

import { NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AIRDROP_LAMPORTS = LAMPORTS_PER_SOL; // 1 SOL per request
const ALREADY_FUNDED_LAMPORTS = 2 * LAMPORTS_PER_SOL; // refuse if recipient >= 2 SOL
const FAUCET_MIN_RESERVE_LAMPORTS = LAMPORTS_PER_SOL / 100; // keep ~0.01 SOL for fees
const COOLDOWN_MS = 30_000;

// Per-address cooldown. Best-effort only: serverless functions are stateless
// across cold starts, so this is a soft guard layered on the balance gate
// (which is the real, stateless bound on abuse).
const lastRequestByAddress = new Map<string, number>();

function loadFaucetKeypair(): Keypair | null {
  const raw = process.env.DEVNET_FAUCET_SECRET;
  if (!raw) return null;
  try {
    // Accept either a raw JSON byte array or a base64-encoded one (the
    // shape the devnet-deploy workflow already uses for its secrets).
    const text = raw.trim().startsWith("[") ? raw : Buffer.from(raw, "base64").toString("utf-8");
    const bytes = Uint8Array.from(JSON.parse(text) as number[]);
    return Keypair.fromSecretKey(bytes);
  } catch {
    return null;
  }
}

function rpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com"
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  let address: string;
  try {
    const body = (await req.json()) as { address?: unknown };
    if (typeof body.address !== "string") {
      return NextResponse.json({ ok: false, reason: "missing_address" }, { status: 400 });
    }
    address = body.address;
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }

  let recipient: PublicKey;
  try {
    recipient = new PublicKey(address);
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_address" }, { status: 400 });
  }

  // Devnet-only helper — never let this run against mainnet.
  const url = rpcUrl();
  if (/mainnet/i.test(url)) {
    return NextResponse.json({ ok: false, reason: "mainnet_refused" }, { status: 400 });
  }

  const faucet = loadFaucetKeypair();
  if (!faucet) {
    // Secret missing/malformed — tell the UI to use the hosted-faucet
    // fallback link instead of failing opaquely.
    return NextResponse.json({ ok: false, reason: "faucet_unconfigured" }, { status: 503 });
  }

  const now = Date.now();
  const last = lastRequestByAddress.get(address);
  if (last && now - last < COOLDOWN_MS) {
    return NextResponse.json({ ok: false, reason: "cooldown" }, { status: 429 });
  }

  const connection = new Connection(url, "confirmed");

  try {
    const [recipientBalance, faucetBalance] = await Promise.all([
      connection.getBalance(recipient, "confirmed"),
      connection.getBalance(faucet.publicKey, "confirmed"),
    ]);

    if (recipientBalance >= ALREADY_FUNDED_LAMPORTS) {
      return NextResponse.json({ ok: false, reason: "already_funded" }, { status: 400 });
    }
    if (faucetBalance < AIRDROP_LAMPORTS + FAUCET_MIN_RESERVE_LAMPORTS) {
      return NextResponse.json({ ok: false, reason: "faucet_drained" }, { status: 503 });
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: faucet.publicKey,
        toPubkey: recipient,
        lamports: AIRDROP_LAMPORTS,
      }),
    );
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = faucet.publicKey;
    tx.sign(faucet);

    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );

    lastRequestByAddress.set(address, now);
    return NextResponse.json({ ok: true, signature });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, reason: message }, { status: 502 });
  }
}

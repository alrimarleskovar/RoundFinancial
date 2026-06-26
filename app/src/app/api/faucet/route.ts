// POST /api/faucet — server-side devnet faucet: SOL (tx fees) + USDC (to
// actually participate in pools). A tester clicks ONCE and is ready, fully
// through the UI — no per-tester config. The operator sets DEVNET_FAUCET_SECRET
// in Vercel ONCE and keeps the keypair stocked; every tester self-serves.
//
// This replaces connection.requestAirdrop() against the public devnet RPC,
// whose airdrop method 429s on the first try and never hands out USDC.
//
// Config (server-only env — set in Vercel, NOT NEXT_PUBLIC):
//   DEVNET_FAUCET_SECRET — the funded devnet keypair, as a base64-encoded
//     JSON byte array OR a raw JSON byte array string ("[12,34,...]").
//   SOLANA_RPC_URL (optional) — devnet RPC; defaults to the public devnet.
// The keypair holds devnet SOL + USDC; refill from faucet.solana.com /
// faucet.circle.com. Use a DEDICATED low-value keypair — NEVER the program
// upgrade authority (this key lives in a serverless env var).
//
// Per request (tops up only what the recipient is missing):
//   - 1 SOL    if the recipient has < 2 SOL
//   - 100 USDC if the recipient has < 100 USDC (creates their ATA if needed)
//   - refuses "already_funded" if both are already above threshold
// Partial funding is fine (SOL still given if the faucet is out of USDC).
//
// Anti-abuse (stateless, devnet-only, low-stakes): the balance gate above
// means a fresh wallet always passes but no single address can drain the
// keypair by hammering; plus a short per-address in-memory cooldown.

import { NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { DEVNET_USDC_MINT } from "@/lib/devnet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOL_DRIP = LAMPORTS_PER_SOL; // 1 SOL per request
const SOL_ALREADY_FUNDED = 2 * LAMPORTS_PER_SOL; // give SOL only if recipient < 2 SOL
const FAUCET_SOL_RESERVE = LAMPORTS_PER_SOL / 20; // keep ~0.05 SOL for fees + ATA rent

const USDC_DECIMALS = 6;
const USDC_DRIP = 100n * 10n ** BigInt(USDC_DECIMALS); // 100 USDC per request
const USDC_ALREADY_FUNDED = USDC_DRIP; // give USDC only if recipient < 100 USDC

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

async function usdcBalance(connection: Connection, owner: PublicKey): Promise<bigint> {
  try {
    const ata = getAssociatedTokenAddressSync(DEVNET_USDC_MINT, owner);
    const acct = await getAccount(connection, ata, "confirmed");
    return acct.amount;
  } catch {
    // No ATA (fresh wallet) or RPC blip → treat as zero.
    return 0n;
  }
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
    const [recipientSol, faucetSol, recipientUsdc] = await Promise.all([
      connection.getBalance(recipient, "confirmed"),
      connection.getBalance(faucet.publicKey, "confirmed"),
      usdcBalance(connection, recipient),
    ]);

    const needSol = recipientSol < SOL_ALREADY_FUNDED;
    const needUsdc = recipientUsdc < USDC_ALREADY_FUNDED;
    if (!needSol && !needUsdc) {
      return NextResponse.json({ ok: false, reason: "already_funded" }, { status: 400 });
    }

    // The faucet is the fee payer for the whole tx — without a little SOL it
    // can't pay fees or the recipient's ATA rent, so nothing can be sent.
    if (faucetSol < FAUCET_SOL_RESERVE) {
      return NextResponse.json({ ok: false, reason: "faucet_drained" }, { status: 503 });
    }

    const ixs: TransactionInstruction[] = [];
    let sentSol = 0;
    let sentUsdc = 0n;

    if (needSol && faucetSol >= SOL_DRIP + FAUCET_SOL_RESERVE) {
      ixs.push(
        SystemProgram.transfer({
          fromPubkey: faucet.publicKey,
          toPubkey: recipient,
          lamports: SOL_DRIP,
        }),
      );
      sentSol = SOL_DRIP;
    }

    if (needUsdc) {
      const faucetUsdc = await usdcBalance(connection, faucet.publicKey);
      if (faucetUsdc >= USDC_DRIP) {
        const faucetAta = getAssociatedTokenAddressSync(DEVNET_USDC_MINT, faucet.publicKey);
        const recipientAta = getAssociatedTokenAddressSync(DEVNET_USDC_MINT, recipient);
        ixs.push(
          // Idempotent: no-op if the recipient already has the ATA.
          createAssociatedTokenAccountIdempotentInstruction(
            faucet.publicKey,
            recipientAta,
            recipient,
            DEVNET_USDC_MINT,
          ),
          createTransferInstruction(
            faucetAta,
            recipientAta,
            faucet.publicKey,
            USDC_DRIP,
            [],
            TOKEN_PROGRAM_ID,
          ),
        );
        sentUsdc = USDC_DRIP;
      }
    }

    if (ixs.length === 0) {
      // The recipient needed something but the faucet couldn't cover it.
      const reason = needUsdc && !needSol ? "faucet_usdc_drained" : "faucet_drained";
      return NextResponse.json({ ok: false, reason }, { status: 503 });
    }

    const tx = new Transaction().add(...ixs);
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
    return NextResponse.json({
      ok: true,
      signature,
      sol: sentSol / LAMPORTS_PER_SOL,
      usdc: Number(sentUsdc) / 10 ** USDC_DECIMALS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, reason: message }, { status: 502 });
  }
}

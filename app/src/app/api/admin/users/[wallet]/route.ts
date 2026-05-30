// GET /api/admin/users/[wallet] — behavioral profile (the credit data).
// Indexer-derived behavioral view + chain-truth member counters + the
// CANONICAL on-chain ReputationProfile (level/score) via RPC. requireAdmin
// FIRST. Derived metrics are experimental; score/level is on-chain truth.

import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { fetchReputationProfileRaw } from "@roundfi/sdk";

import { requireAdmin } from "@/lib/admin/auth";
import { getPrisma } from "@roundfi/indexer/db";
import { computeIndexerHealth, getUserProfile } from "@roundfi/indexer/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Reputation {
  source: "on-chain";
  exists: boolean;
  level: number;
  score: string;
  onTimePayments: number;
  latePayments: number;
  defaults: number;
}

/** Canonical ReputationProfile via RPC (IDL-free). Absence ≡ a fresh wallet
 *  (level 1, score 0) per the program. null = RPC unavailable (UI says so). */
async function fetchReputation(wallet: string): Promise<Reputation | null> {
  try {
    const rpc = process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL;
    const repProgram = process.env.ROUNDFI_REPUTATION_PROGRAM_ID;
    if (!rpc || !repProgram) return null;
    const raw = await fetchReputationProfileRaw(
      new Connection(rpc, "confirmed"),
      new PublicKey(repProgram),
      new PublicKey(wallet),
    );
    if (!raw) {
      return {
        source: "on-chain",
        exists: false,
        level: 1,
        score: "0",
        onTimePayments: 0,
        latePayments: 0,
        defaults: 0,
      };
    }
    return {
      source: "on-chain",
      exists: true,
      level: raw.level,
      score: raw.score.toString(),
      onTimePayments: raw.onTimePayments,
      latePayments: raw.latePayments,
      defaults: raw.defaults,
    };
  } catch {
    return null;
  }
}

export async function GET(
  req: Request,
  // Next 15: dynamic route `params` is async (a Promise).
  { params }: { params: Promise<{ wallet: string }> },
): Promise<NextResponse> {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { wallet } = await params;
  const prisma = getPrisma();
  const profile = await getUserProfile(prisma, wallet);
  if (!profile) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const [reputation, indexer] = await Promise.all([
    fetchReputation(wallet),
    computeIndexerHealth(prisma),
  ]);

  return NextResponse.json({
    ...profile,
    reputation, // canonical on-chain level/score (null = RPC unavailable)
    indexer,
    servedAtUnix: Math.floor(Date.now() / 1000),
  });
}

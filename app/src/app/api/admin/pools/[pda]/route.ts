// GET /api/admin/pools/[pda] — pool detail: structural state + on-chain
// member counters (from the indexer DB) + the per-cycle BEHAVIORAL timeline
// (events-derived; gate #5 cleared 2026-05-27) + a best-effort LIVE on-chain
// pool snapshot via RPC (SSOT split — ADR 0009 §3). requireAdmin FIRST.

import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { fetchPoolRaw } from "@roundfi/sdk";

import { requireAdmin } from "@/lib/admin/auth";
import { getPrisma } from "@roundfi/indexer/db";
import { computeIndexerHealth, getPoolDetail } from "@roundfi/indexer/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Best-effort LIVE pool snapshot from RPC (IDL-free decode). null on any
 *  failure / bad pda — the UI labels it "live indisponível", never fakes it. */
async function fetchLivePool(pda: string): Promise<Record<string, unknown> | null> {
  try {
    const rpc = process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL;
    if (!rpc) return null;
    const raw = await fetchPoolRaw(new Connection(rpc, "confirmed"), new PublicKey(pda));
    if (!raw) return null;
    return {
      status: raw.status,
      currentCycle: raw.currentCycle,
      membersJoined: raw.membersJoined,
      defaultedMembers: raw.defaultedMembers,
      nextCycleAtUnix: Number(raw.nextCycleAt),
      totalContributed: raw.totalContributed.toString(),
    };
  } catch {
    return null;
  }
}

export async function GET(
  req: Request,
  { params }: { params: { pda: string } },
): Promise<NextResponse> {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const prisma = getPrisma();
  const detail = await getPoolDetail(prisma, params.pda);
  if (!detail) return NextResponse.json({ error: "pool_not_found" }, { status: 404 });

  const [live, indexer] = await Promise.all([
    fetchLivePool(params.pda),
    computeIndexerHealth(prisma),
  ]);

  return NextResponse.json({
    ...detail,
    live, // fresh RPC snapshot to cross-check vs the DB (null = unavailable)
    indexer,
    servedAtUnix: Math.floor(Date.now() / 1000),
  });
}

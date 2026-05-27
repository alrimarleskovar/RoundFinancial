// GET /api/admin/canary — protocol + indexer health overview (ADR 0009
// Phase 1). Structural only: behavioral aggregates stay gated until the
// on-devnet smoke (#5). requireAdmin runs FIRST (gate on the endpoint).

import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";

import { requireAdmin } from "@/lib/admin/auth";
import { getPrisma } from "@roundfi/indexer/db";
import { getCanaryOverview } from "@roundfi/indexer/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live cluster slot for the indexer-lag computation. Best-effort. */
async function fetchClusterSlot(): Promise<number | null> {
  try {
    const rpc = process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL;
    if (!rpc) return null;
    return await new Connection(rpc, "finalized").getSlot("finalized");
  } catch {
    return null;
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const overview = await getCanaryOverview(getPrisma(), await fetchClusterSlot());
  return NextResponse.json({ overview, servedAtUnix: Math.floor(Date.now() / 1000) });
}

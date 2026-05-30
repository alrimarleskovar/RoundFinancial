// GET /api/admin/pools — structural pools table from the indexer DB (ADR
// 0009 Phase 1). requireAdmin runs FIRST. The per-pool behavioral timeline
// (events-derived) is a separate, gated endpoint; this list is structural.

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";
import { getPrisma } from "@roundfi/indexer/db";
import { computeIndexerHealth, listPoolsForAdmin } from "@roundfi/indexer/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const prisma = getPrisma();
  const [pools, indexer] = await Promise.all([
    listPoolsForAdmin(prisma),
    computeIndexerHealth(prisma),
  ]);
  // `indexer.lastProjectionUnix` / `lastUpdateUnix` let the UI label how
  // fresh this DB-sourced table is (events is batch-projected, not live).
  return NextResponse.json({ pools, indexer, servedAtUnix: Math.floor(Date.now() / 1000) });
}

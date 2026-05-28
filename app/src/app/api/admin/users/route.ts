// GET /api/admin/users — indexed wallets with behavioral summary (ADR 0009).
// Identity = wallet. The per-wallet behavioral profile is the credit data —
// served only behind requireAdmin (runs FIRST).

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";
import { getPrisma } from "@roundfi/indexer/db";
import { computeIndexerHealth, listUsersForAdmin } from "@roundfi/indexer/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const prisma = getPrisma();
  const [users, indexer] = await Promise.all([
    listUsersForAdmin(prisma),
    computeIndexerHealth(prisma),
  ]);
  return NextResponse.json({ users, indexer, servedAtUnix: Math.floor(Date.now() / 1000) });
}

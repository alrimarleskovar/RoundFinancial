// GET /api/admin/insights — Insights v0 (ADR 0010). Four pre-defined
// analytical views, each behind a sample-size gate. requireAdmin FIRST —
// behavioral data is "credit data" (LGPD/GDPR/FCRA framing).

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";
import { getPrisma } from "@roundfi/indexer/db";
import { getInsights } from "@roundfi/indexer/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const insights = await getInsights(getPrisma());
  return NextResponse.json({ insights, servedAtUnix: Math.floor(Date.now() / 1000) });
}

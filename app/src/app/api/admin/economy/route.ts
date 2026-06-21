// GET /api/admin/economy — protocol-wide financial + risk + moat + health
// aggregates (ADR 0009). INSTRUMENTATION, not traction: on devnet these are
// test/seed numbers; the same panel measures mainnet. requireAdmin FIRST.

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";
import { getPrisma } from "@roundfi/indexer/db";
import { getEconomy, type EconomyFilter } from "@roundfi/indexer/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseFilter(sp: URLSearchParams): EconomyFilter {
  const f: EconomyFilter = {};
  const status = sp.get("status");
  const level = Number(sp.get("level"));
  const from = sp.get("fromUnix");
  const to = sp.get("toUnix");
  if (
    status === "Forming" ||
    status === "Active" ||
    status === "Completed" ||
    status === "Liquidated" ||
    status === "Closed"
  ) {
    f.status = status;
  }
  if (level === 1 || level === 2 || level === 3) f.level = level;
  if (from && Number.isFinite(Number(from))) f.fromUnix = Number(from);
  if (to && Number.isFinite(Number(to))) f.toUnix = Number(to);
  return f;
}

export async function GET(req: Request): Promise<NextResponse> {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const filter = parseFilter(new URL(req.url).searchParams);
  const economy = await getEconomy(getPrisma(), filter);
  return NextResponse.json({ economy, filter, servedAtUnix: Math.floor(Date.now() / 1000) });
}

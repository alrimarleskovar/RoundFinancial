// GET /api/admin/events — filterable, paginated "black-box recorder" over
// the normalized events table (ADR 0009). requireAdmin FIRST. Behavioral
// data → auth-only; staleness surfaced (events is batch-projected).

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";
import { getPrisma } from "@roundfi/indexer/db";
import { computeIndexerHealth, queryEvents, type EventFilter } from "@roundfi/indexer/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Parse the shared event filter from URL search params. */
export function parseEventFilter(sp: URLSearchParams): EventFilter {
  const f: EventFilter = {};
  const pool = sp.get("poolPda");
  const wallet = sp.get("subjectWallet");
  const type = sp.get("eventType");
  const timing = sp.get("timing");
  const from = sp.get("fromUnix");
  const to = sp.get("toUnix");
  if (pool) f.poolPda = pool;
  if (wallet) f.subjectWallet = wallet;
  if (type === "Contribute" || type === "Claim" || type === "Default") f.eventType = type;
  if (timing === "on_time" || timing === "grace" || timing === "late") f.timing = timing;
  if (from && Number.isFinite(Number(from))) f.fromUnix = Number(from);
  if (to && Number.isFinite(Number(to))) f.toUnix = Number(to);
  return f;
}

export async function GET(req: Request): Promise<NextResponse> {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const sp = new URL(req.url).searchParams;
  const filter = parseEventFilter(sp);
  const limit = Number(sp.get("limit") ?? 50);
  const offset = Number(sp.get("offset") ?? 0);

  const prisma = getPrisma();
  const [result, indexer] = await Promise.all([
    queryEvents(prisma, filter, { limit, offset }),
    computeIndexerHealth(prisma),
  ]);
  return NextResponse.json({
    ...result,
    filter,
    indexer,
    servedAtUnix: Math.floor(Date.now() / 1000),
  });
}

// GET /api/admin/users/[wallet]/reputation-score — off-chain v5.2 score
// (Phase C.3.3). requireAdmin FIRST. Calls the indexer's loadSubjectScore
// directly (same Postgres handle, no extra HTTP hop), returns the
// formula_versao-tagged ScoreSummary unchanged.
//
// On a Postgres outage we degrade gracefully: 503 with the diagnostic
// instead of a 500, so the UI can render "indexer unavailable" rather
// than crashing the whole profile page.

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";
import { getPrisma } from "@roundfi/indexer/db";
import { loadSubjectScore } from "@roundfi/indexer/reputation-score";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Solana base58 pubkey shape (also enforced server-side in the indexer's
// own Fastify route — duplicated here so a malformed wallet 400s without
// hitting the DB).
const SUBJECT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface RouteContext {
  params: Promise<{ wallet: string }>;
}

export async function GET(req: Request, ctx: RouteContext): Promise<NextResponse> {
  const gate = await requireAdmin(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const { wallet } = await ctx.params;
  if (!SUBJECT_RE.test(wallet)) {
    return NextResponse.json({ error: "invalid_subject" }, { status: 400 });
  }

  try {
    const prisma = await getPrisma();
    const summary = await loadSubjectScore(prisma, wallet);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    // Postgres unreachable / migration missing → 503 so the UI knows the
    // service is the issue, not the wallet. 500 would suggest a bug in
    // the route itself.
    return NextResponse.json({ error: "indexer_unavailable", detail: message }, { status: 503 });
  }
}

// GET /api/admin/ping — protected endpoint template. Every Phase-1 data
// route (pools, users, events) follows this exact shape: call requireAdmin
// FIRST and return its 401/403/500 before doing any work, so the gate is on
// the ENDPOINT, not the UI (ADR 0009 §1).

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const gate = await requireAdmin(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  return NextResponse.json({ pong: true, pubkey: gate.pubkey });
}

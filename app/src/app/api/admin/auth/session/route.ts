// GET /api/admin/auth/session — report whether the caller has a valid,
// allowlisted admin session. Used by the UI to decide whether to show the
// sign-in prompt; the actual gate lives on each data endpoint. ADR 0009 §1.

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const gate = await requireAdmin(req);
  if (!gate.ok) {
    return NextResponse.json({ authenticated: false });
  }
  return NextResponse.json({ authenticated: true, pubkey: gate.pubkey });
}

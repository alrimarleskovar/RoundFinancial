// GET /api/admin/events/export — export the filtered events as CSV or JSON.
// The export is the product asset + sensitive credit data: requireAdmin
// FIRST, and EVERY export is recorded in the append-only export_audit trail
// (who/when/filter/count) before the payload is returned (ADR 0009).

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";
import { getPrisma } from "@roundfi/indexer/db";
import { eventsToCsv, exportEventRows, recordExportAudit } from "@roundfi/indexer/admin";

import { parseEventFilter } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse | Response> {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const sp = new URL(req.url).searchParams;
  const filter = parseEventFilter(sp);
  const format = sp.get("format") === "json" ? "json" : "csv";

  const prisma = getPrisma();
  const rows = await exportEventRows(prisma, filter);

  // Audit FIRST (who exported what, when, how many) — the export is the moat.
  await recordExportAudit(prisma, { actor: gate.pubkey, format, filter, rowCount: rows.length });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (format === "json") {
    return new Response(JSON.stringify({ filter, rowCount: rows.length, rows }, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="roundfi-events-${stamp}.json"`,
      },
    });
  }
  return new Response(eventsToCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="roundfi-events-${stamp}.csv"`,
    },
  });
}

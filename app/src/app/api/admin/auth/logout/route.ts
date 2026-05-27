// POST /api/admin/auth/logout — clear the admin session cookie.

import { NextResponse } from "next/server";

import { ADMIN_SESSION_COOKIE, adminCookieOptions } from "@/lib/admin/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE, "", adminCookieOptions(0));
  return res;
}

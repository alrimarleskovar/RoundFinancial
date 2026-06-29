// GET /api/notifications/email/status?pubkey=<base58> — read whether a wallet
// already has an email-alert binding, so the Conexões card can REHYDRATE its
// subscribed state after a reload (the opt-in is wallet-bound + durable in
// Postgres, not session-bound). Dark unless EMAIL_NOTIFICATIONS_ENABLED=true.
//
// Read-only. On devnet this is intentionally unauthenticated: the email is bound
// to a PUBLIC wallet for notifications (low-sensitivity) and the whole feature
// is dark on mainnet. If it graduates, a sign-to-read gate or a masked address
// is the hardening — tracked, not needed for the devnet team test.

import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { emailNotificationsEnabled } from "@/lib/notifications/config";
import { getEmailStore } from "@/lib/notifications/emailStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  if (!emailNotificationsEnabled()) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 404 });
  }

  const pubkey = new URL(req.url).searchParams.get("pubkey");
  if (!pubkey) {
    return NextResponse.json({ error: "missing_pubkey" }, { status: 400 });
  }
  try {
    new PublicKey(pubkey); // reject non-base58 / wrong-length early
  } catch {
    return NextResponse.json({ error: "invalid_pubkey" }, { status: 400 });
  }

  try {
    const rec = await getEmailStore().get(pubkey);
    if (!rec || !rec.optedIn) return NextResponse.json({ optedIn: false });
    return NextResponse.json({ optedIn: true, email: rec.email, lang: rec.lang });
  } catch {
    // A store/DB hiccup must not break the card. Report not-subscribed and let
    // the user (re)subscribe — the opt-in upsert is idempotent, so it's safe.
    return NextResponse.json({ optedIn: false });
  }
}

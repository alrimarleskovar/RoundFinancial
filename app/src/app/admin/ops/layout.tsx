"use client";

// /admin/ops — operational console shell (ADR 0009). Separate namespace +
// data path from the Demo Studio (/admin) and the cranker (/admin/cranker):
// this console reads REAL indexer data behind a server-side SIWS gate; the
// studio uses isolated fake state. They never mix. i18n: reuses the app's
// @/lib/i18n (PT default, EN toggle) — only /admin/ops chrome is translated.

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useAdminSession } from "@/lib/admin/useAdminSession";
import { RFILogoMark } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { useI18n, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { shortAddr, useWallet } from "@/lib/wallet";

const NAV = [
  { href: "/admin/ops", key: "adminops.nav.canary", icon: Icons.pulse },
  { href: "/admin/ops/pools", key: "adminops.nav.pools", icon: Icons.layers },
  { href: "/admin/ops/users", key: "adminops.nav.users", icon: Icons.people },
  { href: "/admin/ops/events", key: "adminops.nav.events", icon: Icons.listBell },
  { href: "/admin/ops/economy", key: "adminops.nav.economy", icon: Icons.chart },
  { href: "/admin/ops/insights", key: "adminops.nav.insights", icon: Icons.trend },
];

function errorText(
  code: string | null,
  t: (k: string, p?: Record<string, string>) => string,
): string | null {
  if (!code) return null;
  if (code === "bad_signature" || code === "challenge_rejected")
    return t("adminops.err.bad_signature");
  if (code === "connect_wallet" || code === "wallet_cannot_sign" || code === "not_allowlisted") {
    return t(`adminops.err.${code}`);
  }
  return t("adminops.err.generic", { code });
}

function SignInPanel({ session }: { session: ReturnType<typeof useAdminSession> }) {
  const { tokens } = useTheme();
  const t = useT();
  const wallet = useWallet();
  const err = errorText(session.error, t);

  return (
    <div style={{ maxWidth: 440, margin: "64px auto", textAlign: "center" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: tokens.text }}>
        {t("adminops.signin.title")}
      </h1>
      <p style={{ fontSize: 14, color: tokens.text2, lineHeight: 1.6, margin: "12px 0 24px" }}>
        {t("adminops.signin.body")}
      </p>

      {!wallet.publicKey ? (
        <button
          type="button"
          onClick={() => void wallet.connect()}
          style={primaryBtn(tokens.green, tokens.bg)}
        >
          {t("adminops.signin.connect")}
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 12, color: tokens.muted }}>{shortAddr(wallet.publicKey)}</div>
          <button
            type="button"
            disabled={session.busy || !session.canSign}
            onClick={() => void session.signIn()}
            style={primaryBtn(tokens.green, tokens.bg, session.busy || !session.canSign)}
          >
            {session.busy ? t("adminops.signin.signing") : t("adminops.signin.enter")}
          </button>
        </div>
      )}

      {err ? <p style={{ marginTop: 16, fontSize: 13, color: tokens.red }}>{err}</p> : null}
    </div>
  );
}

function primaryBtn(bg: string, fg: string, disabled = false): React.CSSProperties {
  return {
    padding: "11px 20px",
    borderRadius: 10,
    background: bg,
    color: fg,
    border: "none",
    fontWeight: 700,
    fontSize: 14,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

export default function OpsLayout({ children }: { children: ReactNode }) {
  const { tokens } = useTheme();
  const t = useT();
  const { lang, setLang } = useI18n();
  const session = useAdminSession();
  const pathname = usePathname();

  const langToggle = (
    <button
      type="button"
      onClick={() => setLang(lang === "pt" ? "en" : "pt")}
      title={lang === "pt" ? "Switch to English" : "Mudar para Português"}
      style={{
        background: "none",
        border: `1px solid ${tokens.borderStr}`,
        color: tokens.text2,
        borderRadius: 8,
        padding: "6px 11px",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {lang === "pt" ? "EN" : "PT"}
    </button>
  );

  return (
    <main
      style={{
        minHeight: "100vh",
        background: tokens.bg,
        color: tokens.text,
        fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
      }}
    >
      <header
        style={{
          borderBottom: `1px solid ${tokens.border}`,
          padding: "18px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <RFILogoMark size={30} />
          <div>
            <div
              style={{
                fontFamily: "Syne, system-ui",
                fontWeight: 700,
                fontSize: 16,
                letterSpacing: "-0.02em",
              }}
            >
              Round<span style={{ fontWeight: 800 }}>Fi</span>{" "}
              <span style={{ color: tokens.teal, fontWeight: 600 }}>Canary Ops</span>
            </div>
            <div style={{ fontSize: 12, color: tokens.muted }}>{t("adminops.subtitle")}</div>
          </div>
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            fontSize: 12,
            color: tokens.text2,
          }}
        >
          {langToggle}
          {session.status === "authed" ? (
            <span style={{ display: "inline-flex", gap: 12, alignItems: "center" }}>
              <span style={{ color: tokens.green }}>● {shortAddr(session.pubkey)}</span>
              <button
                type="button"
                onClick={() => void session.signOut()}
                style={{
                  background: "none",
                  border: `1px solid ${tokens.border}`,
                  color: tokens.text2,
                  borderRadius: 8,
                  padding: "5px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {t("adminops.signOut")}
              </button>
            </span>
          ) : session.status === "loading" ? (
            <span style={{ color: tokens.muted }}>…</span>
          ) : (
            <span style={{ color: tokens.muted }}>{t("adminops.notAuthed")}</span>
          )}
        </div>
      </header>

      {session.status === "authed" ? (
        <>
          <nav style={{ display: "flex", gap: 6, padding: "14px 28px 0" }}>
            {NAV.map((item) => {
              const active =
                item.href === "/admin/ops"
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 14px 12px",
                    fontSize: 14,
                    fontWeight: 600,
                    textDecoration: "none",
                    color: active ? tokens.text : tokens.text2,
                    background: active ? tokens.surface3 : "transparent",
                    borderRadius: "10px 10px 0 0",
                    borderBottom: `2px solid ${active ? tokens.green : "transparent"}`,
                    transition: "color 120ms, background 120ms",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      color: active ? tokens.green : tokens.muted,
                    }}
                  >
                    <Icon size={16} sw={1.8} />
                  </span>
                  {t(item.key)}
                </Link>
              );
            })}
          </nav>
          <div style={{ padding: "28px", maxWidth: 1100, margin: "0 auto" }}>{children}</div>
        </>
      ) : session.status === "loading" ? (
        <div style={{ padding: 64, textAlign: "center", color: tokens.muted }}>
          {t("adminops.loading")}
        </div>
      ) : (
        <SignInPanel session={session} />
      )}
    </main>
  );
}

"use client";

// /admin/ops — operational console shell (ADR 0009). Separate namespace +
// data path from the Demo Studio (/admin) and the cranker (/admin/cranker):
// this console reads REAL indexer data behind a server-side SIWS gate; the
// studio uses isolated fake state. They never mix.

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useAdminSession } from "@/lib/admin/useAdminSession";
import { useTheme } from "@/lib/theme";
import { shortAddr, useWallet } from "@/lib/wallet";

const NAV = [
  { href: "/admin/ops", label: "Canary" },
  { href: "/admin/ops/pools", label: "Pools" },
  { href: "/admin/ops/users", label: "Usuários" },
  { href: "/admin/ops/events", label: "Eventos" },
];

function errorText(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "connect_wallet":
      return "Conecte uma carteira antes de assinar.";
    case "wallet_cannot_sign":
      return "Esta carteira não suporta assinatura de mensagem (SIWS).";
    case "not_allowlisted":
      return "Carteira autenticada, mas fora da allowlist de operadores.";
    case "bad_signature":
    case "challenge_rejected":
      return "Falha na verificação da assinatura. Tente novamente.";
    default:
      return `Erro: ${code}`;
  }
}

function SignInPanel({ session }: { session: ReturnType<typeof useAdminSession> }) {
  const { tokens } = useTheme();
  const wallet = useWallet();
  const err = errorText(session.error);

  return (
    <div style={{ maxWidth: 440, margin: "64px auto", textAlign: "center" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: tokens.text }}>
        Acesso restrito
      </h1>
      <p style={{ fontSize: 14, color: tokens.text2, lineHeight: 1.6, margin: "12px 0 24px" }}>
        Console operacional interno. Autentique com a carteira de operador (assinatura verificada no
        servidor — nenhum segredo trafega pelo cliente).
      </p>

      {!wallet.publicKey ? (
        <button
          type="button"
          onClick={() => void wallet.connect()}
          style={primaryBtn(tokens.green, tokens.bg)}
        >
          Conectar carteira
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
            {session.busy ? "Assinando…" : "Entrar — assinar mensagem"}
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
  const session = useAdminSession();
  const pathname = usePathname();

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
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>RoundFi — Canary Ops</div>
          <div style={{ fontSize: 12, color: tokens.muted }}>console operacional · read-only</div>
        </div>
        <div style={{ fontSize: 12, color: tokens.text2 }}>
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
                sair
              </button>
            </span>
          ) : session.status === "loading" ? (
            <span style={{ color: tokens.muted }}>…</span>
          ) : (
            <span style={{ color: tokens.muted }}>não autenticado</span>
          )}
        </div>
      </header>

      {session.status === "authed" ? (
        <>
          <nav style={{ display: "flex", gap: 4, padding: "12px 28px 0" }}>
            {NAV.map((item) => {
              // Exact match for the root tab; prefix match for sections so
              // a detail page (/pools/[pda], /users/[wallet]) keeps its tab lit.
              const active =
                item.href === "/admin/ops"
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    padding: "8px 14px",
                    fontSize: 13,
                    fontWeight: 600,
                    textDecoration: "none",
                    color: active ? tokens.text : tokens.muted,
                    borderBottom: `2px solid ${active ? tokens.green : "transparent"}`,
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div style={{ padding: "28px", maxWidth: 1100, margin: "0 auto" }}>{children}</div>
        </>
      ) : session.status === "loading" ? (
        <div style={{ padding: 64, textAlign: "center", color: tokens.muted }}>carregando…</div>
      ) : (
        <SignInPanel session={session} />
      )}
    </main>
  );
}

"use client";

import { useState, type MouseEvent } from "react";

import { MonoLabel, RFIPill } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import {
  ConnectionGlyph,
  type GlyphKind,
} from "@/components/carteira/ConnectionGlyph";
import { ManageConnectionModal } from "@/components/carteira/ManageConnectionModal";
import { PhantomFaucet } from "@/components/carteira/PhantomFaucet";
import { useI18n, useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";
import type { ConnId, ConnRuntime, ConnStatus } from "@/lib/connections";
import type { Tone } from "@/data/carteira";
import type { WalletView } from "@/lib/wallet";

// Single connection card. Expand on click; phantom flows through the
// real wallet hook, mocks (civic / kamino / solflare / pix) flow through
// the local mockConnecting state + ConnectionsProvider runtime.

export interface ConnMeta {
  l: string;
  v: string;
  mono?: boolean;
  link?: string | null;
}

export interface ConnSpec {
  id: "phantom" | ConnId;
  name: string;
  tone: Tone;
  tagline: string;
  glyph: GlyphKind;
  meta: ConnMeta[];
  perms: string[];
  live?: boolean;
  featured?: boolean;
}

interface Props {
  c: ConnSpec;
  runtime: ConnRuntime; // for mocks
  wallet: WalletView | null; // non-null only for phantom
  open: boolean;
  onToggle: () => void;
  onMockConnect: (id: ConnId, since: string) => void;
  onMockDisconnect: (id: ConnId) => void;
}

export function ConnectionCard({
  c,
  runtime,
  wallet,
  open,
  onToggle,
  onMockConnect,
  onMockDisconnect,
}: Props) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { lang } = useI18n();

  const tc = ((): string => {
    switch (c.tone) {
      case "g": return tokens.green;
      case "t": return tokens.teal;
      case "p": return tokens.purple;
      case "a": return tokens.amber;
      case "r": return tokens.red;
    }
  })();

  const isPhantom = c.id === "phantom" && wallet != null;
  const status: ConnStatus | "connecting" = isPhantom
    ? wallet.status === "error"
      ? "disconnected"
      : (wallet.status as ConnStatus | "connecting")
    : (runtime.status as ConnStatus);
  const isConnected = status === "connected";
  const isConnecting = isPhantom && wallet?.status === "connecting";
  const isPending = status === "pending";
  const notInstalled = isPhantom && !wallet?.isInstalled;

  const [mockConnecting, setMockConnecting] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const busy = isPhantom ? !!isConnecting : mockConnecting;

  const doConnect = (e: MouseEvent) => {
    e.stopPropagation();
    if (isPhantom && wallet) {
      if (notInstalled) {
        window.open("https://phantom.app/", "_blank", "noopener,noreferrer");
        return;
      }
      wallet.connect();
      return;
    }
    if (c.id === "phantom") return;
    setMockConnecting(true);
    setTimeout(() => {
      setMockConnecting(false);
      const now = new Date();
      const month = now.toLocaleDateString(lang === "pt" ? "pt-BR" : "en-US", {
        month: "short",
        year: "numeric",
      });
      onMockConnect(c.id as ConnId, month);
    }, 900);
  };

  const doDisconnect = (e: MouseEvent) => {
    e.stopPropagation();
    if (isPhantom && wallet) {
      wallet.disconnect();
      return;
    }
    if (c.id !== "phantom") onMockDisconnect(c.id as ConnId);
  };

  return (
    <div
      style={{
        ...glass,
        borderRadius: 16,
        border: `1px solid ${open ? `${tc}4D` : (glass.border as string)}`,
        overflow: "hidden",
        transition: "all 180ms ease",
        opacity: !isConnected && !isPending ? 0.82 : 1,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          padding: 18,
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          display: "grid",
          gridTemplateColumns: "48px 1fr auto auto",
          gap: 14,
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            flexShrink: 0,
            background: `linear-gradient(135deg, ${tc}22, ${tc}0A)`,
            border: `1px solid ${tc}4D`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            filter: !isConnected && !isPending ? "grayscale(0.4)" : "none",
          }}
        >
          <ConnectionGlyph kind={c.glyph} color={tc} size={22} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: tokens.text,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {c.name}
            {!c.live && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  color: tokens.amber,
                  background: `${tokens.amber}1A`,
                  border: `1px solid ${tokens.amber}33`,
                  padding: "2px 6px",
                  borderRadius: 999,
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
                title={t("conn.demoTitle")}
              >
                {t("conn.demoBadge")}
              </span>
            )}
            {isConnected && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10,
                  color: tokens.green,
                  fontWeight: 500,
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: tokens.green,
                    boxShadow: `0 0 6px ${tokens.green}`,
                  }}
                />
                {t("conn.connected")}
              </span>
            )}
            {!isConnected && !isPending && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10,
                  color: tokens.muted,
                  fontWeight: 500,
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: tokens.muted,
                  }}
                />
                {t("conn.disconnected")}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: tokens.text2, marginTop: 3 }}>
            {c.tagline}
          </div>
        </div>
        {isConnected ? (
          <span
            style={{
              fontSize: 10,
              color: tokens.muted,
              fontFamily:
                "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            }}
          >
            {t("conn.since", { d: runtime.since ?? "—" })}
          </span>
        ) : isPending ? (
          <RFIPill tone="a">{t("conn.pending")}</RFIPill>
        ) : (
          <button
            type="button"
            onClick={doConnect}
            disabled={busy}
            style={{
              padding: "7px 13px",
              borderRadius: 9,
              cursor: busy ? "default" : "pointer",
              border: "none",
              background: `linear-gradient(135deg, ${tc}, ${tokens.teal})`,
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy
              ? t("conn.connecting")
              : notInstalled
              ? t("conn.phantom.installCTA")
              : t("conn.reconnect")}
          </button>
        )}
        <span
          style={{
            color: tokens.muted,
            fontSize: 12,
            transform: open ? "rotate(90deg)" : "rotate(0)",
            transition: "transform 180ms ease",
          }}
        >
          ›
        </span>
      </button>

      {open && (
        <div
          style={{
            padding: "0 18px 18px",
            borderTop: `1px solid ${tokens.border}`,
          }}
        >
          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
            }}
          >
            <div>
              <MonoLabel size={9}>{t("conn.details")}</MonoLabel>
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {c.meta.map((m) => (
                  <div
                    key={m.l}
                    style={{ display: "flex", flexDirection: "column" }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        color: tokens.muted,
                        fontFamily:
                          "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                      }}
                    >
                      {m.l}
                    </span>
                    {m.link ? (
                      <a
                        href={m.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: m.mono ? 11 : 12,
                          fontFamily: m.mono
                            ? "var(--font-jetbrains-mono), JetBrains Mono, monospace"
                            : "var(--font-dm-sans), DM Sans, sans-serif",
                          color: tc,
                          fontWeight: 500,
                          marginTop: 2,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          textDecoration: "none",
                        }}
                      >
                        {m.v}
                      </a>
                    ) : (
                      <span
                        style={{
                          fontSize: m.mono ? 11 : 12,
                          fontFamily: m.mono
                            ? "var(--font-jetbrains-mono), JetBrains Mono, monospace"
                            : "var(--font-dm-sans), DM Sans, sans-serif",
                          color: tokens.text,
                          fontWeight: 500,
                          marginTop: 2,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {m.v}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <MonoLabel size={9}>{t("conn.perms")}</MonoLabel>
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {c.perms.map((p) => (
                  <div
                    key={p}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      fontSize: 11,
                      color: tokens.text2,
                    }}
                  >
                    <Icons.check
                      size={12}
                      stroke={isConnected ? tc : tokens.muted}
                      sw={2}
                    />
                    <span>{p}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {isPhantom && wallet && isConnected && (
            <PhantomFaucet wallet={wallet} tc={tc} />
          )}

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            {isConnected ? (
              <>
                <button
                  type="button"
                  onClick={(e: MouseEvent) => {
                    e.stopPropagation();
                    setManageOpen(true);
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 9,
                    cursor: "pointer",
                    background: tokens.fillSoft,
                    border: `1px solid ${tokens.border}`,
                    color: tokens.text,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {t("conn.manage")}
                </button>
                <button
                  type="button"
                  onClick={doDisconnect}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 9,
                    cursor: "pointer",
                    background: "transparent",
                    border: `1px solid ${tokens.red}4D`,
                    color: tokens.red,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {t("conn.revoke")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={doConnect}
                disabled={busy}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  cursor: busy ? "default" : "pointer",
                  border: "none",
                  background: `linear-gradient(135deg, ${tc}, ${tokens.teal})`,
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 700,
                  opacity: busy ? 0.7 : 1,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {busy && (
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      border: "2px solid rgba(255,255,255,0.3)",
                      borderTopColor: "#fff",
                      animation: "rfi-spin 0.7s linear infinite",
                      display: "inline-block",
                    }}
                  />
                )}
                {busy
                  ? t("conn.connecting")
                  : notInstalled
                  ? t("conn.phantom.installCTA")
                  : t("conn.connect", { n: c.name })}
              </button>
            )}
          </div>

          {/* Phantom-specific inline error (not the floating toast) */}
          {isPhantom &&
            wallet?.lastError &&
            !isConnected &&
            !busy && (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: notInstalled
                    ? `${tokens.amber}1A`
                    : `${tokens.red}1A`,
                  border: `1px solid ${
                    notInstalled ? tokens.amber : tokens.red
                  }4D`,
                  fontSize: 11,
                  color: notInstalled ? tokens.amber : tokens.red,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Icons.info
                  size={12}
                  stroke={notInstalled ? tokens.amber : tokens.red}
                />
                {notInstalled
                  ? t("conn.phantom.install")
                  : wallet.lastError === "user_rejected"
                  ? t("conn.phantom.rejected")
                  : t("conn.phantom.failed", { msg: wallet.lastError })}
              </div>
            )}
        </div>
      )}

      <ManageConnectionModal
        conn={c}
        meta={c.meta}
        permissions={c.perms}
        open={manageOpen}
        onClose={() => setManageOpen(false)}
      />
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { ConnectionCard, type ConnSpec } from "@/components/carteira/ConnectionCard";
import { useConnections, type ConnId } from "@/lib/connections";
import { useI18n, useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";
import { useIsMobile } from "@/lib/useIsMobile";
import { shortAddr, useWallet } from "@/lib/wallet";

// Conexões tab content. Composes the 5 ConnectionCards (Phantom real
// + 4 mocks) with the security explainer + roadmap panel on the side.
// Port of WalletConnections + getConnectionsSpec from
// prototype/components/desktop-more.jsx.

export function WalletConnections() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { lang, fmtMoney } = useI18n();
  const wallet = useWallet();
  const isMobile = useIsMobile();
  const conns = useConnections();
  const [expanded, setExpanded] = useState<string | null>("phantom");

  const solFmt = (n: number) =>
    `${n.toLocaleString(lang === "pt" ? "pt-BR" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })} SOL`;
  const phantomAddrShort = wallet.publicKey ? shortAddr(wallet.publicKey, 6, 6) : "—";
  const phantomBalance = wallet.balanceSol != null ? solFmt(wallet.balanceSol) : "—";

  const spec: ConnSpec[] = useMemo(
    () => [
      {
        id: "phantom",
        name: "Phantom",
        tone: "p",
        tagline: t("conn.phantom.tag"),
        live: true,
        featured: true,
        glyph: "phantom",
        meta: [
          {
            l: t("conn.phantom.addr"),
            v: phantomAddrShort,
            mono: true,
            link: wallet.publicKey ? wallet.explorerAddr(wallet.publicKey) : null,
          },
          { l: t("conn.phantom.net"), v: t("conn.phantom.devnet") },
          { l: t("conn.phantom.balance"), v: phantomBalance, mono: true },
        ],
        perms: [t("conn.phantom.p1"), t("conn.phantom.p2"), t("conn.phantom.p3")],
      },
      {
        id: "civic",
        name: "Civic Pass",
        tone: "g",
        tagline: t("conn.civic.tag"),
        glyph: "civic",
        meta: [
          { l: t("conn.civic.passId"), v: "civic:pass:7xG3…k9Fn", mono: true },
          { l: t("conn.civic.tier"), v: t("conn.civic.tierV") },
          { l: t("conn.civic.exp"), v: "14 Mar 2027" },
        ],
        perms: [t("conn.civic.p1"), t("conn.civic.p2")],
      },
      {
        id: "kamino",
        name: "Kamino Finance",
        tone: "t",
        tagline: t("conn.kamino.tag"),
        glyph: "kamino",
        meta: [
          { l: t("conn.kamino.vault"), v: "roundfi/escrow-usdc-v2", mono: true },
          { l: t("conn.kamino.alloc"), v: fmtMoney(2360) },
          {
            l: t("conn.kamino.yield"),
            v: `${fmtMoney(312.08)} (+6,8% APY)`,
          },
        ],
        perms: [t("conn.kamino.p1"), t("conn.kamino.p2"), t("conn.kamino.p3")],
      },
      {
        id: "solflare",
        name: "Solflare",
        tone: "t",
        tagline: t("conn.solflare.tag"),
        glyph: "solflare",
        meta: [
          { l: t("conn.phantom.addr"), v: "—", mono: true },
          { l: t("conn.phantom.net"), v: t("conn.phantom.mainnet") },
        ],
        perms: [t("conn.phantom.p1"), t("conn.phantom.p3")],
      },
      {
        id: "pix",
        name: "Pix · BRL on-ramp",
        tone: "a",
        tagline: t("conn.pix.tag"),
        glyph: "pix",
        meta: [
          { l: t("conn.pix.provider"), v: t("conn.pix.notSet") },
          { l: t("conn.pix.req"), v: t("conn.pix.reqV") },
        ],
        perms: [
          t("conn.pix.p1", { c1: "BRL", c2: "USDC" }),
          t("conn.pix.p2", { c1: "BRL", c2: "USDC" }),
        ],
      },
    ],
    [t, fmtMoney, phantomAddrShort, phantomBalance, wallet],
  );

  // Connected count: Phantom is real, others come from ConnectionsProvider.
  const connectedCount =
    (wallet.status === "connected" ? 1 : 0) +
    (Object.keys(conns.state) as ConnId[]).filter((k) => conns.state[k].status === "connected")
      .length;

  return (
    <div
      style={{
        marginTop: 20,
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1.3fr 1fr",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <MonoLabel color={tokens.green}>{t("conn.badge")}</MonoLabel>
          <span
            style={{
              fontSize: 11,
              color: tokens.muted,
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            }}
          >
            {t("conn.count", { c: connectedCount, t: spec.length })}
          </span>
        </div>

        {spec.map((c) => {
          const runtime =
            c.id === "phantom" ? { status: "disconnected" as const } : conns.state[c.id as ConnId];
          return (
            <ConnectionCard
              key={c.id}
              c={c}
              runtime={runtime}
              wallet={c.id === "phantom" ? wallet : null}
              open={expanded === c.id}
              onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
              onMockConnect={conns.connect}
              onMockDisconnect={conns.disconnect}
            />
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            ...glass,
            padding: 22,
            borderRadius: 18,
            position: "relative",
            overflow: "hidden",
            background: `linear-gradient(145deg, ${tokens.navy}AA, rgba(255,255,255,0.04) 80%)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -30,
              right: -30,
              width: 140,
              height: 140,
              borderRadius: "50%",
              border: `20px solid ${tokens.green}1A`,
            }}
          />
          <div style={{ position: "relative" }}>
            <Icons.shield size={22} stroke={tokens.green} />
            <div
              style={{
                fontFamily: "var(--font-syne), Syne",
                fontSize: 20,
                fontWeight: 700,
                color: tokens.text,
                marginTop: 12,
                letterSpacing: "-0.02em",
              }}
            >
              {t("conn.keys.title")}
            </div>
            <div
              style={{
                fontSize: 12,
                color: tokens.text2,
                marginTop: 8,
                lineHeight: 1.5,
              }}
            >
              {t("conn.keys.body")}
            </div>
          </div>
        </div>

        <div
          style={{
            ...glass,
            padding: 18,
            borderRadius: 14,
          }}
        >
          <MonoLabel color={tokens.teal}>{t("conn.soon")}</MonoLabel>
          <div
            style={{
              marginTop: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {[
              { n: "Marginfi", d: t("conn.soon.marginfi") },
              { n: "Jupiter", d: t("conn.soon.jupiter") },
              { n: "Open Finance BR", d: t("conn.soon.openfin") },
            ].map((row) => (
              <div
                key={row.n}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      color: tokens.text,
                      fontWeight: 500,
                    }}
                  >
                    {row.n}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: tokens.muted,
                      marginTop: 2,
                    }}
                  >
                    {row.d}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    padding: "3px 8px",
                    borderRadius: 999,
                    background: tokens.fillSoft,
                    border: `1px solid ${tokens.border}`,
                    color: tokens.muted,
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  }}
                >
                  {t("conn.roadmap")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

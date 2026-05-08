"use client";

import { useState } from "react";

import { MonoLabel, RFIPill } from "@/components/brand/brand";
import { PositionsList } from "@/components/carteira/PositionsList";
import { TransactionsList } from "@/components/carteira/TransactionsList";
import { WithdrawYieldModal } from "@/components/carteira/WithdrawYieldModal";
import { CountUp } from "@/components/ui/CountUp";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";
import { useIsMobile } from "@/lib/useIsMobile";

// Visão geral — balance hero + composition bar + Kamino vault card
// + preview rows. The "Sacar" CTA opens WithdrawYieldModal; the
// "Ver todas →" hint on the tx preview routes back to the parent
// carteira page via the `onSeeAllTx` callback so the page can swap
// to the transactions tab without a full route change.

export function WalletOverview({ onSeeAllTx }: { onSeeAllTx?: () => void }) {
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const { t, currency, fmtMoney } = useI18n();
  const { user } = useSession();
  const isMobile = useIsMobile();

  const composition = [
    { c: tokens.green, l: t("wallet.quota"), brl: 4380, pct: "52%" },
    { c: tokens.teal, l: t("wallet.yieldVault"), brl: 2360, pct: "28%" },
    { c: tokens.purple, l: t("wallet.collateral"), brl: 1180, pct: "14%" },
    { c: tokens.amber, l: t("wallet.free"), brl: 500, pct: "6%" },
  ];

  return (
    <div
      style={{
        marginTop: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1.4fr 1fr",
          gap: 16,
        }}
      >
        {/* Balance hero */}
        <div
          style={{
            ...glass,
            padding: 28,
            borderRadius: 20,
            position: "relative",
            overflow: "hidden",
            background: `linear-gradient(145deg, ${tokens.navy}AA 0%, rgba(255,255,255,0.04) 80%)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -80,
              right: -60,
              width: 300,
              height: 300,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${tokens.green}22, transparent 65%)`,
            }}
          />
          <div style={{ position: "relative" }}>
            <MonoLabel>{t("wallet.total", { c: currency })}</MonoLabel>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                alignItems: "baseline",
                gap: 12,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-syne), Syne",
                  fontSize: 64,
                  fontWeight: 800,
                  color: tokens.text,
                  letterSpacing: "-0.04em",
                  lineHeight: 1,
                }}
              >
                <CountUp value={user.balance} format={(n) => fmtMoney(n)} />
              </span>
            </div>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                gap: 16,
                fontSize: 12,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              <span style={{ color: tokens.green }}>
                {fmtMoney(248.12, { signed: true })} · 24h
              </span>
              <span style={{ color: tokens.text2 }}>{t("home.kpi.delta.balance")}</span>
            </div>

            {/* composition bar */}
            <div style={{ marginTop: 28 }}>
              <MonoLabel size={9}>{t("wallet.comp")}</MonoLabel>
              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  height: 10,
                  borderRadius: 6,
                  overflow: "hidden",
                }}
              >
                <div style={{ flex: 5.2, background: tokens.green }} />
                <div style={{ flex: 2.8, background: tokens.teal }} />
                <div style={{ flex: 1.4, background: tokens.purple }} />
                <div style={{ flex: 0.6, background: tokens.amber }} />
              </div>
              <div
                style={{
                  marginTop: 12,
                  display: "grid",
                  gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)",
                  gap: 8,
                }}
              >
                {composition.map((x) => (
                  <div key={x.l}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 2,
                          background: x.c,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 10,
                          color: tokens.muted,
                          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                        }}
                      >
                        {x.pct}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: tokens.text2,
                        marginTop: 3,
                      }}
                    >
                      {x.l}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: tokens.text,
                        marginTop: 2,
                      }}
                    >
                      {fmtMoney(x.brl, { noCents: true })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Kamino Vault card */}
        <div
          style={{
            ...glass,
            padding: 22,
            borderRadius: 20,
            position: "relative",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <MonoLabel color={tokens.teal}>{t("wallet.kamino")}</MonoLabel>
            <RFIPill tone="t">APY 6,8%</RFIPill>
          </div>
          <div
            style={{
              fontFamily: "var(--font-syne), Syne",
              fontSize: 36,
              fontWeight: 800,
              color: tokens.text,
              letterSpacing: "-0.03em",
              marginTop: 14,
            }}
          >
            <CountUp value={user.yield} format={(n) => fmtMoney(n)} />
          </div>
          <div
            style={{
              fontSize: 11,
              color: tokens.muted,
              marginTop: 4,
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            }}
          >
            {t("wallet.yieldAcc")}
          </div>

          <div style={{ marginTop: 18, flex: 1 }}>
            <svg viewBox="0 0 200 60" style={{ width: "100%", height: 80 }}>
              <defs>
                <linearGradient id="rfi-spark-g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={tokens.teal} stopOpacity="0.4" />
                  <stop offset="1" stopColor={tokens.teal} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0,50 L20,48 L40,42 L60,44 L80,36 L100,32 L120,34 L140,24 L160,20 L180,14 L200,10 L200,60 L0,60 Z"
                fill="url(#rfi-spark-g)"
              />
              <path
                d="M0,50 L20,48 L40,42 L60,44 L80,36 L100,32 L120,34 L140,24 L160,20 L180,14 L200,10"
                fill="none"
                stroke={tokens.teal}
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <button
            type="button"
            onClick={() => setWithdrawOpen(true)}
            style={{
              marginTop: 8,
              width: "100%",
              padding: 11,
              borderRadius: 11,
              background: tokens.fillSoft,
              border: `1px solid ${tokens.borderStr}`,
              color: tokens.text,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t("wallet.withdraw")}
          </button>
        </div>
      </div>

      {/* Preview rows: 2 positions + 3 recent txs */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
        <PositionsList limit={2} />
        <TransactionsList limit={3} onSeeAll={onSeeAllTx} />
      </div>

      <WithdrawYieldModal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
    </div>
  );
}

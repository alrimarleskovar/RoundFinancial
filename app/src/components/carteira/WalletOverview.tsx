"use client";

import { useState } from "react";

import { MonoLabel, RFIPill } from "@/components/brand/brand";
import { PositionsList } from "@/components/carteira/PositionsList";
import { TransactionsList } from "@/components/carteira/TransactionsList";
import { WithdrawYieldModal } from "@/components/carteira/WithdrawYieldModal";
import { CountUp } from "@/components/ui/CountUp";
import { liftHover } from "@/lib/hoverLift";
import { useSession } from "@/lib/session";
import { USDC_RATE, useI18n } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";
import { useIsMobile } from "@/lib/useIsMobile";
import { useMyDevnetPositions } from "@/lib/useMyDevnetPositions";
import { useUsdcBalance } from "@/lib/useUsdcBalance";

// Visão geral — balance hero + composition bar + Kamino vault card
// + preview rows. The "Sacar" CTA opens WithdrawYieldModal; the
// "Ver todas →" hint on the tx preview routes back to the parent
// carteira page via the `onSeeAllTx` callback so the page can swap
// to the transactions tab without a full route change.

export function WalletOverview({ onSeeAllTx }: { onSeeAllTx?: () => void }) {
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  // Composition slice the cursor is over — emphasize it, dim the rest
  // (both the bar segment and its legend entry).
  const [hoveredSlice, setHoveredSlice] = useState<number | null>(null);
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const { t, currency, fmtMoney, lang } = useI18n();
  const { user, demoActive } = useSession();
  const isMobile = useIsMobile();

  // Real composition = the wallet's free USDC + the collateral it locked across
  // its on-chain cotas (stake + escrow). Demo keeps the fixture breakdown for
  // the pitch. A real wallet used to show an EMPTY bar (no fabricated slices) —
  // which read as broken; now it shows the genuine free-vs-locked split.
  const usdc = useUsdcBalance();
  const positions = useMyDevnetPositions();
  const lockedUsdc = positions.reduce((s, p) => s + (p.locked ?? 0), 0);
  const freeUsdc = Math.max(
    0,
    usdc.status === "ok" && usdc.uiAmount !== null ? usdc.uiAmount : user.balance / USDC_RATE,
  );
  const realComposition = (() => {
    const total = freeUsdc + lockedUsdc;
    if (total <= 0) return [] as { c: string; l: string; brl: number; pct: string; flex: number }[];
    const slices = [
      { c: tokens.green, l: t("wallet.free"), u: freeUsdc },
      ...(lockedUsdc > 0 ? [{ c: tokens.purple, l: t("wallet.collateral"), u: lockedUsdc }] : []),
    ];
    return slices.map((s) => ({
      c: s.c,
      l: s.l,
      brl: s.u * USDC_RATE,
      pct: `${Math.round((s.u / total) * 100)}%`,
      flex: Math.max(0.0001, s.u),
    }));
  })();
  const composition = demoActive
    ? [
        { c: tokens.green, l: t("wallet.quota"), brl: 4380, pct: "52%", flex: 5.2 },
        { c: tokens.teal, l: t("wallet.yieldVault"), brl: 2360, pct: "28%", flex: 2.8 },
        { c: tokens.purple, l: t("wallet.collateral"), brl: 1180, pct: "14%", flex: 1.4 },
        { c: tokens.amber, l: t("wallet.free"), brl: 500, pct: "6%", flex: 0.6 },
      ]
    : realComposition;

  // Total shown right at the composition bar (devnet USDC, regardless of the
  // BRL/USDC toggle). Real mode = free + locked (the slices' sum, the wallet's
  // full protocol commitment); demo = the session balance.
  const usdcTotalNum = demoActive ? user.balance / USDC_RATE : freeUsdc + lockedUsdc;
  const usdcTotal = usdcTotalNum.toLocaleString(lang === "pt" ? "pt-BR" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

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
          className="group transition-transform duration-500 hover:scale-[1.01]"
          style={{
            ...glass,
            padding: 28,
            borderRadius: 20,
            position: "relative",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            background: `linear-gradient(145deg, ${tokens.navy}AA 0%, rgba(255,255,255,0.04) 80%)`,
          }}
        >
          {/* Mirrored shine sweep on hover — same effect as the home SAS passport. */}
          <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-tr from-transparent via-white/5 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
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
          <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
            <MonoLabel>{t("wallet.total", { c: currency })}</MonoLabel>
            <div
              style={{
                marginTop: "auto",
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
            {demoActive && (
              <div
                style={{
                  marginTop: 14,
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
            )}

            {/* composition bar — grouped with the 24h delta at the card's lower edge.
                Hidden when there's nothing to break down (e.g. a 0-balance wallet). */}
            {composition.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <MonoLabel size={9}>{t("wallet.comp")}</MonoLabel>
                  {/* Total in devnet USDC, anchored right at the bar. */}
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: tokens.text2,
                      fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    }}
                  >
                    {usdcTotal} USDC
                  </span>
                </div>
                <div
                  style={{
                    marginTop: 10,
                    display: "flex",
                    height: 10,
                    borderRadius: 6,
                    overflow: "hidden",
                  }}
                >
                  {composition.map((x, i) => (
                    <div
                      key={x.l}
                      onMouseEnter={() => setHoveredSlice(i)}
                      onMouseLeave={() => setHoveredSlice(null)}
                      style={{
                        flex: x.flex,
                        background: x.c,
                        opacity: hoveredSlice === null || hoveredSlice === i ? 1 : 0.25,
                        transition: "opacity 180ms ease",
                        cursor: "pointer",
                      }}
                    />
                  ))}
                </div>
                <div
                  style={{
                    marginTop: 12,
                    display: "grid",
                    gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)",
                    gap: 8,
                  }}
                >
                  {composition.map((x, i) => (
                    <div
                      key={x.l}
                      onMouseEnter={() => setHoveredSlice(i)}
                      onMouseLeave={() => setHoveredSlice(null)}
                      style={{
                        opacity: hoveredSlice === null || hoveredSlice === i ? 1 : 0.4,
                        transition: "opacity 180ms ease",
                        cursor: "default",
                      }}
                    >
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
            )}
          </div>
        </div>

        {/* Kamino Vault card */}
        <div
          style={{
            ...glass,
            border: "1px solid transparent",
            padding: 22,
            borderRadius: 20,
            position: "relative",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            transition: "transform 180ms ease, border-color 180ms ease",
          }}
          {...liftHover(tokens.teal)}
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

          <div style={{ marginTop: 18, flex: 1, display: "flex", minHeight: 96 }}>
            <svg
              viewBox="0 0 200 60"
              preserveAspectRatio="none"
              style={{ width: "100%", height: "100%" }}
            >
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
              transition: "transform 180ms ease, border-color 180ms ease",
            }}
            {...liftHover(tokens.teal, tokens.borderStr)}
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

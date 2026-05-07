"use client";

import { useState } from "react";
import Link from "next/link";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { DeskMeta } from "@/components/home/DeskMeta";
import { PayInstallmentModal } from "@/components/modals/PayInstallmentModal";
import { ACTIVE_GROUPS } from "@/data/groups";
import { USDC_RATE, useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";
import { usePool, usePoolMembers } from "@/lib/usePool";
import { shortAddr, useWallet } from "@/lib/wallet";

// Big featured-round card on Home: circular dial showing month
// progress + group meta + member avatars + CTAs (pay this round's
// installment, or jump to the catalog page).

export function FeaturedGroup() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { fmtMoney } = useI18n();
  const { monthsPaidByGroup, demoGroup } = useSession();
  // ─── On-chain pool read (devnet) ────────────────────────────────────
  // Reads the live state of the on-chain pool tagged on g1
  // (`g1.devnetPool`, currently `pool3` because that's the only pool
  // currently driveable from the front-end — Pool 2's contribute path
  // is locked behind a SCHEMA_CYCLE_COMPLETE 6-day cooldown). When the
  // pool deserializes cleanly, override the mock fixture's membership /
  // cycle / amount fields with the live values. The Demo Studio preset
  // (`demoGroup`) takes precedence over the chain feed so the recording
  // flow stays deterministic — chain data fills in only when no preset
  // is active. If RPC is down, the cluster is wrong, or the pool is
  // missing, `usePool` returns status="fallback" and we silently render
  // the mock fixture exactly as before.
  const fixtureG = demoGroup ?? ACTIVE_GROUPS[0];
  const seedKey = fixtureG.devnetPool ?? "pool3";
  const onChain = usePool(seedKey);
  const onChainMembers = usePoolMembers(seedKey);
  const { explorerAddr } = useWallet();
  const useChain = onChain.status === "ok" && onChain.pool && !demoGroup;
  const baseG = useChain
    ? {
        ...fixtureG,
        name: `Pool ${onChain.pool!.seedId} · ${onChain.pool!.membersJoined}/${onChain.pool!.membersTarget} members · $${
          Number(onChain.pool!.creditAmount) / 1e6
        } credit (devnet)`,
        month: onChain.pool!.currentCycle,
        total: onChain.pool!.cyclesTotal,
        // fmtMoney expects BRL — multiply USDC by USDC_RATE so the
        // converted display stays meaningful in either currency mode.
        installment: (Number(onChain.pool!.installmentAmount) / 1e6) * USDC_RATE,
        prize: (Number(onChain.pool!.creditAmount) / 1e6) * USDC_RATE,
        members: onChain.pool!.membersJoined,
      }
    : fixtureG;
  // Overlay session-tracked installments paid this round on top of the
  // static fixture so the dial advances live when the user confirms a
  // payment. Capped at the group's total. Skipped when reading on-chain
  // data — the dial reflects pool.currentCycle directly there.
  const paidExtra = useChain ? 0 : (monthsPaidByGroup[baseG.name] ?? 0);
  const month = Math.min(baseG.total, baseG.month + paidExtra);
  const g = { ...baseG, month, progress: month / baseG.total };
  const [payOpen, setPayOpen] = useState(false);

  const dialPct = g.month / g.total;
  // Tick count tracks total months but caps at 24 to keep the dial
  // readable even for the 36-month "Veteran Big" preset.
  const tickCount = Math.min(24, g.total);
  const ticks = Array.from({ length: tickCount });

  return (
    <div
      style={{
        ...glass,
        background: `linear-gradient(135deg, ${tokens.navyDeep}99 0%, rgba(255,255,255,0.04) 70%)`,
        borderRadius: 20,
        padding: 24,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -40,
          right: -40,
          width: 240,
          height: 240,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${tokens.green}26, transparent 60%)`,
        }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          gap: 28,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ width: 160, height: 160, position: "relative", flexShrink: 0 }}>
          <svg
            viewBox="0 0 100 100"
            style={{
              width: "100%",
              height: "100%",
              transform: "rotate(-90deg)",
            }}
          >
            <defs>
              <linearGradient id="rfi-home-dial" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={tokens.green} />
                <stop offset="1" stopColor={tokens.teal} />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="42" fill="none" stroke={tokens.fillMed} strokeWidth="5" />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="url(#rfi-home-dial)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${264 * dialPct} 264`}
            />
            {ticks.map((_, i) => {
              const a = (i / tickCount) * Math.PI * 2;
              const x1 = 50 + Math.cos(a) * 49;
              const y1 = 50 + Math.sin(a) * 49;
              const x2 = 50 + Math.cos(a) * 46;
              const y2 = 50 + Math.sin(a) * 46;
              const done = i / tickCount < g.month / g.total;
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={done ? tokens.green : tokens.fillMed}
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              );
            })}
          </svg>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MonoLabel size={9}>{t("home.month").toUpperCase()}</MonoLabel>
            <div
              style={{
                fontFamily: "var(--font-syne), Syne",
                fontWeight: 800,
                fontSize: 40,
                color: tokens.text,
                lineHeight: 1,
                letterSpacing: "-0.03em",
              }}
            >
              {String(g.month).padStart(2, "0")}
            </div>
            <div
              style={{
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                fontSize: 10,
                color: tokens.green,
                marginTop: 4,
              }}
            >
              / {g.total}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <MonoLabel color={tokens.green}>
            {useChain ? "ON-CHAIN · DEVNET" : t("home.featured")}
          </MonoLabel>
          <div
            style={{
              fontFamily: "var(--font-syne), Syne",
              fontSize: 24,
              fontWeight: 700,
              color: tokens.text,
              letterSpacing: "-0.02em",
              marginTop: 6,
            }}
          >
            {g.name}
          </div>
          <div
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "repeat(3, auto)",
              gap: 24,
            }}
          >
            <DeskMeta label={t("home.meta.prize")} v={fmtMoney(g.prize, { noCents: true })} />
            <DeskMeta label={t("home.meta.next")} v={fmtMoney(g.installment, { noCents: true })} />
            <DeskMeta label={t("home.meta.draw")} v={t("home.drawIn")} />
          </div>
          <div
            style={{
              marginTop: 18,
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex" }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    marginLeft: i ? -8 : 0,
                    background: i === 5 ? tokens.surface3 : `hsl(${(i * 60) % 360} 40% 45%)`,
                    border: `2px solid ${tokens.bg}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontSize: 8,
                    color: tokens.text,
                  }}
                >
                  {i === 5 ? `+${g.members - 5}` : ""}
                </div>
              ))}
            </div>
            <span style={{ fontSize: 11, color: tokens.muted }}>
              {g.members} {t("home.installments")} · {g.month} {t("home.drawn")}
            </span>
          </div>

          {/* On-chain roster — only when reading the live pool and at
              least one member account is materialized. Shows real wallets
              so the demo proves the membership is on-chain, not a fixture.
              Currently sourced from pool3 via g1.devnetPool. */}
          {useChain && onChainMembers.status === "ok" && onChainMembers.members.length > 0 ? (
            <div
              style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: `1px dashed ${tokens.borderStr}`,
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
              }}
            >
              <MonoLabel size={9} color={tokens.muted}>
                ROSTER
              </MonoLabel>
              {onChainMembers.members.map((m) => {
                const addr = m.wallet.toBase58();
                return (
                  <a
                    key={addr}
                    href={explorerAddr(addr)}
                    target="_blank"
                    rel="noreferrer"
                    title={`slot ${m.slotIndex} · ${m.contributionsPaid} paid · ${m.onTimeCount} on-time${m.defaulted ? " · DEFAULTED" : ""}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "3px 8px",
                      borderRadius: 6,
                      fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                      fontSize: 10,
                      color: m.defaulted ? tokens.red : tokens.text2,
                      background: tokens.fillSoft,
                      border: `1px solid ${m.defaulted ? `${tokens.red}55` : tokens.borderStr}`,
                      textDecoration: "none",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: m.defaulted ? tokens.red : tokens.green,
                      }}
                    />
                    s{m.slotIndex}·{shortAddr(addr, 4, 4)}
                  </a>
                );
              })}
            </div>
          ) : null}

          {/* CTA row */}
          <div style={{ marginTop: 18, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setPayOpen(true)}
              style={{
                padding: "10px 16px",
                borderRadius: 11,
                border: "none",
                cursor: "pointer",
                background: `linear-gradient(135deg, ${tokens.green}, ${tokens.teal})`,
                color: tokens.bgDeep,
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                boxShadow: `0 6px 18px ${tokens.green}33`,
              }}
            >
              <Icons.send size={14} stroke={tokens.bgDeep} sw={2} />
              {t("home.payInstallment")}
            </button>
            <Link
              href="/grupos"
              style={{
                padding: "10px 16px",
                borderRadius: 11,
                background: tokens.fillSoft,
                border: `1px solid ${tokens.borderStr}`,
                color: tokens.text,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                textDecoration: "none",
              }}
            >
              {t("home.featured.viewCatalog")}
              <Icons.arrow size={13} stroke={tokens.text} sw={2} />
            </Link>
          </div>
        </div>
      </div>

      <PayInstallmentModal group={baseG} open={payOpen} onClose={() => setPayOpen(false)} />
    </div>
  );
}

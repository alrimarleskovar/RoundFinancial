"use client";

import { useState } from "react";
import Link from "next/link";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { DeskMeta } from "@/components/home/DeskMeta";
import { PayInstallmentModal } from "@/components/modals/PayInstallmentModal";
import { ACTIVE_GROUPS } from "@/data/groups";
import { useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Big featured-round card on Home: circular dial showing month
// progress + group meta + member avatars + CTAs (pay this round's
// installment, or jump to the catalog page).

export function FeaturedGroup() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { fmtMoney } = useI18n();
  const { monthsPaidByGroup } = useSession();
  const baseG = ACTIVE_GROUPS[0];
  // Overlay session-tracked installments paid this round on top of the
  // static fixture so the dial advances live when the user confirms a
  // payment. Capped at the group's total.
  const paidExtra = monthsPaidByGroup[baseG.name] ?? 0;
  const month = Math.min(baseG.total, baseG.month + paidExtra);
  const g = { ...baseG, month, progress: month / baseG.total };
  const [payOpen, setPayOpen] = useState(false);

  const dialPct = g.month / g.total;
  const ticks = Array.from({ length: 12 });

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
              const a = (i / 12) * Math.PI * 2;
              const x1 = 50 + Math.cos(a) * 49;
              const y1 = 50 + Math.sin(a) * 49;
              const x2 = 50 + Math.cos(a) * 46;
              const y2 = 50 + Math.sin(a) * 46;
              const done = i < g.month;
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
          <MonoLabel color={tokens.green}>{t("home.featured")}</MonoLabel>
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

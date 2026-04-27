"use client";

import { MonoLabel } from "@/components/brand/brand";
import { DeskMeta } from "@/components/home/DeskMeta";
import { ACTIVE_GROUPS } from "@/data/groups";
import { useI18n, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Big featured-round card on Home: circular dial showing month
// progress + group meta + member avatars.

export function FeaturedGroup() {
  const { tokens } = useTheme();
  const t = useT();
  const { fmtMoney } = useI18n();
  const g = ACTIVE_GROUPS[0];

  const dialPct = g.month / g.total;
  const ticks = Array.from({ length: 12 });

  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${tokens.navyDeep} 0%, ${tokens.surface1} 70%)`,
        border: `1px solid ${tokens.border}`,
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
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke={tokens.fillMed}
              strokeWidth="5"
            />
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
            <DeskMeta
              label={t("home.meta.prize")}
              v={fmtMoney(g.prize, { noCents: true })}
            />
            <DeskMeta
              label={t("home.meta.next")}
              v={fmtMoney(g.installment, { noCents: true })}
            />
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
                    background:
                      i === 5 ? tokens.surface3 : `hsl(${(i * 60) % 360} 40% 45%)`,
                    border: `2px solid ${tokens.bg}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily:
                      "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontSize: 8,
                    color: tokens.text,
                  }}
                >
                  {i === 5 ? `+${g.members - 5}` : ""}
                </div>
              ))}
            </div>
            <span style={{ fontSize: 11, color: tokens.muted }}>
              {g.members} {t("home.installments")} · {g.month}{" "}
              {t("home.drawn")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

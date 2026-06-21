"use client";

import { useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { useSession } from "@/lib/session";
import {
  DEFAULT_RANGE,
  SCORE_MONTHS_EN,
  SCORE_MONTHS_PT,
  SCORE_RANGES,
  curveForRange,
  monthsForRange,
  type ScoreRange,
} from "@/data/insights";
import { useI18n, useT } from "@/lib/i18n";
import { PASSPORT_TIERS } from "@/lib/passport";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Big chart card on /insights. SVG curve + 2 dashed level
// thresholds + month axis + 1M/3M/6M/12M range pill. Pill drives
// `curveForRange()` which slices and rescales the synthetic curve
// so shorter ranges actually zoom into the most recent points.

// Map a 0-1000 score onto the chart's 0-220 viewBox Y (lower Y = higher
// score), anchored on the tier-2 (500) and tier-3 (750) thresholds so the
// tier lines land where the score scale says they should.
function scoreToY(score: number): number {
  const y = 140 - 0.28 * (score - 500);
  return Math.max(6, Math.min(214, y));
}

export function ScoreEvolution() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { lang } = useI18n();
  const { user } = useSession();
  const [range, setRange] = useState<ScoreRange>(DEFAULT_RANGE);

  // Remap the synthetic curve onto the real 0-1000 score scale so it lands
  // on the tier lines and ENDS at the live user.score — functional, not a
  // free-floating mock. The shape (relative ups/downs) is preserved; only
  // the Y scale is anchored to the tiers.
  const raw = curveForRange(range);
  const ys = raw.map(([, y]) => y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = maxY - minY || 1;
  const startScore = Math.max(320, user.score - 170);
  const curve = raw.map(([x, y]) => {
    const tnorm = (maxY - y) / span; // 0 at the lowest score, 1 at the most recent
    const s = startScore + tnorm * (user.score - startScore);
    return [x, scoreToY(s)] as const;
  });
  const linePath = curve.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
  const areaPath = `${linePath} L600,220 L0,220 Z`;

  const allMonths = lang === "pt" ? SCORE_MONTHS_PT : SCORE_MONTHS_EN;
  const months = monthsForRange(range, allMonths);
  const last = curve[curve.length - 1]!;

  // Tier line/label color — teal (lv2) / green (lv3) / purple (lv4 Elite),
  // matching the reputacao ladder.
  const tierLineColor = (lv: number): string =>
    lv === 2 ? tokens.teal : lv === 3 ? tokens.green : tokens.purple;

  return (
    <div
      style={{
        ...glass,
        padding: 24,
        borderRadius: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <MonoLabel color={tokens.green}>{t("insights.evolution.title")}</MonoLabel>
          <div
            style={{
              fontFamily: "var(--font-syne), Syne",
              fontSize: 20,
              fontWeight: 700,
              color: tokens.text,
              marginTop: 6,
            }}
          >
            {user.score}{" "}
            <span
              style={{
                fontSize: 12,
                color: tokens.green,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {t("insights.evolution.delta", { n: user.scoreDelta })}
            </span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 4,
            padding: 3,
            borderRadius: 8,
            background: tokens.fillSoft,
            border: `1px solid ${tokens.border}`,
          }}
        >
          {SCORE_RANGES.map((r) => {
            const active = r === range;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                style={{
                  padding: "5px 10px",
                  borderRadius: 5,
                  border: "none",
                  cursor: "pointer",
                  background: active ? tokens.surface2 : "transparent",
                  color: active ? tokens.text : tokens.text2,
                  fontSize: 10,
                  fontWeight: 600,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {r}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart */}
      <div style={{ marginTop: 20, position: "relative", height: 220 }}>
        <svg
          viewBox="0 0 600 220"
          style={{ width: "100%", height: "100%" }}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="rfi-ins-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={tokens.green} stopOpacity="0.25" />
              <stop offset="1" stopColor={tokens.green} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* gridlines */}
          {[40, 90, 140, 190].map((y) => (
            <line
              key={y}
              x1="0"
              y1={y}
              x2="600"
              y2={y}
              stroke={tokens.border}
              strokeDasharray="2 4"
            />
          ))}
          {/* area + line */}
          <path d={areaPath} fill="url(#rfi-ins-fill)" />
          <path
            d={linePath}
            fill="none"
            stroke={tokens.green}
            strokeWidth="2"
            strokeLinecap="round"
          />
          {/* tier thresholds (lv2 / lv3 / lv4 Elite) on the real score scale */}
          {PASSPORT_TIERS.slice(1).map((tier) => {
            const y = scoreToY(tier.min);
            return (
              <line
                key={tier.level}
                x1="0"
                y1={y}
                x2="600"
                y2={y}
                stroke={tierLineColor(tier.level)}
                strokeDasharray="4 4"
                strokeWidth="1"
              />
            );
          })}
          {/* current point */}
          <circle cx={last[0]} cy={last[1]} r="4" fill={tokens.green} />
          <circle cx={last[0]} cy={last[1]} r="8" fill={tokens.green} opacity="0.2" />
        </svg>

        {PASSPORT_TIERS.slice(1).map((tier) => {
          const top = Math.max(2, Math.min(198, scoreToY(tier.min) - 16));
          return (
            <div
              key={tier.level}
              style={{
                position: "absolute",
                left: 0,
                top,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                fontSize: 9,
                color: tierLineColor(tier.level),
                background: tokens.surface1,
                padding: "2px 6px",
                borderRadius: 4,
              }}
            >
              {t(`insights.threshold.lv${tier.level}`)}
            </div>
          );
        })}
      </div>

      <div
        style={{
          marginTop: 8,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          fontSize: 9,
          color: tokens.muted,
        }}
      >
        {months.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
    </div>
  );
}

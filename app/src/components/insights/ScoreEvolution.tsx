"use client";

import { useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { useSession } from "@/lib/session";
import {
  DEFAULT_RANGE,
  SCORE_CURVE,
  SCORE_MONTHS_EN,
  SCORE_MONTHS_PT,
  SCORE_RANGES,
  type ScoreRange,
} from "@/data/insights";
import { useI18n, useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Big chart card on /insights. SVG curve + 2 dashed level
// thresholds + 7-month axis + 1M/3M/6M/12M range pill.
// The curve doesn't actually re-shape per range yet — this
// matches the prototype's visual.

export function ScoreEvolution() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { lang } = useI18n();
  const { user } = useSession();
  const [range, setRange] = useState<ScoreRange>(DEFAULT_RANGE);

  const linePath = SCORE_CURVE.map(
    ([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`,
  ).join(" ");
  const areaPath = `${linePath} L600,220 L0,220 Z`;

  const months = lang === "pt" ? SCORE_MONTHS_PT : SCORE_MONTHS_EN;
  const last = SCORE_CURVE[SCORE_CURVE.length - 1];

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
          <MonoLabel color={tokens.green}>
            {t("insights.evolution.title")}
          </MonoLabel>
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
                fontFamily:
                  "var(--font-jetbrains-mono), JetBrains Mono, monospace",
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
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
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
          {/* level thresholds */}
          <line
            x1="0"
            y1="140"
            x2="600"
            y2="140"
            stroke={tokens.teal}
            strokeDasharray="4 4"
            strokeWidth="1"
          />
          <line
            x1="0"
            y1="70"
            x2="600"
            y2="70"
            stroke={tokens.purple}
            strokeDasharray="4 4"
            strokeWidth="1"
          />
          {/* current point */}
          <circle cx={last[0]} cy={last[1]} r="4" fill={tokens.green} />
          <circle
            cx={last[0]}
            cy={last[1]}
            r="8"
            fill={tokens.green}
            opacity="0.2"
          />
        </svg>

        <div
          style={{
            position: "absolute",
            left: 0,
            top: "23%",
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            fontSize: 9,
            color: tokens.purple,
            background: tokens.surface1,
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          {t("insights.threshold.lv3")}
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "55%",
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            fontSize: 9,
            color: tokens.teal,
            background: tokens.surface1,
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          {t("insights.threshold.lv2")}
        </div>
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

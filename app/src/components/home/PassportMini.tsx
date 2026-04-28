"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { MonoLabel, RFIPill } from "@/components/brand/brand";
import { CountUp } from "@/components/ui/CountUp";
import { USER } from "@/data/carteira";
import { useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// SAS Passport hero with a circular progress ring.
// 300 -> 0%, 850 -> 100%, current 684 -> ~70%.
// The arc draws in on mount via a CSS transition on
// stroke-dashoffset, then sits steady. Score number animates
// through CountUp for a "live" feel.

const MIN = 300;
const MAX = 850;
const RADIUS = 84;
const STROKE = 10;
const SIZE = RADIUS * 2 + STROKE * 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function PassportMini() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();

  // Animate the dashoffset from "empty" to the actual position
  // on first render. Subsequent score changes animate via CSS
  // transition.
  const targetPct = (USER.score - MIN) / (MAX - MIN);
  const [drawn, setDrawn] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(() => setDrawn(true));
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const offset = drawn
    ? CIRCUMFERENCE * (1 - targetPct)
    : CIRCUMFERENCE;

  const gradId = "rfi-score-ring-grad";

  return (
    <Link
      href="/reputacao"
      style={{
        display: "flex",
        textDecoration: "none",
        color: "inherit",
        height: "100%",
      }}
    >
      <div
        style={{
          ...glass,
          flex: 1,
          borderRadius: 18,
          padding: 22,
          position: "relative",
          overflow: "hidden",
          background: `linear-gradient(155deg, ${tokens.navy}AA, rgba(255,255,255,0.04) 80%)`,
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          justifyContent: "space-between",
          cursor: "pointer",
          gap: 14,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <MonoLabel color={tokens.green}>{t("home.passport")}</MonoLabel>
          <MonoLabel size={9}>{USER.walletShort}</MonoLabel>
        </div>

        {/* Radial ring + centered score */}
        <div
          style={{
            position: "relative",
            width: SIZE,
            height: SIZE,
            margin: "0 auto",
          }}
        >
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            style={{
              transform: "rotate(-90deg)",
              filter: `drop-shadow(0 0 14px ${tokens.green}55)`,
            }}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={tokens.green} />
                <stop offset="1" stopColor={tokens.teal} />
              </linearGradient>
            </defs>
            {/* Track */}
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={tokens.fillMed}
              strokeWidth={STROKE}
            />
            {/* Progress arc */}
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
              style={{
                transition:
                  "stroke-dashoffset 1600ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            />
          </svg>
          {/* Centered score */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-syne), Syne",
                fontSize: 52,
                fontWeight: 800,
                color: tokens.text,
                letterSpacing: "-0.04em",
                lineHeight: 1,
              }}
            >
              <CountUp
                value={USER.score}
                format={(n) => Math.round(n).toString()}
                damping={26}
                stiffness={120}
              />
            </span>
            <span
              style={{
                fontFamily:
                  "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                fontSize: 11,
                color: tokens.green,
                fontWeight: 600,
              }}
            >
              +{USER.scoreDelta}
            </span>
          </div>
        </div>

        {/* Scale + level */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily:
                "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              fontSize: 9,
              color: tokens.muted,
              letterSpacing: "0.08em",
            }}
          >
            <span>300</span>
            <span style={{ color: tokens.teal }}>{t("level.proven")}</span>
            <span>850</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
            }}
          >
            <RFIPill tone="g">Nv. {USER.level} · {USER.levelLabel}</RFIPill>
          </div>
        </div>
      </div>
    </Link>
  );
}

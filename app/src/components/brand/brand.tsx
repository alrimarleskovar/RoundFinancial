"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import { useTheme } from "@/lib/theme";

// Brand primitives ported from prototype/components/brand.jsx:
//   RFILogoMark, RFILogoLockup, RFIPill, RFICard, MonoLabel.
// Each consumes tokens via useTheme() so palette switches propagate.

export function RFILogoMark({
  size = 28,
  style,
}: {
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={style} fill="none">
      <defs>
        <linearGradient
          id={`rfi-g-${size}`}
          x1="8"
          y1="8"
          x2="56"
          y2="56"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#27D67B" />
          <stop offset=".45" stopColor="#3BC6D9" />
          <stop offset="1" stopColor="#1E90C9" />
        </linearGradient>
      </defs>
      <path
        d="M32 6a26 26 0 1 1 -22.2 12.5"
        stroke={`url(#rfi-g-${size})`}
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M38 14c10 4 16 14 14 26c-1.6 9 -8 15 -15 18c7 -10 5 -24 -6 -34c2 -5 4 -8 7 -10 z"
        fill={`url(#rfi-g-${size})`}
        opacity=".9"
      />
    </svg>
  );
}

export function RFILogoLockup({
  size = 28,
  subline = false,
  color,
}: {
  size?: number;
  subline?: boolean;
  color?: string;
}) {
  const { tokens } = useTheme();
  const textColor = color ?? tokens.text;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: size * 0.32 }}>
      <RFILogoMark size={size} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          lineHeight: 1,
          gap: 2,
        }}
      >
        <span
          style={{
            fontFamily: "Syne, system-ui",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            fontSize: size * 0.78,
            color: textColor,
          }}
        >
          Round<span style={{ fontWeight: 800 }}>Fi</span>
        </span>
        {subline && (
          <span
            style={{
              fontFamily: "DM Sans, system-ui",
              fontWeight: 400,
              fontSize: size * 0.28,
              color: tokens.text2,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginTop: 2,
            }}
          >
            Collaborative Finance
          </span>
        )}
      </div>
    </div>
  );
}

// ── Pill ────────────────────────────────────────────────────
export type PillTone = "g" | "t" | "p" | "a" | "r" | "n";

export function RFIPill({
  tone = "n",
  children,
  style,
}: {
  tone?: PillTone;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const { tokens } = useTheme();
  const tones: Record<PillTone, { c: string; b: string; br: string }> = {
    g: { c: tokens.green, b: "rgba(20,241,149,.12)", br: "rgba(20,241,149,.3)" },
    t: { c: tokens.teal, b: "rgba(0,200,255,.1)", br: "rgba(0,200,255,.3)" },
    p: { c: tokens.purple, b: "rgba(153,69,255,.1)", br: "rgba(153,69,255,.3)" },
    a: { c: tokens.amber, b: "rgba(255,181,71,.1)", br: "rgba(255,181,71,.3)" },
    r: { c: tokens.red, b: "rgba(255,86,86,.1)", br: "rgba(255,86,86,.3)" },
    n: { c: tokens.text2, b: "rgba(255,255,255,.04)", br: tokens.border },
  };
  const tt = tones[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: 999,
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        background: tt.b,
        color: tt.c,
        border: `1px solid ${tt.br}`,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// ── Card ────────────────────────────────────────────────────
export type CardAccent = "g" | "t" | "p" | "a";

interface RFICardProps extends HTMLAttributes<HTMLDivElement> {
  accent?: CardAccent;
}

export function RFICard({ accent, children, style, ...rest }: RFICardProps) {
  const { tokens } = useTheme();
  const accents: Record<CardAccent, string> = {
    g: tokens.green,
    t: tokens.teal,
    p: tokens.purple,
    a: tokens.amber,
  };
  return (
    <div
      {...rest}
      style={{
        background: tokens.surface1,
        border: `1px solid ${tokens.border}`,
        borderRadius: 18,
        padding: 16,
        position: "relative",
        overflow: "hidden",
        ...style,
      }}
    >
      {accent && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: `linear-gradient(90deg, ${accents[accent]}, transparent 70%)`,
          }}
        />
      )}
      {children}
    </div>
  );
}

// ── Mono label ──────────────────────────────────────────────
export function MonoLabel({
  children,
  color,
  size = 10,
  style,
}: {
  children: ReactNode;
  color?: string;
  size?: number;
  style?: CSSProperties;
}) {
  const { tokens } = useTheme();
  return (
    <span
      style={{
        fontFamily: "JetBrains Mono, monospace",
        fontSize: size,
        letterSpacing: ".16em",
        textTransform: "uppercase",
        color: color ?? tokens.muted,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

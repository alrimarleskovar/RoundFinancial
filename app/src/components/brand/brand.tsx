"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import { useTheme } from "@/lib/theme";

// Brand primitives ported from prototype/components/brand.jsx:
//   RFILogoMark, RFILogoLockup, RFIPill, RFICard, MonoLabel.
// Each consumes tokens via useTheme() so palette switches propagate.

// The official mark, as shipped in the brand handoff. It used to be an
// inline SVG that approximated the logo with two hand-drawn paths; the
// handoff's identity rule is explicit that the mark must not be redrawn,
// simplified, or re-approximated in SVG, so this renders the real asset.
//
// Used at 28-64px across TopBar, SideNav, MobileHome, loading and
// admin/ops — the source PNG is 299x301, so every one of those is a
// downscale and stays crisp on retina.
export function RFILogoMark({ size = 28, style }: { size?: number; style?: CSSProperties }) {
  return (
    <img
      src="/brand/roundfi-official-mark.png"
      alt=""
      aria-hidden="true"
      draggable={false}
      width={size}
      height={size}
      style={{ display: "block", width: size, height: size, objectFit: "contain", ...style }}
    />
  );
}

// The official lockup — mark plus wordmark as ONE asset, rather than the
// mark beside text set in Syne. Same identity rule as above.
//
// The previous version took a `color` prop to tint the wordmark. It is
// gone: the wordmark is now baked into the artwork in white, so a caller
// could not honour it. Nothing passed it — the landing is the only
// consumer of the lockup, and the app chrome uses the bare mark — so this
// removes a prop that had no call site rather than one that mattered.
export function RFILogoLockup({
  size = 28,
  subline = false,
}: {
  size?: number;
  subline?: boolean;
}) {
  const { tokens } = useTheme();
  return (
    <div
      aria-label="RoundFi"
      role="img"
      style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start" }}
    >
      <img
        src="/brand/roundfi-official-white-lockup.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        style={{
          display: "block",
          width: "auto",
          height: size,
          maxWidth: "none",
          objectFit: "contain",
        }}
      />
      {subline && (
        <span
          style={{
            fontFamily: "DM Sans, system-ui",
            fontWeight: 400,
            fontSize: size * 0.28,
            color: tokens.text2,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginTop: size * 0.16,
            marginLeft: size * 1.2,
          }}
        >
          Collaborative Finance
        </span>
      )}
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
// Default size bumped from 10 → 11 (QA: 10px uppercase mono with
// 0.16em letter-spacing was at the threshold of unreadable across
// /home, /grupos and the admin tables). Callers that need the older,
// tighter look can still pass size={9} or size={10} explicitly.
export function MonoLabel({
  children,
  color,
  size = 11,
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

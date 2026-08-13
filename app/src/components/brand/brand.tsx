"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import { useTheme } from "@/lib/theme";

// Brand primitives ported from prototype/components/brand.jsx:
//   RFILogoMark, RFILogoLockup, RFIPill, RFICard, MonoLabel.
// Each consumes tokens via useTheme() so palette switches propagate.

export function RFILogoMark({ size = 28, style }: { size?: number; style?: CSSProperties }) {
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

// ─── Marca oficial (handoff Caio, 02/08/2026) ────────────────────────
// Aditivo de propósito. O `RFILogoMark` acima tem 5+ consumidores fora da
// landing — TopBar, SideNav, MobileHome, loading, admin/ops — e trocar a
// implementação dele levaria a marca oficial para o app inteiro de uma vez.
// Isso pode até ser o desejado, mas é decisão de escopo, não efeito
// colateral de uma landing. Enquanto a v2 é candidata, ela usa estes dois
// e o resto do app segue como está.
//
// Na graduação: mover o corpo destes para RFILogoMark / RFILogoLockup e
// apagar estes dois — os consumidores não mudam, porque a assinatura é a
// mesma.
//
// Regra de identidade do handoff: não redesenhar, não simplificar, não
// voltar a aproximar por SVG. Por isso é <img> do PNG oficial, não um path.

export function RFIOfficialMark({ size = 28, style }: { size?: number; style?: CSSProperties }) {
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

export function RFIOfficialLockup({
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

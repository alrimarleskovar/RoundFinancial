"use client";

import { MonoLabel } from "@/components/brand/brand";
import type { Tone } from "@/data/carteira";
import { useTheme } from "@/lib/theme";

// One KPI card used in the top row of the Home dashboard.

export function DeskKpi({
  label,
  value,
  delta,
  tone,
  sub,
}: {
  label: string;
  value: string | number;
  delta: string;
  tone: Tone;
  sub?: string;
}) {
  const { tokens } = useTheme();
  const toneColor = ((): string => {
    switch (tone) {
      case "g": return tokens.green;
      case "t": return tokens.teal;
      case "p": return tokens.purple;
      case "a": return tokens.amber;
      case "r": return tokens.red;
    }
  })();

  return (
    <div
      style={{
        background: tokens.surface1,
        border: `1px solid ${tokens.border}`,
        borderRadius: 16,
        padding: 18,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, ${toneColor}, transparent 70%)`,
        }}
      />
      <MonoLabel size={9}>{label}</MonoLabel>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          marginTop: 8,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-syne), Syne",
            fontSize: 28,
            fontWeight: 800,
            color: tokens.text,
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        {sub && (
          <span
            style={{
              fontSize: 12,
              color: tokens.muted,
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            }}
          >
            {sub}
          </span>
        )}
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          color: toneColor,
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
        }}
      >
        {delta}
      </div>
    </div>
  );
}

"use client";

import { MonoLabel } from "@/components/brand/brand";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Compact stat card used in the Mercado top row. Color of the delta
// line is provided by the consumer (typically a tone-mapped token).

export function MiniStat({
  label,
  value,
  delta,
  color,
}: {
  label: string;
  value: string;
  delta: string;
  color: string;
}) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  return (
    <div
      style={{
        ...glass,
        padding: 14,
        borderRadius: 12,
      }}
    >
      <MonoLabel size={9}>{label}</MonoLabel>
      <div
        style={{
          fontFamily: "var(--font-syne), Syne",
          fontSize: 22,
          fontWeight: 700,
          color: tokens.text,
          marginTop: 6,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          color,
          marginTop: 2,
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
        }}
      >
        {delta}
      </div>
    </div>
  );
}

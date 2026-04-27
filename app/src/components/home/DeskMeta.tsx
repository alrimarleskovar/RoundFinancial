"use client";

import { useTheme } from "@/lib/theme";

// Small label/value pair used inside the FeaturedGroup card.

export function DeskMeta({ label, v }: { label: string; v: string }) {
  const { tokens } = useTheme();
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          fontSize: 9,
          letterSpacing: "0.12em",
          color: tokens.muted,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-syne), Syne",
          fontSize: 20,
          fontWeight: 700,
          color: tokens.text,
          letterSpacing: "-0.02em",
          marginTop: 4,
        }}
      >
        {v}
      </div>
    </div>
  );
}

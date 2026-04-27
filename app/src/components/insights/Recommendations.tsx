"use client";

import { MonoLabel } from "@/components/brand/brand";
import type { Tone } from "@/data/carteira";
import { RECOMMENDATIONS } from "@/data/insights";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// 3-column grid of "next steps" cards under the chart + factors row.

export function Recommendations() {
  const { tokens } = useTheme();
  const t = useT();

  const toneColor = (tone: Tone): string => {
    switch (tone) {
      case "g": return tokens.green;
      case "t": return tokens.teal;
      case "p": return tokens.purple;
      case "a": return tokens.amber;
      case "r": return tokens.red;
    }
  };

  return (
    <div style={{ marginTop: 20 }}>
      <MonoLabel color={tokens.green}>{t("insights.next.title")}</MonoLabel>
      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
        }}
      >
        {RECOMMENDATIONS.map((r) => {
          const c = toneColor(r.tone);
          return (
            <div
              key={r.key}
              style={{
                padding: 18,
                borderRadius: 14,
                background: tokens.surface1,
                border: `1px solid ${tokens.border}`,
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
                  background: c,
                }}
              />
              <div
                style={{
                  fontFamily: "var(--font-syne), Syne",
                  fontSize: 22,
                  fontWeight: 800,
                  color: c,
                  letterSpacing: "-0.02em",
                }}
              >
                {t("insights.next.pts", { n: r.pts })}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: tokens.text,
                  fontWeight: 500,
                  marginTop: 8,
                }}
              >
                {t(`insights.next.${r.key}.label`)}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: tokens.muted,
                  marginTop: 4,
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {t(`insights.next.${r.key}.sub`)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

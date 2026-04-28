"use client";

import { MonoLabel } from "@/components/brand/brand";
import type { Tone } from "@/data/carteira";
import { FACTORS } from "@/data/insights";
import { useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// 5-factor behavior breakdown column. Each row: label + numeric
// value + tone-colored bar + caption.

export function FactorsList() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
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
    <div
      style={{
        ...glass,
        padding: 22,
        borderRadius: 18,
      }}
    >
      <MonoLabel color={tokens.green}>{t("insights.factors.title")}</MonoLabel>
      <div
        style={{
          marginTop: 14,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {FACTORS.map((f) => {
          const c = toneColor(f.tone);
          return (
            <div key={f.key}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    color: tokens.text,
                    fontWeight: 500,
                  }}
                >
                  {t(`insights.factor.${f.key}.label`)}
                </span>
                <span
                  style={{
                    fontFamily:
                      "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontSize: 11,
                    color: c,
                    fontWeight: 600,
                  }}
                >
                  {f.value}
                </span>
              </div>
              <div
                style={{
                  marginTop: 6,
                  height: 4,
                  background: tokens.fillMed,
                  borderRadius: 999,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${f.value}%`,
                    height: "100%",
                    background: c,
                    borderRadius: 999,
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: tokens.muted,
                  marginTop: 4,
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {t(`insights.factor.${f.key}.detail`)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

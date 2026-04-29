"use client";

import { useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import {
  RecommendationModal,
  type RecommendationDetail,
} from "@/components/insights/RecommendationModal";
import type { Tone } from "@/data/carteira";
import { RECOMMENDATIONS } from "@/data/insights";
import { useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// 3-column grid of "next steps" cards under the chart + factors row.
// Each card opens RecommendationModal with a longer-form
// explanation: why this action bumps the score, what the on-chain
// signal looks like, and the Anchor instruction path.

export function Recommendations() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const [opened, setOpened] = useState<RecommendationDetail | null>(null);

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
            <button
              key={r.key}
              type="button"
              onClick={() =>
                setOpened({ key: r.key, pts: r.pts, accent: c })
              }
              style={{
                ...glass,
                padding: 18,
                borderRadius: 14,
                position: "relative",
                overflow: "hidden",
                textAlign: "left",
                cursor: "pointer",
                fontFamily: "inherit",
                color: "inherit",
                transition: "transform 180ms ease, border-color 180ms ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.borderColor = `${c}55`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.borderColor = "";
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
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginTop: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    color: tokens.muted,
                    fontFamily:
                      "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  }}
                >
                  {t(`insights.next.${r.key}.sub`)}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: c,
                    fontFamily:
                      "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontWeight: 700,
                  }}
                >
                  {t("insights.next.viewDetails")} →
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <RecommendationModal
        detail={opened}
        open={opened !== null}
        onClose={() => setOpened(null)}
      />
    </div>
  );
}

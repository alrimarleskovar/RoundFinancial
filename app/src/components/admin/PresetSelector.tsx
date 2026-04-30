"use client";

import { MonoLabel } from "@/components/brand/brand";
import { DEMO_PRESETS, type DemoPresetId } from "@/lib/demoState";
import { useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Preset selector — full-width strip above the 3 control panels.
// Each preset is a tonal pill with a one-line description that
// loads a fully configured scenario into the demo reducer (carta,
// months, score, current month, contemplated flag, etc).

export function PresetSelector({
  activeId,
  onLoad,
}: {
  activeId: DemoPresetId | null;
  onLoad: (id: DemoPresetId) => void;
}) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();

  const toneColor = (tone: string): string => {
    switch (tone) {
      case "green": return tokens.green;
      case "teal": return tokens.teal;
      case "amber": return tokens.amber;
      case "red": return tokens.red;
      case "purple": return tokens.purple;
      default: return tokens.text2;
    }
  };

  return (
    <div
      style={{
        ...glass,
        padding: 18,
        borderRadius: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <MonoLabel color={tokens.purple}>{t("admin.preset.title")}</MonoLabel>
        <span
          style={{
            fontSize: 11,
            color: tokens.muted,
            fontFamily:
              "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
        >
          {t("admin.preset.hint")}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
        }}
      >
        {DEMO_PRESETS.map((p) => {
          const tone = toneColor(p.tone);
          const active = activeId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onLoad(p.id)}
              style={{
                textAlign: "left",
                padding: "12px 14px",
                borderRadius: 11,
                cursor: "pointer",
                background: active ? `${tone}1F` : `${tone}0A`,
                border: `1.5px solid ${active ? tone : `${tone}40`}`,
                color: tokens.text,
                fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                transition: "all 200ms ease",
                position: "relative",
                overflow: "hidden",
              }}
              onMouseEnter={(e) => {
                if (active) return;
                e.currentTarget.style.background = `${tone}14`;
                e.currentTarget.style.borderColor = `${tone}77`;
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                if (active) return;
                e.currentTarget.style.background = `${tone}0A`;
                e.currentTarget.style.borderColor = `${tone}40`;
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              {/* Top stripe */}
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: tone,
                  opacity: active ? 1 : 0.5,
                }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: tokens.text,
                  }}
                >
                  {t(p.labelKey)}
                </span>
                {active && (
                  <span
                    style={{
                      fontSize: 9,
                      padding: "2px 7px",
                      borderRadius: 999,
                      background: `${tone}33`,
                      color: tone,
                      fontWeight: 700,
                      fontFamily:
                        "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      whiteSpace: "nowrap",
                    }}
                  >
                    ◆ {t("admin.preset.active")}
                  </span>
                )}
              </div>
              <span
                style={{
                  display: "block",
                  fontSize: 11,
                  color: tokens.text2,
                  lineHeight: 1.4,
                }}
              >
                {t(p.descriptionKey)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

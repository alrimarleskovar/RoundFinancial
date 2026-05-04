"use client";

import { MonoLabel } from "@/components/brand/brand";
import { useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// 4-step "como funciona" sidebar list.

export function HowItWorks() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();

  const steps: ReadonlyArray<readonly [string, string]> = [
    ["01", t("market.howWorks.s1")],
    ["02", t("market.howWorks.s2")],
    ["03", t("market.howWorks.s3")],
    ["04", t("market.howWorks.s4")],
  ];

  return (
    <div
      style={{
        ...glass,
        padding: 18,
        borderRadius: 16,
      }}
    >
      <MonoLabel color={tokens.green}>{t("market.howWorks.title")}</MonoLabel>
      <div
        style={{
          marginTop: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {steps.map(([n, txt]) => (
          <div key={n} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span
              style={{
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                fontSize: 10,
                color: tokens.green,
                fontWeight: 600,
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              {n}
            </span>
            <span style={{ fontSize: 11, color: tokens.text2 }}>{txt}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

import { MonoLabel } from "@/components/brand/brand";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Honest data-source label for /reputacao. The passport mixes on-chain
// SAS infrastructure (deployed on devnet) with session-reducer reflection
// (Demo Studio flow). External review flagged that an auditor walking in
// cold can't tell which is which — this banner makes it explicit.
//
// Two badges, side by side:
//   • DEVNET · SAS schema deployed   (truth about infrastructure)
//   • DEMO STUDIO · session reflection (truth about the rendered numbers)
//
// Plus a one-paragraph body explaining the wiring path.

export function DataSourceNote() {
  const { tokens } = useTheme();
  const t = useT();
  return (
    <div
      style={{
        marginTop: 18,
        borderRadius: 14,
        padding: "14px 18px",
        background: `linear-gradient(135deg, ${tokens.bgDeep} 0%, ${tokens.navy} 100%)`,
        border: `1px solid ${tokens.borderStr}`,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        <MonoLabel color={tokens.green}>◆ {t("score.dataSource.title")}</MonoLabel>
        <span
          style={{
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            fontSize: 9.5,
            letterSpacing: "0.08em",
            padding: "3px 8px",
            borderRadius: 6,
            color: tokens.teal,
            background: `${tokens.teal}1A`,
            border: `1px solid ${tokens.teal}33`,
          }}
        >
          {t("score.dataSource.devnetBadge")}
        </span>
        <span
          style={{
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            fontSize: 9.5,
            letterSpacing: "0.08em",
            padding: "3px 8px",
            borderRadius: 6,
            color: tokens.amber,
            background: `${tokens.amber}1A`,
            border: `1px solid ${tokens.amber}33`,
          }}
        >
          {t("score.dataSource.demoBadge")}
        </span>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 11.5,
          lineHeight: 1.55,
          color: tokens.text2,
          maxWidth: 720,
        }}
      >
        {t("score.dataSource.body")}
      </p>
    </div>
  );
}

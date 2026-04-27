"use client";

import { MonoLabel } from "@/components/brand/brand";
import { FactorsList } from "@/components/insights/FactorsList";
import { Recommendations } from "@/components/insights/Recommendations";
import { ScoreEvolution } from "@/components/insights/ScoreEvolution";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

export function InsightsClient() {
  const { tokens } = useTheme();
  const t = useT();
  return (
    <div style={{ padding: 32 }}>
      <MonoLabel color={tokens.green}>{t("insights.badge")}</MonoLabel>
      <div
        style={{
          fontFamily: "var(--font-syne), Syne",
          fontSize: 32,
          fontWeight: 800,
          color: tokens.text,
          letterSpacing: "-0.03em",
          marginTop: 4,
        }}
      >
        {t("insights.title")}
      </div>
      <div
        style={{
          fontSize: 13,
          color: tokens.text2,
          marginTop: 4,
        }}
      >
        {t("insights.subtitle")}
      </div>

      <div
        style={{
          marginTop: 24,
          display: "grid",
          gridTemplateColumns: "1.6fr 1fr",
          gap: 16,
        }}
      >
        <ScoreEvolution />
        <FactorsList />
      </div>

      <Recommendations />
    </div>
  );
}

"use client";

import { MonoLabel } from "@/components/brand/brand";
import { BondsList } from "@/components/score/BondsList";
import { DataSourceNote } from "@/components/score/DataSourceNote";
import { LevelsList } from "@/components/score/LevelsList";
import { ReputationPassport } from "@/components/score/ReputationPassport";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// /reputacao — SAS passport screen. 1.4fr/1fr split between the big
// passport card and the levels ladder; bonds list spans full width
// below.

export default function ReputacaoPage() {
  return <ScoreContent />;
}

function ScoreContent() {
  const { tokens } = useTheme();
  const t = useT();
  return (
    <div style={{ padding: 32 }}>
      <MonoLabel color={tokens.green}>{t("score.badge")}</MonoLabel>
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
        {t("score.title")}
      </div>

      <DataSourceNote />

      <div
        style={{
          marginTop: 24,
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr",
          gap: 20,
        }}
      >
        <ReputationPassport />
        <LevelsList />
      </div>

      <BondsList />
    </div>
  );
}

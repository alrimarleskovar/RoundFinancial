"use client";

import { DeskKpi } from "@/components/home/DeskKpi";
import { USER } from "@/data/carteira";
import { useI18n, useT } from "@/lib/i18n";

// 4-column KPI strip below the hero.

export function HomeKpis() {
  const t = useT();
  const { fmtMoney } = useI18n();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 16,
      }}
    >
      <DeskKpi
        label={t("home.kpi.balance")}
        value={fmtMoney(USER.balance)}
        delta={t("home.kpi.delta.balance")}
        tone="g"
      />
      <DeskKpi
        label={t("home.kpi.score")}
        value={USER.score}
        delta={t("home.kpi.delta.score", { d: USER.scoreDelta })}
        tone="t"
        sub="/ 850"
      />
      <DeskKpi
        label={t("home.kpi.yield")}
        value={fmtMoney(USER.yield)}
        delta={t("home.kpi.delta.yield")}
        tone="p"
      />
      <DeskKpi
        label={t("home.kpi.colat")}
        value={`${USER.colateralPct}%`}
        delta={t("home.kpi.delta.lev", { x: USER.leverageX })}
        tone="a"
      />
    </div>
  );
}

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
        numericValue={USER.balance}
        format={(n) => fmtMoney(n)}
        delta={t("home.kpi.delta.balance")}
        tone="g"
      />
      <DeskKpi
        label={t("home.kpi.score")}
        value={USER.score}
        numericValue={USER.score}
        format={(n) => Math.round(n).toString()}
        delta={t("home.kpi.delta.score", { d: USER.scoreDelta })}
        tone="t"
        sub="/ 850"
      />
      <DeskKpi
        label={t("home.kpi.yield")}
        value={fmtMoney(USER.yield)}
        numericValue={USER.yield}
        format={(n) => fmtMoney(n)}
        delta={t("home.kpi.delta.yield")}
        tone="p"
      />
      <DeskKpi
        label={t("home.kpi.colat")}
        value={`${USER.colateralPct}%`}
        numericValue={USER.colateralPct}
        format={(n) => `${Math.round(n)}%`}
        delta={t("home.kpi.delta.lev", { x: USER.leverageX })}
        tone="a"
      />
    </div>
  );
}

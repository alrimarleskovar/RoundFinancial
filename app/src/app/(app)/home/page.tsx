"use client";

import { Activity } from "@/components/home/Activity";
import { DeskKpi } from "@/components/home/DeskKpi";
import { FeaturedGroup } from "@/components/home/FeaturedGroup";
import { HomeHero } from "@/components/home/HomeHero";
import { PassportMini } from "@/components/home/PassportMini";
import { TripleShield } from "@/components/home/TripleShield";
import { YourGroups } from "@/components/home/YourGroups";
import { useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";

// /home — Bento dashboard. Hero on top, then a 4-col asymmetric
// grid: 3 KPIs + tall radial Score on the right; FeaturedGroup
// spans 3 cols below; YourGroups + TripleShield split the next
// row; Activity terminal log spans the full width at the bottom.
//
//   row 1:  [ hero  hero  hero  hero ]
//   row 2:  [ saldo  yield  colat  score ]
//   row 3:  [ feat   feat   feat   score ]
//   row 4:  [ groups groups triplo triplo ]
//   row 5:  [ act    act    act    act   ]

export default function HomePage() {
  const t = useT();
  const { fmtMoney } = useI18n();
  const { user } = useSession();
  return (
    <div
      style={{
        padding: 32,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
        <HomeHero />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gridAutoRows: "auto",
            gridTemplateAreas: `
              "saldo yield colat score"
              "feat  feat  feat  score"
              "groups groups triplo triplo"
              "act    act    act    act"
            `,
            gap: 16,
          }}
        >
          <div style={{ gridArea: "saldo" }}>
            <DeskKpi
              label={t("home.kpi.balance")}
              value={fmtMoney(user.balance)}
              numericValue={user.balance}
              format={(n) => fmtMoney(n)}
              delta={t("home.kpi.delta.balance")}
              tone="g"
              href="/carteira"
            />
          </div>
          <div style={{ gridArea: "yield" }}>
            <DeskKpi
              label={t("home.kpi.yield")}
              value={fmtMoney(user.yield)}
              numericValue={user.yield}
              format={(n) => fmtMoney(n)}
              delta={t("home.kpi.delta.yield")}
              tone="p"
              href="/carteira"
            />
          </div>
          <div style={{ gridArea: "colat" }}>
            <DeskKpi
              label={t("home.kpi.colat")}
              value={`${user.colateralPct}%`}
              numericValue={user.colateralPct}
              format={(n) => `${Math.round(n)}%`}
              delta={t("home.kpi.delta.lev", { x: user.leverageX })}
              tone="a"
              href="/insights"
            />
          </div>
          <div style={{ gridArea: "score", display: "flex" }}>
            <PassportMini />
          </div>

          <div style={{ gridArea: "feat" }}>
            <FeaturedGroup />
          </div>

          <div style={{ gridArea: "groups" }}>
            <YourGroups />
          </div>
          <div style={{ gridArea: "triplo" }}>
            <TripleShield />
          </div>

          <div style={{ gridArea: "act" }}>
            <Activity />
          </div>
        </div>
    </div>
  );
}

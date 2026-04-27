"use client";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { DeskBtn } from "@/components/home/DeskBtn";
import { USER } from "@/data/carteira";
import { useI18n, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Top header strip on /home: "Bom dia, {first}" + summary line + 2 CTAs.

export function HomeHero() {
  const { tokens } = useTheme();
  const t = useT();
  const { fmtMoney } = useI18n();
  const firstName = USER.name.split(" ")[0];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <MonoLabel color={tokens.green}>{t("home.badge")}</MonoLabel>
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
          {t("home.greeting")} {firstName}
        </div>
        <div
          style={{
            fontSize: 13,
            color: tokens.text2,
            marginTop: 4,
          }}
        >
          {t("home.summary.a")}{" "}
          <span style={{ color: tokens.green, fontWeight: 600 }}>
            {t("home.summary.b")}
          </span>{" "}
          {t("home.summary.c")}{" "}
          <span style={{ color: tokens.teal, fontWeight: 600 }}>
            {t("home.yieldAmt", { v: fmtMoney(USER.yield, { noCents: true }) })}
          </span>
          .
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <DeskBtn tone="primary" icon={Icons.send} href="/carteira">
          {t("home.payInstallment")}
        </DeskBtn>
        <DeskBtn icon={Icons.plus} href="/grupos">
          {t("home.joinGroup")}
        </DeskBtn>
      </div>
    </div>
  );
}

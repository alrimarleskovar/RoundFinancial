"use client";

import { useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import {
  BuyOfferModal,
  type BuyOfferTarget,
} from "@/components/mercado/BuyOfferModal";
import { FeaturedOffer } from "@/components/mercado/FeaturedOffer";
import { HowItWorks } from "@/components/mercado/HowItWorks";
import { MiniStat } from "@/components/mercado/MiniStat";
import { OffersTable } from "@/components/mercado/OffersTable";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

type Tab = "buy" | "sell";

export function MercadoClient() {
  const { tokens } = useTheme();
  const t = useT();
  const [tab, setTab] = useState<Tab>("buy");
  const [buying, setBuying] = useState<BuyOfferTarget | null>(null);

  return (
    <div style={{ padding: 32 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <MonoLabel color={tokens.green}>{t("market.badge")}</MonoLabel>
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
            {t("market.title")}
          </div>
          <div
            style={{
              fontSize: 13,
              color: tokens.text2,
              marginTop: 4,
            }}
          >
            {t("market.subtitle")}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: 4,
            borderRadius: 11,
            background: tokens.fillSoft,
            border: `1px solid ${tokens.border}`,
          }}
        >
          {(["buy", "sell"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                cursor: "pointer",
                border: "none",
                background: tab === id ? tokens.surface2 : "transparent",
                color: tab === id ? tokens.text : tokens.text2,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
              }}
            >
              {id === "buy" ? t("market.tab.buy") : t("market.tab.sell")}
            </button>
          ))}
        </div>
      </div>

      {/* Top stats */}
      <div
        style={{
          marginTop: 20,
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        <MiniStat
          label={t("market.stat.volume")}
          value="R$ 48.2k"
          delta={t("market.stat.volumeDelta")}
          color={tokens.green}
        />
        <MiniStat
          label={t("market.stat.pools")}
          value="27"
          delta={t("market.stat.poolsDelta")}
          color={tokens.teal}
        />
        <MiniStat
          label={t("market.stat.disc")}
          value="−11,4%"
          delta={t("market.stat.discSub")}
          color={tokens.amber}
        />
        <MiniStat
          label={t("market.stat.apy")}
          value="7,2%"
          delta={t("market.stat.apySub")}
          color={tokens.purple}
        />
      </div>

      {tab === "buy" ? (
        <div
          style={{
            marginTop: 24,
            display: "grid",
            gridTemplateColumns: "1.3fr 1fr",
            gap: 16,
          }}
        >
          <OffersTable onBuy={(target) => setBuying(target)} />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <FeaturedOffer onBuy={(target) => setBuying(target)} />
            <HowItWorks />
          </div>
        </div>
      ) : (
        <div
          style={{
            marginTop: 24,
            padding: 40,
            borderRadius: 18,
            textAlign: "center",
            background: tokens.surface1,
            border: `1px dashed ${tokens.borderStr}`,
          }}
        >
          <MonoLabel color={tokens.amber}>{t("market.sell.badge")}</MonoLabel>
          <div
            style={{
              fontFamily: "var(--font-syne), Syne",
              fontSize: 20,
              fontWeight: 700,
              color: tokens.text,
              marginTop: 8,
            }}
          >
            {t("market.sell.title")}
          </div>
          <div
            style={{
              fontSize: 12,
              color: tokens.text2,
              marginTop: 6,
              maxWidth: 420,
              margin: "6px auto 0",
            }}
          >
            {t("market.sell.body")}
          </div>
        </div>
      )}

      <BuyOfferModal
        target={buying}
        open={buying !== null}
        onClose={() => setBuying(null)}
      />
    </div>
  );
}

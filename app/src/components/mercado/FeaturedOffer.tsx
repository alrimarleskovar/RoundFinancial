"use client";

import type { BuyOfferTarget } from "@/components/mercado/BuyOfferModal";
import { MonoLabel } from "@/components/brand/brand";
import { FEATURED_OFFER } from "@/data/market";
import { useI18n, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Sidebar "destaque do dia" card. Highlights one offer with a
// purple-tinted gradient + face/price progress + buy CTA.

export function FeaturedOffer({
  onBuy,
}: {
  onBuy: (target: BuyOfferTarget) => void;
}) {
  const { tokens } = useTheme();
  const t = useT();
  const { fmtMoney } = useI18n();
  const f = FEATURED_OFFER;

  return (
    <div
      style={{
        padding: 22,
        borderRadius: 18,
        position: "relative",
        overflow: "hidden",
        background: `linear-gradient(145deg, ${tokens.purple}22, ${tokens.surface1} 70%)`,
        border: `1px solid ${tokens.purple}33`,
      }}
    >
      <MonoLabel color={tokens.purple}>{t("market.featured.badge")}</MonoLabel>
      <div
        style={{
          fontFamily: "var(--font-syne), Syne",
          fontSize: 22,
          fontWeight: 700,
          color: tokens.text,
          marginTop: 10,
          letterSpacing: "-0.02em",
        }}
      >
        {f.group}
      </div>
      <div style={{ fontSize: 12, color: tokens.text2, marginTop: 4 }}>
        {t("market.featured.subtitle", { m: f.monthsLeft, s: f.sellerScore })}
      </div>

      <div
        style={{
          marginTop: 18,
          padding: 14,
          borderRadius: 12,
          background: tokens.fillSoft,
          border: `1px solid ${tokens.border}`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <MonoLabel size={9}>{t("market.featured.face")}</MonoLabel>
          <span
            style={{
              fontFamily:
                "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              fontSize: 13,
              color: tokens.text2,
            }}
          >
            {fmtMoney(f.face, { noCents: true })}
          </span>
        </div>
        <div
          style={{
            marginTop: 8,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <MonoLabel size={9} color={tokens.green}>
            {t("market.featured.yourPrice")}
          </MonoLabel>
          <span
            style={{
              fontFamily: "var(--font-syne), Syne",
              fontSize: 24,
              fontWeight: 800,
              color: tokens.text,
              letterSpacing: "-0.02em",
            }}
          >
            {fmtMoney(f.price, { noCents: true })}
          </span>
        </div>
        <div
          style={{
            marginTop: 10,
            height: 3,
            background: tokens.fillMed,
            borderRadius: 999,
          }}
        >
          <div
            style={{
              width: `${f.fillPct}%`,
              height: "100%",
              background: `linear-gradient(90deg, ${tokens.purple}, ${tokens.teal})`,
              borderRadius: 999,
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 8,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            fontSize: 10,
            color: tokens.muted,
          }}
        >
          <span>{t("market.featured.discountLabel")}</span>
          <span style={{ color: tokens.green }}>
            {t("market.featured.apyHint", {
              d: f.effectiveDiscount,
              a: f.apyEquivalent,
            })}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={() =>
          onBuy({
            id: f.id,
            group: f.group,
            detail: t("market.featured.subtitle", {
              m: f.monthsLeft,
              s: f.sellerScore,
            }),
            face: f.face,
            price: f.price,
            discount: f.effectiveDiscount,
          })
        }
        style={{
          marginTop: 12,
          width: "100%",
          padding: 11,
          borderRadius: 11,
          background: `linear-gradient(135deg, ${tokens.purple}, ${tokens.teal})`,
          color: "#fff",
          border: "none",
          fontWeight: 700,
          fontSize: 12,
          cursor: "pointer",
          fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
        }}
      >
        {t("market.featured.cta")}
      </button>
    </div>
  );
}

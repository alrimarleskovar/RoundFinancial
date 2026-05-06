"use client";

import type { BuyOfferTarget } from "@/components/mercado/BuyOfferModal";
import { MonoLabel } from "@/components/brand/brand";
import { NoListingsYet } from "@/components/mercado/NoListingsYet";
import { MARKET_OFFERS } from "@/data/market";
import { useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Order book table for the Buy tab. Each row = one NFT share resold
// below face value.

export function OffersTable({ onBuy }: { onBuy: (target: BuyOfferTarget) => void }) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { fmtMoney } = useI18n();
  const { purchasedOfferIds } = useSession();
  const purchasedSet = new Set(purchasedOfferIds);

  return (
    <div
      style={{
        ...glass,
        padding: 20,
        borderRadius: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <MonoLabel color={tokens.green}>{t("market.offers.title")}</MonoLabel>
        <span
          style={{
            fontSize: 11,
            color: tokens.muted,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
        >
          {t("market.offers.sortHint")}
        </span>
      </div>

      {MARKET_OFFERS.length === 0 && <NoListingsYet />}

      {MARKET_OFFERS.length > 0 && (
        <div
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "60px 1.3fr 1fr 1fr 1fr auto",
            gap: 12,
            padding: "0 12px 8px",
            borderBottom: `1px solid ${tokens.border}`,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            fontSize: 9,
            color: tokens.muted,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          <span>{t("market.offers.col.share")}</span>
          <span>{t("market.offers.col.group")}</span>
          <span>{t("market.offers.col.face")}</span>
          <span>{t("market.offers.col.price")}</span>
          <span>{t("market.offers.col.disc")}</span>
          <span />
        </div>
      )}

      {MARKET_OFFERS.map((o, i) => {
        const purchased = purchasedSet.has(o.id);
        return (
          <div
            key={o.id}
            style={{
              display: "grid",
              gridTemplateColumns: "60px 1.3fr 1fr 1fr 1fr auto",
              gap: 12,
              padding: "12px",
              alignItems: "center",
              borderBottom: i < MARKET_OFFERS.length - 1 ? `1px solid ${tokens.border}` : "none",
              opacity: purchased ? 0.55 : 1,
              transition: "opacity 220ms ease",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-syne), Syne",
                fontSize: 15,
                fontWeight: 800,
                color: tokens.text,
                display: "flex",
                alignItems: "baseline",
                gap: 2,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: tokens.muted,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  fontWeight: 500,
                }}
              >
                #
              </span>
              {o.num}
            </div>
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: tokens.text,
                }}
              >
                {o.group}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: tokens.muted,
                  marginTop: 2,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {t("home.month")} {o.month}/{o.total}
              </div>
            </div>
            <div
              style={{
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                fontSize: 12,
                color: tokens.text2,
              }}
            >
              {fmtMoney(o.face, { noCents: true })}
            </div>
            <div
              style={{
                fontFamily: "var(--font-syne), Syne",
                fontSize: 14,
                fontWeight: 700,
                color: tokens.text,
              }}
            >
              {fmtMoney(o.price, { noCents: true })}
            </div>
            <div
              style={{
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                fontSize: 12,
                color: tokens.green,
                fontWeight: 600,
              }}
            >
              −{o.disc}%
            </div>
            {purchased ? (
              <span
                style={{
                  padding: "6px 11px",
                  borderRadius: 8,
                  fontSize: 10,
                  fontWeight: 700,
                  background: `${tokens.green}1F`,
                  border: `1px solid ${tokens.green}55`,
                  color: tokens.green,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                ✓ {t("market.offers.purchased")}
              </span>
            ) : (
              <button
                type="button"
                onClick={() =>
                  onBuy({
                    id: o.id,
                    group: o.group,
                    detail: `#${o.num} · ${t("home.month")} ${o.month}/${o.total}`,
                    face: o.face,
                    price: o.price,
                    discount: o.disc,
                    num: o.num,
                    month: o.month,
                    total: o.total,
                  })
                }
                style={{
                  padding: "7px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: tokens.fillSoft,
                  color: tokens.text,
                  fontSize: 11,
                  fontWeight: 600,
                  border: `1px solid ${tokens.borderStr}`,
                }}
              >
                {t("market.offers.cta.buy")}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

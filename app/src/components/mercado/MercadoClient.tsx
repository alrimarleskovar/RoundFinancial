"use client";

import { useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { BuyOfferModal, type BuyOfferTarget } from "@/components/mercado/BuyOfferModal";
import { FeaturedOffer } from "@/components/mercado/FeaturedOffer";
import { HowItWorks } from "@/components/mercado/HowItWorks";
import { ListingDetailsModal } from "@/components/mercado/ListingDetailsModal";
import { MiniStat } from "@/components/mercado/MiniStat";
import { MyPurchases } from "@/components/mercado/MyPurchases";
import { OffersTable } from "@/components/mercado/OffersTable";
import { SellPositionModal } from "@/components/mercado/SellPositionModal";
import { SellPositionsList } from "@/components/mercado/SellPositionsList";
import type { NftPosition } from "@/data/carteira";
import { useT } from "@/lib/i18n";
import { useSession, type ActiveListing } from "@/lib/session";
import { useTheme } from "@/lib/theme";

type Tab = "buy" | "sell";

export function MercadoClient() {
  const { tokens } = useTheme();
  const t = useT();
  const { buyShare, sellShare, cancelListing, listings } = useSession();
  const [tab, setTab] = useState<Tab>("buy");
  const [buying, setBuying] = useState<BuyOfferTarget | null>(null);
  const [selling, setSelling] = useState<NftPosition | null>(null);
  const [openListing, setOpenListing] = useState<ActiveListing | null>(null);

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
        <>
          <MyPurchases />
          <div
            style={{
              marginTop: 16,
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
        </>
      ) : (
        <div style={{ marginTop: 24 }}>
          <SellPositionsList
            listings={listings}
            onSell={(position) => setSelling(position)}
            onOpenListing={(l) => setOpenListing(l)}
          />
        </div>
      )}

      <BuyOfferModal
        target={buying}
        open={buying !== null}
        onClose={() => setBuying(null)}
        onPurchased={(target) => {
          // Forward the full target so /carteira can render the cota
          // natively (num/month/total flow through to acquiredPositions).
          buyShare({
            offerId: target.id,
            group: target.group,
            price: target.price,
            face: target.face,
            num: target.num,
            month: target.month,
            total: target.total,
            tone: target.tone,
          });
        }}
      />
      <SellPositionModal
        position={selling}
        open={selling !== null}
        onClose={() => setSelling(null)}
        onListed={({ position, askPrice, discountPct }) => {
          // Single source of truth: reducer writes the listing AND
          // emits the sale event. No more local-state shadowing.
          sellShare(position, askPrice, discountPct);
        }}
      />
      <ListingDetailsModal
        listing={openListing}
        open={openListing !== null}
        onClose={() => setOpenListing(null)}
        onCancel={(listingId) => {
          cancelListing(listingId);
        }}
      />
    </div>
  );
}

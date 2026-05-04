"use client";

import { MonoLabel } from "@/components/brand/brand";
import type { ActiveListing } from "@/components/mercado/ListingDetailsModal";
import type { NftPosition } from "@/data/carteira";
import { NFT_POSITIONS } from "@/data/carteira";
import { useI18n, useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme, type ThemeTokens } from "@/lib/theme";

// Sell tab — split into two stacks:
//  1. "Minhas posições disponíveis" — NFT positions the user holds
//     that are NOT currently listed. Each row has a "Listar no
//     mercado" CTA that opens SellPositionModal.
//  2. "Minhas listagens" — quotas the user has already listed in
//     this session. Each row is clickable and opens
//     ListingDetailsModal showing pricing, slashing window, and a
//     cancel button.
//
// Listings live in MercadoClient state (no persistence) so the
// "available" pool is derived by filtering NFT_POSITIONS against
// the current listings.

export function SellPositionsList({
  listings,
  onSell,
  onOpenListing,
}: {
  listings: ActiveListing[];
  onSell: (position: NftPosition) => void;
  onOpenListing: (listing: ActiveListing) => void;
}) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { fmtMoney } = useI18n();

  const listedIds = new Set(listings.map((l) => l.position.id));
  const available = NFT_POSITIONS.filter((p) => !listedIds.has(p.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Active listings (only when present) */}
      {listings.length > 0 && (
        <div
          style={{
            ...glass,
            padding: 22,
            borderRadius: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 14,
            }}
          >
            <MonoLabel color={tokens.green}>◆ {t("market.listings.title")}</MonoLabel>
            <span
              style={{
                fontSize: 11,
                color: tokens.muted,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {t("market.listings.count", { n: listings.length })}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {listings.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => onOpenListing(l)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "60px 1fr auto auto",
                  gap: 14,
                  alignItems: "center",
                  padding: 14,
                  borderRadius: 12,
                  background: `${tokens.green}0D`,
                  border: `1px solid ${tokens.green}44`,
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                  transition: "all 200ms ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = `${tokens.green}1A`;
                  e.currentTarget.style.borderColor = `${tokens.green}77`;
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = `${tokens.green}0D`;
                  e.currentTarget.style.borderColor = `${tokens.green}44`;
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-syne), Syne",
                    fontSize: 18,
                    fontWeight: 800,
                    color: toneColor(l.position.tone, tokens),
                    display: "flex",
                    alignItems: "baseline",
                    gap: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: tokens.muted,
                      fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                      fontWeight: 500,
                    }}
                  >
                    #
                  </span>
                  {l.position.num}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: tokens.text,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {l.position.group}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: tokens.muted,
                      marginTop: 3,
                      fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    }}
                  >
                    {fmtMoney(l.askPrice, { noCents: true })} ·{" "}
                    {l.discountPct > 0
                      ? `−${l.discountPct.toFixed(0)}%`
                      : t("market.listings.facePrice")}
                  </div>
                </div>
                <span
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: `${tokens.green}1F`,
                    border: `1px solid ${tokens.green}55`,
                    color: tokens.green,
                    fontSize: 9,
                    fontWeight: 700,
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t("market.listings.statusActive")}
                </span>
                <span
                  style={{
                    color: tokens.text2,
                    fontSize: 16,
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  }}
                >
                  ›
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Available positions */}
      <div
        style={{
          ...glass,
          padding: 22,
          borderRadius: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 14,
          }}
        >
          <MonoLabel color={tokens.amber}>{t("market.sellList.title")}</MonoLabel>
          <span
            style={{
              fontSize: 11,
              color: tokens.muted,
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            }}
          >
            {t("market.sellList.count", { n: available.length })}
          </span>
        </div>

        {available.length === 0 ? (
          <div
            style={{
              padding: 18,
              borderRadius: 12,
              background: tokens.fillSoft,
              border: `1px dashed ${tokens.border}`,
              textAlign: "center",
              fontSize: 12,
              color: tokens.text2,
              lineHeight: 1.5,
            }}
          >
            {t("market.sellList.allListed")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {available.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "60px 1fr auto auto",
                  gap: 14,
                  alignItems: "center",
                  padding: 14,
                  borderRadius: 12,
                  background: tokens.fillSoft,
                  border: `1px solid ${tokens.border}`,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-syne), Syne",
                    fontSize: 18,
                    fontWeight: 800,
                    color: toneColor(p.tone, tokens),
                    display: "flex",
                    alignItems: "baseline",
                    gap: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: tokens.muted,
                      fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                      fontWeight: 500,
                    }}
                  >
                    #
                  </span>
                  {p.num}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: tokens.text,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p.group}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: tokens.muted,
                      marginTop: 3,
                      fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    }}
                  >
                    {t("home.month")} {p.month}/{p.total} · {p.exp}
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-syne), Syne",
                    fontSize: 15,
                    fontWeight: 700,
                    color: tokens.text,
                    textAlign: "right",
                  }}
                >
                  {fmtMoney(p.value, { noCents: true })}
                </div>
                <button
                  type="button"
                  onClick={() => onSell(p)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 9,
                    cursor: "pointer",
                    background: `linear-gradient(135deg, ${tokens.purple}33, ${tokens.teal}33)`,
                    color: tokens.text,
                    fontSize: 11,
                    fontWeight: 700,
                    border: `1px solid ${tokens.purple}55`,
                    fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t("market.sellList.cta")}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Whitepaper escape-valve callout — anchors the demo flow to
            the protocol's documented exit path. */}
        <div
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 10,
            background: `${tokens.green}0D`,
            border: `1px solid ${tokens.green}33`,
            fontSize: 11,
            color: tokens.text2,
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: tokens.text, fontWeight: 700 }}>
            {t("market.sellList.escapeValveTitle")}
          </strong>{" "}
          {t("market.sellList.escapeValveBody")}
        </div>
      </div>
    </div>
  );
}

function toneColor(tone: NftPosition["tone"], tokens: ThemeTokens): string {
  switch (tone) {
    case "g":
      return tokens.green;
    case "t":
      return tokens.teal;
    case "p":
      return tokens.purple;
    case "a":
      return tokens.amber;
    case "r":
      return tokens.red;
    default:
      return tokens.text;
  }
}

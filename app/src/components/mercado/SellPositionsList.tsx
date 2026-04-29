"use client";

import { MonoLabel } from "@/components/brand/brand";
import type { NftPosition } from "@/data/carteira";
import { NFT_POSITIONS } from "@/data/carteira";
import { useI18n, useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme, type ThemeTokens } from "@/lib/theme";

// Sell tab — shows the user's NFT positions as cards. Each card has
// a "List on market" CTA that opens SellPositionModal pre-filled
// with the position's data.

export function SellPositionsList({
  onSell,
}: {
  onSell: (position: NftPosition) => void;
}) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { fmtMoney } = useI18n();

  return (
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
        <MonoLabel color={tokens.amber}>
          {t("market.sellList.title")}
        </MonoLabel>
        <span
          style={{
            fontSize: 11,
            color: tokens.muted,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
        >
          {t("market.sellList.count", { n: NFT_POSITIONS.length })}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {NFT_POSITIONS.map((p) => (
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
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
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
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
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

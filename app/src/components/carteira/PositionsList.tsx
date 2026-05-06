"use client";

import { useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { SellShareModal } from "@/components/modals/SellShareModal";
import { NFT_POSITIONS, type NftPosition, type Tone } from "@/data/carteira";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// NFT positions list. When `limit` is set, renders a short preview
// without the "Sell" action (used inside Visão geral); otherwise the
// full list renders (used in the dedicated Positions tab — B.2.b).
//
// Reads (NFT_POSITIONS fixture ∪ session.acquiredPositions) so cotas
// bought from /mercado show up natively here, and renders a
// "LISTADO" badge instead of the Sell CTA when the position is
// currently up on the secondary market.

export function PositionsList({ limit }: { limit?: number }) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const { t, fmtMoney } = useI18n();
  const { acquiredPositions, listings } = useSession();
  const [selling, setSelling] = useState<NftPosition | null>(null);
  const allPositions = [...NFT_POSITIONS, ...acquiredPositions];
  const rows: NftPosition[] = limit ? allPositions.slice(0, limit) : allPositions;
  const listedIds = new Set(listings.map((l) => l.position.id));
  const toneColor = (tone: Tone): string => {
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
    }
  };
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
        <MonoLabel color={tokens.green}>{t("wallet.positions")}</MonoLabel>
        <span
          style={{
            fontSize: 11,
            color: tokens.muted,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
        >
          {t("wallet.positions.c", { n: allPositions.length })}
        </span>
      </div>
      <div
        style={{
          marginTop: 14,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {rows.map((n) => {
          const c = toneColor(n.tone);
          return (
            <div
              key={n.id}
              style={{
                display: "grid",
                gridTemplateColumns: limit ? "52px 1fr auto" : "52px 1fr auto auto",
                gap: 14,
                padding: 12,
                borderRadius: 12,
                background: tokens.fillSoft,
                border: `1px solid ${tokens.border}`,
                alignItems: "center",
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 10,
                  background: `linear-gradient(135deg, ${c}33, ${c}11)`,
                  border: `1px solid ${c}4D`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--font-syne), Syne",
                  fontWeight: 800,
                  fontSize: 14,
                  color: c,
                  flexDirection: "column",
                }}
              >
                <span
                  style={{
                    fontSize: 8,
                    opacity: 0.7,
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontWeight: 500,
                  }}
                >
                  #
                </span>
                {n.num}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>{n.group}</div>
                <div
                  style={{
                    fontSize: 10,
                    color: tokens.muted,
                    marginTop: 2,
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  }}
                >
                  {t("home.month")} {n.month}/{n.total} · {t("wallet.expires", { d: n.exp })}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontFamily: "var(--font-syne), Syne",
                    fontSize: 15,
                    fontWeight: 700,
                    color: tokens.text,
                  }}
                >
                  {fmtMoney(n.value, { noCents: true })}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: tokens.green,
                    marginTop: 2,
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  }}
                >
                  +{n.yieldPct}%
                </div>
              </div>
              {!limit &&
                (listedIds.has(n.id) ? (
                  <span
                    style={{
                      padding: "5px 11px",
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
                    ◆ Listado
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSelling(n)}
                    style={{
                      padding: "7px 12px",
                      borderRadius: 8,
                      cursor: "pointer",
                      background: "transparent",
                      border: `1px solid ${tokens.borderStr}`,
                      color: tokens.text,
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                    }}
                  >
                    {t("wallet.sell")}
                  </button>
                ))}
            </div>
          );
        })}
      </div>
      <SellShareModal position={selling} open={selling != null} onClose={() => setSelling(null)} />
    </div>
  );
}

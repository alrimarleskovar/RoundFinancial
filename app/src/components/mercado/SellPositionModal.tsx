"use client";

import { useEffect, useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import type { NftPosition } from "@/data/carteira";
import { useI18n, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Sell-flow modal for the secondary market. Two states:
//   1. price — pick an ask price between 50% and 100% of face value.
//      Live preview of discount %, what you net, and the 7-day
//      slashing window the whitepaper documents as the Válvula de
//      Escape's tail.
//   2. success — ModalSuccess with a contextual body referencing
//      the share + discount + slashing countdown.
//
// Whitepaper alignment (Slide 6 of the pitch deck):
//   - Three exits before default: Escape Valve, Clean Exit, Slashing.
//   - Selling preserves the seller's SAS reputation.
//   - 7 days is the protocol-defined window between listing and the
//     slashing fallback if no buyer is found.
//
// Real on-chain wiring is the `escape_valve_list` Anchor instruction,
// scheduled for M3 of the grant roadmap.

type Phase = "price" | "success";

const SLASHING_DAYS = 7;

export function SellPositionModal({
  position,
  open,
  onClose,
  onListed,
}: {
  position: NftPosition | null;
  open: boolean;
  onClose: () => void;
  onListed?: (listing: { position: NftPosition; askPrice: number; discountPct: number }) => void;
}) {
  const { tokens } = useTheme();
  const { fmtMoney } = useI18n();
  const t = useT();
  const [phase, setPhase] = useState<Phase>("price");
  const [askPctOfFace, setAskPctOfFace] = useState(92);

  useEffect(() => {
    if (open) {
      setPhase("price");
      setAskPctOfFace(92);
    }
  }, [open, position?.id]);

  if (!position) return null;

  const askPrice = Math.round((position.value * askPctOfFace) / 100);
  const discount = Math.max(0, 100 - askPctOfFace);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={phase === "price" ? t("market.sellModal.title") : t("market.sellModal.successTitle")}
      subtitle={phase === "price" ? t("market.sellModal.subtitle") : undefined}
      width={500}
    >
      {phase === "price" ? (
        <>
          {/* Position summary */}
          <div
            style={{
              padding: 16,
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
              <div
                style={{
                  fontFamily: "var(--font-syne), Syne",
                  fontSize: 18,
                  fontWeight: 700,
                  color: tokens.text,
                  letterSpacing: "-0.02em",
                }}
              >
                {position.group}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  fontSize: 11,
                  color: tokens.muted,
                }}
              >
                {`#${position.num} · ${t("home.month")} ${position.month}/${position.total}`}
              </div>
            </div>
            <div
              style={{
                fontSize: 11,
                color: tokens.muted,
                marginTop: 4,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {t("market.sellModal.expiry")}: {position.exp}
            </div>
          </div>

          {/* Price slider */}
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 8,
              }}
            >
              <MonoLabel size={9}>{t("market.sellModal.askPrice")}</MonoLabel>
              <span
                style={{
                  fontFamily: "var(--font-syne), Syne",
                  fontSize: 22,
                  fontWeight: 800,
                  color: tokens.text,
                  letterSpacing: "-0.02em",
                }}
              >
                {fmtMoney(askPrice, { noCents: true })}
              </span>
            </div>
            <input
              type="range"
              min={50}
              max={100}
              step={1}
              value={askPctOfFace}
              onChange={(e) => setAskPctOfFace(Number(e.target.value))}
              style={{
                width: "100%",
                accentColor: tokens.purple,
                cursor: "pointer",
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 4,
                fontSize: 10,
                color: tokens.muted,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              <span>50%</span>
              <span>{askPctOfFace}%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Live preview */}
          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 10,
              padding: 14,
              borderRadius: 12,
              background: tokens.fillSoft,
              border: `1px solid ${tokens.border}`,
            }}
          >
            <Stat
              label={t("market.sellModal.face")}
              value={fmtMoney(position.value, { noCents: true })}
              color={tokens.text2}
            />
            <Stat
              label={t("market.sellModal.discount")}
              value={`−${discount.toFixed(0)}%`}
              color={discount > 0 ? tokens.green : tokens.muted}
            />
            <Stat
              label={t("market.sellModal.youReceive")}
              value={fmtMoney(askPrice, { noCents: true })}
              color={tokens.text}
              emphasis
            />
          </div>

          {/* Whitepaper protections — what user keeps */}
          <div
            style={{
              marginTop: 14,
              padding: 14,
              borderRadius: 12,
              background: `${tokens.green}0D`,
              border: `1px solid ${tokens.green}33`,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <Bullet icon="check" label={t("market.sellModal.protectionDebt")} />
            <Bullet icon="check" label={t("market.sellModal.protectionSas")} />
            <Bullet
              icon="warn"
              label={t("market.sellModal.protectionSlashing", {
                days: SLASHING_DAYS,
              })}
            />
          </div>

          {/* Demo callout */}
          <div
            style={{
              marginTop: 14,
              padding: "10px 12px",
              borderRadius: 10,
              background: `${tokens.amber}14`,
              border: `1px solid ${tokens.amber}33`,
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <MonoLabel size={9} color={tokens.amber}>
              {t("market.sellModal.demoBadge")}
            </MonoLabel>
            <span style={{ fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
              {t("market.sellModal.demoBody")}
            </span>
          </div>

          {/* Action row */}
          <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: 11,
                borderRadius: 11,
                background: tokens.fillMed,
                color: tokens.text2,
                border: `1px solid ${tokens.borderStr}`,
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
              }}
            >
              {t("market.sellModal.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                onListed?.({
                  position,
                  askPrice,
                  discountPct: discount,
                });
                setPhase("success");
              }}
              style={{
                flex: 1.4,
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
              {t("market.sellModal.confirm")}
            </button>
          </div>
        </>
      ) : (
        <ModalSuccess
          title={t("market.sellModal.successHeadline")}
          body={t("market.sellModal.successBody", {
            group: position.group,
            price: fmtMoney(askPrice, { noCents: true }),
            discount: discount.toFixed(0),
            days: SLASHING_DAYS,
          })}
          cta={
            <button
              type="button"
              onClick={onClose}
              style={{
                width: "100%",
                padding: 11,
                borderRadius: 11,
                background: tokens.fillMed,
                color: tokens.text,
                border: `1px solid ${tokens.borderStr}`,
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
              }}
            >
              {t("market.sellModal.close")}
            </button>
          }
        />
      )}
    </Modal>
  );
}

function Stat({
  label,
  value,
  color,
  emphasis,
}: {
  label: string;
  value: string;
  color: string;
  emphasis?: boolean;
}) {
  const { tokens } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 9,
          color: tokens.muted,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: emphasis
            ? "var(--font-syne), Syne"
            : "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          fontSize: emphasis ? 18 : 13,
          fontWeight: emphasis ? 800 : 600,
          color,
          letterSpacing: emphasis ? "-0.02em" : 0,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Bullet({ icon, label }: { icon: "check" | "warn"; label: string }) {
  const { tokens } = useTheme();
  const accent = icon === "check" ? tokens.green : tokens.amber;
  const glyph = icon === "check" ? "✓" : "⏱";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        fontSize: 11,
        color: tokens.text2,
        lineHeight: 1.5,
      }}
    >
      <span
        style={{
          color: accent,
          fontWeight: 700,
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          fontSize: 12,
          flexShrink: 0,
          width: 14,
          textAlign: "center",
        }}
      >
        {glyph}
      </span>
      <span>{label}</span>
    </div>
  );
}

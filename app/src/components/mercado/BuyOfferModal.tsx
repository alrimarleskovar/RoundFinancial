"use client";

import { useEffect, useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import { useI18n, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Buy-flow modal for the secondary market. Two states:
//   1. confirm — offer summary + a "Confirmar compra (demo)" CTA.
//      Clearly labelled as a demo/simulated action so the UI is
//      honest pre-devnet.
//   2. success — ModalSuccess with a green check + auto-close hint.
//
// Real on-chain wiring happens in M3 of the grant roadmap (the
// `escape_valve_buy` Anchor instruction). Until then this modal
// acknowledges the click without lying about what it does.

export interface BuyOfferTarget {
  /** Pool / ROSCA group label. */
  group: string;
  /** Optional second-line detail (e.g. "Cota #02 · Mês 2/12"). */
  detail?: string;
  /** Face value of the share, in BRL. */
  face: number;
  /** Resale ask price, in BRL. */
  price: number;
  /** Discount as a positive percent (e.g. 12.2 → "−12.2%"). */
  discount: number;
}

type Phase = "confirm" | "success";

export function BuyOfferModal({
  target,
  open,
  onClose,
}: {
  target: BuyOfferTarget | null;
  open: boolean;
  onClose: () => void;
}) {
  const { tokens } = useTheme();
  const { fmtMoney } = useI18n();
  const t = useT();
  const [phase, setPhase] = useState<Phase>("confirm");

  // Reset to confirm phase whenever the modal opens for a new target.
  useEffect(() => {
    if (open) setPhase("confirm");
  }, [open, target?.group]);

  if (!target) return null;

  const savings = Math.max(0, target.face - target.price);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        phase === "confirm"
          ? t("market.buyModal.title")
          : t("market.buyModal.successTitle")
      }
      subtitle={
        phase === "confirm" ? t("market.buyModal.subtitle") : undefined
      }
      width={480}
    >
      {phase === "confirm" ? (
        <>
          {/* Offer summary card */}
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
                fontFamily: "var(--font-syne), Syne",
                fontSize: 18,
                fontWeight: 700,
                color: tokens.text,
                letterSpacing: "-0.02em",
              }}
            >
              {target.group}
            </div>
            {target.detail && (
              <div
                style={{
                  fontSize: 11,
                  color: tokens.muted,
                  marginTop: 4,
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {target.detail}
              </div>
            )}

            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <Stat
                label={t("market.buyModal.face")}
                value={fmtMoney(target.face, { noCents: true })}
                color={tokens.text2}
              />
              <Stat
                label={t("market.buyModal.price")}
                value={fmtMoney(target.price, { noCents: true })}
                color={tokens.text}
                emphasis
              />
              <Stat
                label={t("market.buyModal.discount")}
                value={`−${target.discount.toFixed(1)}%`}
                color={tokens.green}
              />
              <Stat
                label={t("market.buyModal.savings")}
                value={fmtMoney(savings, { noCents: true })}
                color={tokens.green}
              />
            </div>
          </div>

          {/* Demo disclaimer */}
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
              {t("market.buyModal.demoBadge")}
            </MonoLabel>
            <span
              style={{
                fontSize: 11,
                color: tokens.text2,
                lineHeight: 1.5,
              }}
            >
              {t("market.buyModal.demoBody")}
            </span>
          </div>

          {/* Action row */}
          <div
            style={{
              marginTop: 18,
              display: "flex",
              gap: 8,
            }}
          >
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
              {t("market.buyModal.cancel")}
            </button>
            <button
              type="button"
              onClick={() => setPhase("success")}
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
              {t("market.buyModal.confirm")}
            </button>
          </div>
        </>
      ) : (
        <ModalSuccess
          title={t("market.buyModal.successHeadline")}
          body={t("market.buyModal.successBody", {
            group: target.group,
            price: fmtMoney(target.price, { noCents: true }),
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
              {t("market.buyModal.close")}
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
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

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { MonoLabel } from "@/components/brand/brand";
import { ghostBtn, primaryBtn } from "@/components/modals/JoinGroupModal";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import type { NftPosition, Tone } from "@/data/carteira";
import { useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

// Sell-share modal. Uses a discount slider (0-30%) to set ask price;
// previews face / ask / equivalent buyer APY.

const APY_AT_FULL_DISCOUNT = 14; // upper bound at 30% discount

export function SellShareModal({
  position,
  open,
  onClose,
}: {
  position: NftPosition | null;
  open: boolean;
  onClose: () => void;
}) {
  const { tokens } = useTheme();
  const t = useT();
  const { fmtMoney } = useI18n();
  const { sellShare } = useSession();
  const router = useRouter();
  const [discount, setDiscount] = useState(8);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      setDiscount(8);
      setSubmitting(false);
      setDone(false);
    }
  }, [open]);

  if (!position) return null;

  const askPrice = position.value * (1 - discount / 100);
  // Linear interpolation: 0% discount -> 0% APY bonus,
  // 30% discount -> APY_AT_FULL_DISCOUNT bonus (rough hint).
  const buyerApy = (discount / 30) * APY_AT_FULL_DISCOUNT;

  const reset = () => {
    setSubmitting(false);
    setDone(false);
    onClose();
  };

  const handleConfirm = () => {
    if (!position) return;
    setSubmitting(true);
    setTimeout(() => {
      sellShare(position, askPrice, discount);
      setSubmitting(false);
      setDone(true);
    }, 1200);
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : reset}
      title={done ? "" : t("modal.sell.title")}
      subtitle={done ? undefined : t("modal.sell.subtitle")}
      closeable={!submitting}
      width={480}
    >
      {done ? (
        <ModalSuccess
          title={t("modal.sell.success.title")}
          body={t("modal.sell.success.body", { d: discount.toFixed(1) })}
          cta={
            <button
              type="button"
              onClick={() => {
                reset();
                router.push("/mercado");
              }}
              style={primaryBtn(tokens)}
            >
              {t("modal.sell.success.cta")}
            </button>
          }
        />
      ) : (
        <>
          {/* Position card */}
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: 12,
              borderRadius: 12,
              background: tokens.fillSoft,
              border: `1px solid ${tokens.border}`,
              marginBottom: 18,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                background: `linear-gradient(135deg, ${toneColor(tokens, position.tone)}33, ${toneColor(tokens, position.tone)}11)`,
                border: `1px solid ${toneColor(tokens, position.tone)}4D`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-syne), Syne",
                fontWeight: 800,
                fontSize: 14,
                color: toneColor(tokens, position.tone),
                flexDirection: "column",
              }}
            >
              <span
                style={{
                  fontSize: 8,
                  opacity: 0.7,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                #
              </span>
              {position.num}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>
                {position.group}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: tokens.muted,
                  marginTop: 2,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                Mês {position.month}/{position.total} · expira {position.exp}
              </div>
            </div>
          </div>

          {/* Discount slider */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 8,
              }}
            >
              <MonoLabel size={9}>{t("modal.sell.discount")}</MonoLabel>
              <span
                style={{
                  fontFamily: "var(--font-syne), Syne",
                  fontSize: 22,
                  fontWeight: 800,
                  color: tokens.green,
                  letterSpacing: "-0.02em",
                }}
              >
                −{discount.toFixed(1)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={30}
              step={0.5}
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value))}
              style={{
                width: "100%",
                accentColor: tokens.green,
                cursor: "pointer",
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                fontSize: 9,
                color: tokens.muted,
                marginTop: 4,
              }}
            >
              <span>0%</span>
              <span>15%</span>
              <span>30%</span>
            </div>
          </div>

          {/* Preview */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              padding: 14,
              borderRadius: 12,
              background: tokens.fillSoft,
              border: `1px solid ${tokens.border}`,
              marginBottom: 18,
            }}
          >
            <div>
              <MonoLabel size={9}>{t("modal.sell.face")}</MonoLabel>
              <div
                style={{
                  fontFamily: "var(--font-syne), Syne",
                  fontSize: 18,
                  fontWeight: 700,
                  color: tokens.text2,
                  marginTop: 4,
                }}
              >
                {fmtMoney(position.value, { noCents: true })}
              </div>
            </div>
            <div>
              <MonoLabel size={9} color={tokens.green}>
                {t("modal.sell.askPrice")}
              </MonoLabel>
              <div
                style={{
                  fontFamily: "var(--font-syne), Syne",
                  fontSize: 22,
                  fontWeight: 800,
                  color: tokens.text,
                  marginTop: 4,
                  letterSpacing: "-0.02em",
                }}
              >
                {fmtMoney(askPrice, { noCents: true })}
              </div>
            </div>
            <div style={{ gridColumn: "1 / -1", marginTop: 4 }}>
              <MonoLabel size={9}>{t("modal.sell.apyForBuyer")}</MonoLabel>
              <div
                style={{
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  fontSize: 12,
                  color: tokens.teal,
                  fontWeight: 600,
                  marginTop: 4,
                }}
              >
                ~{buyerApy.toFixed(1)}% APY
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={reset} style={ghostBtn(tokens)}>
              {t("modal.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              style={{
                ...primaryBtn(tokens),
                opacity: submitting ? 0.7 : 1,
                cursor: submitting ? "default" : "pointer",
              }}
            >
              {submitting ? t("modal.processing") : t("modal.sell.cta")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function toneColor(tokens: ReturnType<typeof useTheme>["tokens"], tone: Tone): string {
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
}

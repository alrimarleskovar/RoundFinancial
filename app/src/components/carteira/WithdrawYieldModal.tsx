"use client";

import { useEffect, useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import { ghostBtn, primaryBtn } from "@/components/modals/JoinGroupModal";
import { KAMINO_VAULT } from "@/data/carteira";
import { useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

// Withdraw the accumulated Kamino yield. Two-state machine
// (confirm | success). Real on-chain wiring is the
// roundfi-core::harvest_yield instruction (M3).

type Phase = "confirm" | "success";

export function WithdrawYieldModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tokens } = useTheme();
  const t = useT();
  const { fmtMoney } = useI18n();
  const { user, harvestYield } = useSession();
  const [phase, setPhase] = useState<Phase>("confirm");
  const [submitting, setSubmitting] = useState(false);
  // Snapshot the claim amount the moment confirm is pressed so the
  // success screen keeps reading the right value after harvestYield()
  // resets user.yield to 0.
  const [claimedAmount, setClaimedAmount] = useState(0);
  const accrued = user.yield;

  useEffect(() => {
    if (open) {
      setPhase("confirm");
      setClaimedAmount(0);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={phase === "confirm" ? t("modal.withdraw.title") : t("modal.withdraw.successTitle")}
      subtitle={phase === "confirm" ? t("modal.withdraw.subtitle") : undefined}
      width={460}
    >
      {phase === "confirm" ? (
        <>
          {/* Yield summary */}
          <div
            style={{
              padding: 18,
              borderRadius: 14,
              background: `${tokens.teal}10`,
              border: `1px solid ${tokens.teal}33`,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <MonoLabel size={9} color={tokens.teal}>
                {t("modal.withdraw.available")}
              </MonoLabel>
              <span
                style={{
                  fontSize: 11,
                  color: tokens.muted,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {KAMINO_VAULT.apy}% APY
              </span>
            </div>
            <div
              style={{
                marginTop: 6,
                fontFamily: "var(--font-syne), Syne",
                fontSize: 32,
                fontWeight: 800,
                color: tokens.text,
                letterSpacing: "-0.03em",
              }}
            >
              {fmtMoney(accrued, { noCents: false })}
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                color: tokens.text2,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {t("modal.withdraw.cycles", { n: KAMINO_VAULT.cycles })}
            </div>
          </div>

          {/* Stats */}
          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            <Stat
              label={t("modal.withdraw.allocated")}
              value={fmtMoney(KAMINO_VAULT.allocated, { noCents: true })}
              tokens={tokens}
            />
            <Stat
              label={t("modal.withdraw.youReceive")}
              value={fmtMoney(accrued, { noCents: false })}
              color={tokens.green}
              emphasis
              tokens={tokens}
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
              {t("modal.withdraw.demoBadge")}
            </MonoLabel>
            <span style={{ fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
              {t("modal.withdraw.demoBody")}
            </span>
          </div>

          <div
            style={{
              marginTop: 18,
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
            }}
          >
            <button type="button" onClick={onClose} style={ghostBtn(tokens)}>
              {t("modal.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                setSubmitting(true);
                setTimeout(() => {
                  setClaimedAmount(accrued);
                  harvestYield();
                  setSubmitting(false);
                  setPhase("success");
                }, 900);
              }}
              disabled={accrued <= 0 || submitting}
              style={{
                ...primaryBtn(tokens),
                opacity: accrued <= 0 || submitting ? 0.5 : 1,
                cursor: accrued <= 0 || submitting ? "default" : "pointer",
              }}
            >
              {submitting ? t("modal.processing") : t("modal.withdraw.confirm")}
            </button>
          </div>
        </>
      ) : (
        <ModalSuccess
          title={t("modal.withdraw.successHeadline")}
          body={t("modal.withdraw.successBody", {
            amount: fmtMoney(claimedAmount, { noCents: false }),
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
              {t("modal.withdraw.close")}
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
  tokens,
}: {
  label: string;
  value: string;
  color?: string;
  emphasis?: boolean;
  tokens: ReturnType<typeof useTheme>["tokens"];
}) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 10,
        background: tokens.fillSoft,
        border: `1px solid ${tokens.border}`,
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
      <div
        style={{
          marginTop: 4,
          fontFamily: "var(--font-syne), Syne",
          fontSize: emphasis ? 20 : 16,
          fontWeight: emphasis ? 800 : 700,
          color: color ?? tokens.text,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

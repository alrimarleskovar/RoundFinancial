"use client";

import { MonoLabel } from "@/components/brand/brand";
import { Modal } from "@/components/ui/Modal";
import type { RecommendationKey } from "@/data/insights";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Detail view for the "next steps" recommendation cards on /insights.
// Each step gets a longer-form explanation: why it bumps the score,
// what the on-chain signal looks like, and the Anchor instruction
// that records it (so the M3 wiring path is visible).

export interface RecommendationDetail {
  key: RecommendationKey;
  pts: number;
  /** Token color for the title accent (matches the source card). */
  accent: string;
}

export function RecommendationModal({
  detail,
  open,
  onClose,
}: {
  detail: RecommendationDetail | null;
  open: boolean;
  onClose: () => void;
}) {
  const { tokens } = useTheme();
  const t = useT();

  if (!detail) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t(`insights.next.${detail.key}.label`)}
      subtitle={t(`insights.next.${detail.key}.sub`)}
      width={460}
    >
      {/* Big score delta */}
      <div
        style={{
          padding: 18,
          borderRadius: 14,
          background: `${detail.accent}14`,
          border: `1px solid ${detail.accent}33`,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <MonoLabel size={9} color={detail.accent}>
          {t("insights.modal.bumpLabel")}
        </MonoLabel>
        <span
          style={{
            fontFamily: "var(--font-syne), Syne",
            fontSize: 32,
            fontWeight: 800,
            color: detail.accent,
            letterSpacing: "-0.03em",
          }}
        >
          {t("insights.next.pts", { n: detail.pts })}
        </span>
      </div>

      {/* Why */}
      <div style={{ marginTop: 16 }}>
        <MonoLabel size={9}>{t("insights.modal.whyTitle")}</MonoLabel>
        <p
          style={{
            marginTop: 6,
            fontSize: 12,
            color: tokens.text2,
            lineHeight: 1.6,
          }}
        >
          {t(`insights.modal.${detail.key}.why`)}
        </p>
      </div>

      {/* On-chain signal */}
      <div style={{ marginTop: 16 }}>
        <MonoLabel size={9}>{t("insights.modal.onchainTitle")}</MonoLabel>
        <div
          style={{
            marginTop: 6,
            padding: 12,
            borderRadius: 10,
            background: tokens.fillSoft,
            border: `1px solid ${tokens.border}`,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            fontSize: 11,
            color: tokens.text2,
            lineHeight: 1.5,
          }}
        >
          {t(`insights.modal.${detail.key}.onchain`)}
        </div>
      </div>

      {/* Close action */}
      <button
        type="button"
        onClick={onClose}
        style={{
          marginTop: 18,
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
        {t("insights.modal.close")}
      </button>
    </Modal>
  );
}

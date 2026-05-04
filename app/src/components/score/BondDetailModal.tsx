"use client";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { Modal } from "@/components/ui/Modal";
import type { Tone } from "@/data/carteira";
import type { SasBond } from "@/data/score";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Detail view for a SAS attestation bundle (one ROSCA cycle = one
// "bond" in the passport). Each installment paid mints a separate
// attestation account on the Solana Attestation Service via
// roundfi-reputation::mint_attestation. The bond aggregates them
// for display.

export function BondDetailModal({
  bond,
  open,
  onClose,
}: {
  bond: SasBond | null;
  open: boolean;
  onClose: () => void;
}) {
  const { tokens } = useTheme();
  const t = useT();

  if (!bond) return null;

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
  const accent = toneColor(bond.tone);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={bond.cycle}
      subtitle={t("score.bondModal.subtitle")}
      width={460}
    >
      {/* Header: shield + status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: 16,
          borderRadius: 14,
          background: `${accent}10`,
          border: `1px solid ${accent}33`,
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: `${accent}20`,
            border: `1px solid ${accent}55`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icons.shield size={26} stroke={accent} />
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              fontSize: 10,
              color: tokens.muted,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            {bond.date}
          </div>
          <div
            style={{
              fontFamily: "var(--font-syne), Syne",
              fontSize: 16,
              fontWeight: 700,
              color: tokens.text,
              marginTop: 2,
              letterSpacing: "-0.02em",
            }}
          >
            {bond.status === "active"
              ? t("score.bondModal.statusActive")
              : t("score.bondModal.statusCompleted")}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        <Stat
          label={t("score.bondModal.attestationCount")}
          value={String(bond.installments)}
          color={accent}
          tokens={tokens}
        />
        <Stat
          label={t("score.bondModal.weight")}
          value={
            bond.status === "completed"
              ? t("score.bondModal.weightCompleted")
              : t("score.bondModal.weightActive")
          }
          color={tokens.text}
          tokens={tokens}
        />
      </div>

      {/* On-chain path */}
      <div style={{ marginTop: 14 }}>
        <MonoLabel size={9}>{t("score.bondModal.onchainTitle")}</MonoLabel>
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
            lineHeight: 1.55,
          }}
        >
          {t("score.bondModal.onchainBody", {
            n: bond.installments,
          })}
        </div>
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
          {t("score.bondModal.demoBadge")}
        </MonoLabel>
        <span style={{ fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
          {t("score.bondModal.demoBody")}
        </span>
      </div>

      {/* Close */}
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
        {t("score.bondModal.close")}
      </button>
    </Modal>
  );
}

function Stat({
  label,
  value,
  color,
  tokens,
}: {
  label: string;
  value: string;
  color: string;
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
          fontSize: 18,
          fontWeight: 700,
          color,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

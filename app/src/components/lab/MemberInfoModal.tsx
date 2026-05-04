"use client";

import { MonoLabel } from "@/components/brand/brand";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n";
import type { MemberLedger } from "@/lib/stressLab";
import { useTheme } from "@/lib/theme";

// Per-member detail modal triggered from the Stress Lab ledger's "info"
// button. Reuses the framer-motion Modal primitive shipped in Round 3.

function fmtUsdc(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function MemberInfoModal({
  member,
  open,
  onClose,
}: {
  member: MemberLedger | null;
  open: boolean;
  onClose: () => void;
}) {
  const { tokens } = useTheme();
  const t = useT();

  if (!member) return null;

  const totalContributed = member.stakePaid + member.installmentsPaid;
  const statusKey =
    member.status === "ok"
      ? "lab.member.statusOk"
      : member.status === "calote_pre"
        ? "lab.member.statusPre"
        : member.status === "calote_pos"
          ? "lab.member.statusPos"
          : "lab.member.statusExited";
  const statusColor =
    member.status === "ok"
      ? tokens.green
      : member.status === "calote_pre"
        ? tokens.amber
        : member.status === "calote_pos"
          ? tokens.red
          : tokens.teal;

  return (
    <Modal open={open} onClose={onClose} title={t("lab.member.title")} width={460}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: tokens.fillSoft,
            border: `1px solid ${tokens.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-syne), Syne",
            fontWeight: 700,
            fontSize: 18,
            color: tokens.text,
          }}
        >
          {member.name.charAt(0)}
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: tokens.text }}>{member.name}</div>
          <div
            style={{
              fontSize: 11,
              color: tokens.muted,
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            }}
          >
            {t("lab.member.contractId")}: RNDF-{((member.name.charCodeAt(0) * 79) % 9000) + 1000}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          fontSize: 12,
        }}
      >
        <Row
          label={t("lab.member.fundStatus")}
          value={t(statusKey)}
          color={statusColor}
          tokens={tokens}
        />
        <Row
          label={t("lab.member.stakeInitial")}
          value={`$${fmtUsdc(member.stakePaid)}`}
          tokens={tokens}
        />
        <Row
          label={t("lab.member.installmentsPaid")}
          value={`$${fmtUsdc(member.installmentsPaid)}`}
          tokens={tokens}
        />
        <Row
          label={t("lab.member.totalContributed")}
          value={`$${fmtUsdc(totalContributed)}`}
          bold
          tokens={tokens}
        />
        <Row
          label={t("lab.member.received")}
          value={`$${fmtUsdc(member.received)}`}
          color={tokens.purple}
          bold
          tokens={tokens}
        />
        {member.stakeRefunded > 0 && (
          <Row
            label={t("lab.member.stakeRefunded")}
            value={`$${fmtUsdc(member.stakeRefunded)}`}
            color={tokens.teal}
            tokens={tokens}
          />
        )}
        {member.retained > 0 && (
          <Row
            label={t("lab.member.retainedByProtocol")}
            value={`+$${fmtUsdc(member.retained)}`}
            color={tokens.amber}
            bold
            noBorder
            tokens={tokens}
          />
        )}
        {member.lossCaused > 0 && (
          <Row
            label={t("lab.member.lossCaused")}
            value={`-$${fmtUsdc(member.lossCaused)}`}
            color={tokens.red}
            bold
            noBorder
            tokens={tokens}
          />
        )}
      </div>
    </Modal>
  );
}

function Row({
  label,
  value,
  color,
  bold,
  noBorder,
  tokens,
}: {
  label: string;
  value: string;
  color?: string;
  bold?: boolean;
  noBorder?: boolean;
  tokens: ReturnType<typeof useTheme>["tokens"];
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        paddingBottom: 8,
        borderBottom: noBorder ? "none" : `1px solid ${tokens.border}`,
      }}
    >
      <span style={{ color: color ?? tokens.muted, fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ color: color ?? tokens.text, fontWeight: bold ? 700 : 500 }}>{value}</span>
    </div>
  );
}

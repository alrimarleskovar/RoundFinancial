"use client";

import { useEffect, useMemo, useState } from "react";

import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";

import { MonoLabel } from "@/components/brand/brand";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import { ghostBtn, primaryBtn } from "@/components/modals/JoinGroupModal";
import { KAMINO_VAULT } from "@/data/carteira";
import { DEVNET_POOLS } from "@/lib/devnet";
import { useI18n, useT } from "@/lib/i18n";
import { sendReleaseEscrow } from "@/lib/release-escrow";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { usePool, usePoolMembers } from "@/lib/usePool";
import { shortAddr, useWallet } from "@/lib/wallet";

// Withdraw modal. Two-state machine (confirm | success).
//
// Real on-chain path: when the connected wallet is a live, non-defaulted
// member of devnet pool3 with vested escrow to release, the confirm button
// fires roundfi-core::release_escrow — which returns the member's vested
// stake-refund cashback to their wallet — and links the explorer tx.
// Otherwise it falls back to the Kamino-yield demo (harvest_yield is a
// pool-level crank, not a personal withdrawal — ships at M3) so the modal
// is never empty for non-members.

type Phase = "confirm" | "success";

export function WithdrawYieldModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tokens } = useTheme();
  const t = useT();
  const { fmtMoney, lang } = useI18n();
  const { user, harvestYield } = useSession();
  const { connection } = useConnection();
  const adapter = useAdapterWallet();
  const wallet = useWallet();
  const onChainPool = usePool("pool3");
  const onChainMembers = usePoolMembers("pool3");

  const [phase, setPhase] = useState<Phase>("confirm");
  const [submitting, setSubmitting] = useState(false);
  // Snapshot the claim amount the moment confirm is pressed so the success
  // screen keeps reading the right value after harvestYield() resets
  // user.yield (mock) / the on-chain refresh lands (real).
  const [claimedAmount, setClaimedAmount] = useState(0);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const accrued = user.yield;

  // The connected wallet's real, non-defaulted membership in pool3 (if any).
  const connectedWallet = adapter.publicKey;
  const member = useMemo(() => {
    if (!connectedWallet || onChainMembers.status !== "ok") return null;
    return (
      onChainMembers.members.find((m) => m.wallet.equals(connectedWallet) && !m.defaulted) ?? null
    );
  }, [connectedWallet, onChainMembers]);

  const poolLoaded = onChainPool.status === "ok" && onChainPool.pool != null;
  const poolCurrentCycle = onChainPool.pool?.currentCycle ?? 0;
  // Next un-released milestone. On-chain guards (release_escrow.rs): 1 ≤ cp ≤
  // cycles, cp > last_released, cp ≤ current_cycle+1, on_time_count ≥ cp.
  const checkpoint = member ? member.lastReleasedCheckpoint + 1 : 0;
  const escrowUsdc = member ? Number(member.escrowBalance) / 1e6 : 0;
  const onChainReady =
    wallet.status === "connected" &&
    !!connectedWallet &&
    !!member &&
    poolLoaded &&
    member.escrowBalance > 0n &&
    checkpoint >= 1 &&
    member.onTimeCount >= checkpoint &&
    member.lastReleasedCheckpoint <= poolCurrentCycle;

  const usdcStr = (n: number) =>
    `${n.toLocaleString(lang === "pt" ? "pt-BR" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} USDC`;

  useEffect(() => {
    if (open) {
      setPhase("confirm");
      setClaimedAmount(0);
      setTxSig(null);
      setChainError(null);
    }
  }, [open]);

  const handleConfirm = async () => {
    setSubmitting(true);
    setChainError(null);

    if (onChainReady && adapter.sendTransaction && connectedWallet && member) {
      try {
        const sig = await sendReleaseEscrow({
          connection,
          sendTransaction: adapter.sendTransaction,
          pool: DEVNET_POOLS.pool3.pda,
          memberWallet: connectedWallet,
          checkpoint,
        });
        setTxSig(sig);
        setClaimedAmount(escrowUsdc);
        // Eager re-fetch so the escrow balance / checkpoint reflect the release.
        void onChainMembers.refresh();
        setSubmitting(false);
        setPhase("success");
      } catch (err) {
        const e = err as { message?: string; logs?: string[]; cause?: unknown };
        const parts: string[] = [];
        if (e.message) parts.push(e.message);
        if (Array.isArray(e.logs) && e.logs.length > 0) parts.push("logs:\n" + e.logs.join("\n"));
        if (e.cause) parts.push("cause: " + String(e.cause));
        if (parts.length === 0) parts.push(String(err));
        // eslint-disable-next-line no-console
        console.error("[RoundFi] release_escrow failed:", err);
        setChainError(parts.join("\n"));
        setSubmitting(false);
      }
      return;
    }

    // Mock fallback (Kamino yield demo).
    setTimeout(() => {
      setClaimedAmount(accrued);
      harvestYield();
      setSubmitting(false);
      setPhase("success");
    }, 900);
  };

  const confirmDisabled = (onChainReady ? false : accrued <= 0) || submitting;

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={
        phase === "confirm"
          ? onChainReady
            ? t("modal.withdraw.realTitle")
            : t("modal.withdraw.title")
          : txSig
            ? t("modal.withdraw.realSuccessTitle")
            : t("modal.withdraw.successTitle")
      }
      subtitle={
        phase === "confirm"
          ? onChainReady
            ? t("modal.withdraw.realSubtitle")
            : t("modal.withdraw.subtitle")
          : undefined
      }
      closeable={!submitting}
      width={460}
    >
      {phase === "confirm" ? (
        <>
          {/* Summary */}
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
                {onChainReady ? t("modal.withdraw.realAvailable") : t("modal.withdraw.available")}
              </MonoLabel>
              <span
                style={{
                  fontSize: 11,
                  color: tokens.muted,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {onChainReady && member ? `slot #${member.slotIndex}` : `${KAMINO_VAULT.apy}% APY`}
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
              {onChainReady ? usdcStr(escrowUsdc) : fmtMoney(accrued, { noCents: false })}
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                color: tokens.text2,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {onChainReady
                ? t("modal.withdraw.realNote", { n: checkpoint })
                : t("modal.withdraw.cycles", { n: KAMINO_VAULT.cycles })}
            </div>
          </div>

          {/* Stats — Kamino demo only (mock path). */}
          {!onChainReady && (
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
          )}

          {/* Callout — REAL · DEVNET when on-chain, demo badge otherwise. */}
          {onChainReady ? (
            <div
              style={{
                marginTop: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: `${tokens.green}14`,
                border: `1px solid ${tokens.green}33`,
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
              }}
            >
              <MonoLabel size={9} color={tokens.green}>
                REAL · DEVNET
              </MonoLabel>
              <span style={{ flex: 1, fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
                checkpoint #{checkpoint} on-chain · Phantom
              </span>
            </div>
          ) : (
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
          )}

          {/* Chain error */}
          {chainError ? (
            <div
              style={{
                marginTop: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: `${tokens.red}14`,
                border: `1px solid ${tokens.red}33`,
                fontSize: 11,
                color: tokens.text2,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                wordBreak: "break-word",
              }}
            >
              <MonoLabel size={9} color={tokens.red}>
                TX FAILED
              </MonoLabel>
              <div style={{ marginTop: 4 }}>{chainError}</div>
            </div>
          ) : null}

          <div
            style={{
              marginTop: 18,
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
            }}
          >
            <button type="button" onClick={onClose} disabled={submitting} style={ghostBtn(tokens)}>
              {t("modal.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirmDisabled}
              style={{
                ...primaryBtn(tokens),
                opacity: confirmDisabled ? 0.5 : 1,
                cursor: confirmDisabled ? "default" : "pointer",
              }}
            >
              {submitting
                ? t("modal.processing")
                : onChainReady
                  ? t("modal.withdraw.realConfirm")
                  : t("modal.withdraw.confirm")}
            </button>
          </div>
        </>
      ) : (
        <ModalSuccess
          title={
            txSig ? t("modal.withdraw.realSuccessHeadline") : t("modal.withdraw.successHeadline")
          }
          body={
            txSig ? (
              <>
                {t("modal.withdraw.realSuccessBody")}
                <a
                  href={wallet.explorerTx(txSig)}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 12,
                    padding: "6px 10px",
                    borderRadius: 8,
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontSize: 11,
                    color: tokens.green,
                    background: `${tokens.green}1a`,
                    border: `1px solid ${tokens.green}55`,
                    textDecoration: "none",
                  }}
                >
                  on-chain tx · {shortAddr(txSig, 6, 6)}
                </a>
              </>
            ) : (
              t("modal.withdraw.successBody", {
                amount: fmtMoney(claimedAmount, { noCents: false }),
              })
            )
          }
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

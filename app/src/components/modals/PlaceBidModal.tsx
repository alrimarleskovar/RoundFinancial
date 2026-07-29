"use client";

import { useState } from "react";

import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { MonoLabel } from "@/components/brand/brand";
import { ghostBtn, primaryBtn } from "@/components/modals/JoinGroupModal";
import { IntentPanel } from "@/components/ui/IntentPanel";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import type { ActiveGroup } from "@/data/groups";
import { DEVNET_POOLS } from "@/lib/devnet";
import { useI18n } from "@/lib/i18n";
import { classifyLanceError, type LanceView } from "@/lib/lance";
import { isMissingSignatureError } from "@/lib/mobileWallet";
import { sendPlaceEmbeddedBid } from "@/lib/place-embedded-bid";
import { useTheme } from "@/lib/theme";
import { shortAddr, useWallet } from "@/lib/wallet";

// Lance embutido (ADR 0012 Fase 2). Chain-only — there is no mock mode:
// the bid's entire effect is a swap inside the on-chain DrawResult, so a
// simulated "success" here would be a lie about the payout order.
//
// The modal deliberately spends most of its space on THREE facts that a
// consórcio veteran will not assume from the word "lance":
//   1. no money moves now — the bid is made of installments already paid
//      ahead, i.e. the member's own debt brought forward;
//   2. it's a SWAP — the displaced member keeps their credit, just later,
//      so bidding isn't taking anything from anyone;
//   3. it can be outbid until the cycle is claimed, and losing costs
//      nothing (the prepaid installments stay yours).

export interface PlaceBidModalProps {
  group: ActiveGroup;
  open: boolean;
  onClose: () => void;
  /** Pre-computed by the parent (it already reads pool/member/draw). */
  view: LanceView;
  /** DEVNET_POOLS key — the pool whose DrawResult gets swapped. */
  seedKey: keyof typeof DEVNET_POOLS;
  /** Eager re-read after a landed bid (order chip + Receber gating). */
  onSuccess?: () => void;
}

export function PlaceBidModal({
  group,
  open,
  onClose,
  view,
  seedKey,
  onSuccess,
}: PlaceBidModalProps) {
  const { tokens } = useTheme();
  const { t } = useI18n();
  const { connection } = useConnection();
  const adapter = useAdapterWallet();
  const chainWallet = useWallet();
  const { explorerTx } = chainWallet;
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);

  const connectedWallet = adapter.publicKey;
  // Cycles are 0-indexed on chain; humans count from 1 everywhere in the UI.
  const targetCycleLabel = view.targetCycle + 1;
  const myCycleLabel = view.myCycle !== null ? view.myCycle + 1 : null;

  const reset = () => {
    setSubmitting(false);
    setDone(false);
    setTxSig(null);
    setChainError(null);
    onClose();
  };

  const handleConfirm = async () => {
    // The panel only opens this modal in the `ready` state, but a poll
    // tick could have moved the book underneath us — re-check instead of
    // firing a bid the program will reject.
    if (view.status !== "ready") return;
    if (!connectedWallet || !adapter.sendTransaction) return;
    setSubmitting(true);
    setChainError(null);
    try {
      const sig = await sendPlaceEmbeddedBid({
        connection,
        sendTransaction: adapter.sendTransaction,
        pool: DEVNET_POOLS[seedKey].pda,
        memberWallet: connectedWallet as PublicKey,
      });
      setTxSig(sig);
      // No `recordTx`: the bid moves zero USDC, so a ledger row would
      // show a phantom R$ 0 payment in /carteira. The order change is
      // the receipt, and it's visible on the card the moment we refresh.
      onSuccess?.();
      setSubmitting(false);
      setDone(true);
    } catch (err) {
      const e = err as { message?: string; logs?: string[]; cause?: unknown };
      const parts: string[] = [];
      if (e.message) parts.push(e.message);
      if (Array.isArray(e.logs) && e.logs.length > 0) parts.push("logs:\n" + e.logs.join("\n"));
      if (e.cause) parts.push("cause: " + String(e.cause));
      if (parts.length === 0) parts.push(String(err));
      // eslint-disable-next-line no-console
      console.error("[RoundFi] place_embedded_bid failed:", err);
      const blob = parts.join("\n");
      // A losing bid is the EXPECTED failure here (someone deeper landed
      // between our simulation and the signature), so it gets real copy
      // instead of a raw Anchor dump.
      const key = classifyLanceError(blob);
      setChainError(
        key ? t(key) : isMissingSignatureError(blob) ? t("wallet.mobileRelay.error") : blob,
      );
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : reset}
      title={done ? "" : t("modal.lance.title")}
      subtitle={done ? undefined : t("modal.lance.subtitle")}
      closeable={!submitting}
      width={480}
    >
      {done ? (
        <ModalSuccess
          title={t("modal.lance.success.title")}
          body={
            <>
              {t("modal.lance.success.body", { n: targetCycleLabel })}
              {txSig ? (
                <a
                  href={explorerTx(txSig)}
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
                  {t("modal.lance.success.txLabel")} · {shortAddr(txSig, 6, 6)}
                </a>
              ) : null}
            </>
          }
          cta={
            <button type="button" onClick={reset} style={primaryBtn(tokens)}>
              {t("modal.close")}
            </button>
          }
        />
      ) : (
        <>
          {/* Group context */}
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: 12,
              borderRadius: 12,
              background: tokens.fillSoft,
              border: `1px solid ${tokens.border}`,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: `${tokens.purple}1A`,
                border: `1px solid ${tokens.purple}4D`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
              }}
            >
              {group.emoji}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <MonoLabel size={9}>{t("modal.claimPayout.group")}</MonoLabel>
              <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>{group.name}</div>
            </div>
          </div>

          {/* Hero — the bid IS the depth, so it's the headline number. */}
          <div
            style={{
              padding: 18,
              borderRadius: 14,
              background: `linear-gradient(145deg, ${tokens.purple}26, ${tokens.surface1} 80%)`,
              border: `1px solid ${tokens.purple}55`,
              marginBottom: 16,
              textAlign: "center",
            }}
          >
            <MonoLabel size={9} color={tokens.purple}>
              {t("modal.lance.hero.label")}
            </MonoLabel>
            <div
              style={{
                fontFamily: "var(--font-syne), Syne",
                fontSize: 40,
                fontWeight: 800,
                color: tokens.text,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                marginTop: 6,
              }}
            >
              {view.depth}×
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: tokens.muted,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {view.depth === 1
                ? t("modal.lance.hero.depthOne")
                : t("modal.lance.hero.depth", { n: view.depth })}
            </div>
          </div>

          {/* The standing book — why this bid wins right now. */}
          <div
            style={{
              marginBottom: 14,
              padding: "10px 12px",
              borderRadius: 10,
              background: `${tokens.green}14`,
              border: `1px solid ${tokens.green}33`,
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <MonoLabel size={9} color={tokens.green}>
              {t("modal.lance.book.label")}
            </MonoLabel>
            <span style={{ flex: 1, fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
              {view.bestDepth === 0
                ? t("modal.lance.book.none")
                : t("modal.lance.book.standing", { d: view.bestDepth, y: view.depth })}
            </span>
          </div>

          {/* The swap — the single fact that makes a lance fair here. */}
          {myCycleLabel !== null && (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: `${tokens.purple}14`,
                border: `1px solid ${tokens.purple}33`,
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <MonoLabel size={9} color={tokens.purple}>
                {t("modal.lance.swap.label")}
              </MonoLabel>
              <span style={{ flex: 1, fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
                {t("modal.lance.swap.body", { now: targetCycleLabel, mine: myCycleLabel })}
              </span>
            </div>
          )}

          {/* No funds move — the expectation most likely to be wrong. */}
          <div
            style={{
              marginBottom: 14,
              padding: "10px 12px",
              borderRadius: 10,
              background: tokens.fillSoft,
              border: `1px solid ${tokens.borderStr}`,
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <MonoLabel size={9}>{t("modal.lance.nofunds.label")}</MonoLabel>
            <span style={{ flex: 1, fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
              {t("modal.lance.nofunds.body")}
            </span>
          </div>

          {/* Outbid risk — stated up front rather than discovered later. */}
          <div
            style={{
              marginBottom: 14,
              padding: "10px 12px",
              borderRadius: 10,
              background: `${tokens.amber}14`,
              border: `1px solid ${tokens.amber}33`,
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <MonoLabel size={9} color={tokens.amber}>
              {t("modal.lance.risk.label")}
            </MonoLabel>
            <span style={{ flex: 1, fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
              {t("modal.lance.risk.body")}
            </span>
          </div>

          {chainError ? (
            <div
              style={{
                marginBottom: 14,
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
                {t("modal.lance.err.label")}
              </MonoLabel>
              <div style={{ marginTop: 4 }}>{chainError}</div>
            </div>
          ) : null}

          {/* amountUsdc 0 → the panel renders its "crank" shape, which is
              exactly right: this signature moves no tokens at all. */}
          <IntentPanel
            action="place_embedded_bid"
            amountUsdc={0}
            poolLabel={group.name}
            network={chainWallet.network}
            walletLabel={chainWallet.walletLabel}
            isHardware={chainWallet.isHardware}
            isUnknownWallet={chainWallet.isUnknownWallet}
          />

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
            <button type="button" onClick={reset} style={ghostBtn(tokens)}>
              {t("modal.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || view.status !== "ready"}
              style={{
                ...primaryBtn(tokens),
                background: `linear-gradient(135deg, ${tokens.purple}, ${tokens.teal})`,
                opacity: submitting || view.status !== "ready" ? 0.45 : 1,
                cursor: submitting || view.status !== "ready" ? "default" : "pointer",
              }}
            >
              {submitting ? t("modal.lance.cta.processing") : t("modal.lance.cta.confirm")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

"use client";

import { useEffect, useState } from "react";

import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { freeBidCommitHash, recoverBidParcels, saltFromSignature } from "@roundfi/sdk";
import { bidEnvelopeMessage } from "@roundfi/sdk/lance";
import type { RawBidView } from "@roundfi/sdk";

import { MonoLabel } from "@/components/brand/brand";
import { ghostBtn, primaryBtn } from "@/components/modals/JoinGroupModal";
import { IntentPanel } from "@/components/ui/IntentPanel";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import type { ActiveGroup } from "@/data/groups";
import { clearEnvelope, loadEnvelope, saveEnvelope } from "@/lib/bid-envelope";
import { DEVNET_POOLS } from "@/lib/devnet";
import { USDC_RATE, useI18n } from "@/lib/i18n";
import { classifyLanceError, type FreeBidView } from "@/lib/lance";
import { isMissingSignatureError } from "@/lib/mobileWallet";
import { sendPlaceBidCommit, sendPlaceBidReveal } from "@/lib/place-bid";
import { useTheme } from "@/lib/theme";
import { shortAddr, useWallet } from "@/lib/wallet";

// Lance livre (ADR 0012 Fase 3) — the sealed free bid, in two acts.
//
//   SEAL    (bidding open)   pick K → sign → commit the hash. Nothing else
//                            is written on chain, so nobody can read how
//                            deep you went.
//   OPEN    (window flipped) reproduce (amount, salt) → reveal, which pays
//                            K installments and adjudicates atomically.
//
// The secret is DERIVED from a wallet signature, not stored: the same
// wallet re-signing the same message reproduces the same salt on any
// device, and the amount is recovered by scanning the (tiny) space of
// whole-installment bids against the on-chain commit hash. localStorage is
// only a fast path — losing it costs one signature, not the auction.

export interface FreeBidModalProps {
  group: ActiveGroup;
  open: boolean;
  onClose: () => void;
  view: FreeBidView;
  seedKey: keyof typeof DEVNET_POOLS;
  /** Live pool numbers the encoders need. */
  installmentAmount: bigint;
  cyclesTotal: number;
  contributionsPaid: number;
  slotIndex: number;
  /** The on-chain envelope, when one exists (drives the OPEN act). */
  bid: RawBidView | null;
  onSuccess?: () => void;
}

export function FreeBidModal({
  group,
  open,
  onClose,
  view,
  seedKey,
  installmentAmount,
  cyclesTotal,
  contributionsPaid,
  slotIndex,
  bid,
  onSuccess,
}: FreeBidModalProps) {
  const { tokens } = useTheme();
  const { t, fmtMoney } = useI18n();
  const { connection } = useConnection();
  const adapter = useAdapterWallet();
  const chainWallet = useWallet();
  const { explorerTx } = chainWallet;

  const [parcels, setParcels] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [done, setDone] = useState<"sealed" | "revealed" | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  /** The (parcels, salt) pair for the OPEN act — cache hit or recovered. */
  const [secret, setSecret] = useState<{ parcels: number; salt: bigint } | null>(null);

  const wallet = adapter.publicKey;
  const poolPda = DEVNET_POOLS[seedKey].pda;
  const cycle = view.targetCycle;
  const isOpening = view.status === "canReveal";

  // Cache hit: read the local copy the moment the OPEN act mounts.
  useEffect(() => {
    if (!open || !isOpening || !wallet) return;
    const cached = loadEnvelope(poolPda.toBase58(), cycle, wallet.toBase58());
    if (cached) setSecret({ parcels: cached.parcels, salt: BigInt(cached.salt) });
  }, [open, isOpening, wallet, poolPda, cycle]);

  const installmentUsdc = Number(installmentAmount) / 1e6;
  const bidUsdc = installmentUsdc * parcels;
  const bidBrl = bidUsdc * USDC_RATE;
  const secretBrl = secret ? installmentUsdc * secret.parcels * USDC_RATE : 0;

  const reset = () => {
    setSubmitting(false);
    setRecovering(false);
    setDone(null);
    setTxSig(null);
    setChainError(null);
    onClose();
  };

  const describeError = (err: unknown): string => {
    const e = err as { message?: string; logs?: string[]; cause?: unknown };
    const parts: string[] = [];
    if (e.message) parts.push(e.message);
    if (Array.isArray(e.logs) && e.logs.length > 0) parts.push("logs:\n" + e.logs.join("\n"));
    if (e.cause) parts.push("cause: " + String(e.cause));
    if (parts.length === 0) parts.push(String(err));
    const blob = parts.join("\n");
    const key = classifyLanceError(blob);
    return key ? t(key) : isMissingSignatureError(blob) ? t("wallet.mobileRelay.error") : blob;
  };

  /** Derive this envelope's salt from a wallet signature (deterministic). */
  const deriveSalt = async (): Promise<bigint> => {
    if (!adapter.signMessage) throw new Error(t("modal.freeBid.err.noSignMessage"));
    const message = new TextEncoder().encode(bidEnvelopeMessage(poolPda, cycle));
    const signature = await adapter.signMessage(message);
    return saltFromSignature(signature);
  };

  const handleSeal = async () => {
    if (!wallet || !adapter.sendTransaction) return;
    setSubmitting(true);
    setChainError(null);
    try {
      const salt = await deriveSalt();
      const commitHash = freeBidCommitHash(
        BigInt(parcels) * installmentAmount,
        salt,
        wallet as PublicKey,
      );
      const sig = await sendPlaceBidCommit({
        connection,
        sendTransaction: adapter.sendTransaction,
        pool: poolPda,
        bidder: wallet as PublicKey,
        cycle,
        commitHash,
      });
      // Cache AFTER the commit confirms — storing a secret for an envelope
      // that never landed would show a phantom "you have a sealed bid".
      saveEnvelope(poolPda.toBase58(), cycle, wallet.toBase58(), {
        parcels,
        salt: salt.toString(),
        sealedAt: Math.floor(Date.now() / 1000),
      });
      setTxSig(sig);
      onSuccess?.();
      setSubmitting(false);
      setDone("sealed");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[RoundFi] place_bid_commit failed:", err);
      setChainError(describeError(err));
      setSubmitting(false);
    }
  };

  /** Rebuild (parcels, salt) from the wallet + the on-chain commit hash. */
  const handleRecover = async () => {
    if (!wallet || !bid) return;
    setRecovering(true);
    setChainError(null);
    try {
      const salt = await deriveSalt();
      const found = recoverBidParcels(
        bid.commitHash,
        salt,
        wallet as PublicKey,
        installmentAmount,
        Math.max(1, view.maxParcels),
      );
      if (found === null) {
        setChainError(t("modal.freeBid.err.recoveryFailed"));
      } else {
        setSecret({ parcels: found, salt });
        saveEnvelope(poolPda.toBase58(), cycle, wallet.toBase58(), {
          parcels: found,
          salt: salt.toString(),
          sealedAt: Number(bid.committedAt),
        });
      }
      setRecovering(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[RoundFi] envelope recovery failed:", err);
      setChainError(describeError(err));
      setRecovering(false);
    }
  };

  const handleOpen = async () => {
    if (!wallet || !adapter.sendTransaction || !secret) return;
    setSubmitting(true);
    setChainError(null);
    try {
      const sig = await sendPlaceBidReveal({
        connection,
        sendTransaction: adapter.sendTransaction,
        pool: poolPda,
        bidder: wallet as PublicKey,
        cycle,
        parcels: secret.parcels,
        installmentAmount,
        salt: secret.salt,
        contributionsPaid,
        cyclesTotal,
        slotIndex,
      });
      clearEnvelope(poolPda.toBase58(), cycle, wallet.toBase58());
      setTxSig(sig);
      onSuccess?.();
      setSubmitting(false);
      setDone("revealed");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[RoundFi] place_bid_reveal failed:", err);
      setChainError(describeError(err));
      setSubmitting(false);
    }
  };

  const explorerLink = (sig: string) => (
    <a
      href={explorerTx(sig)}
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
      {t("modal.lance.success.txLabel")} · {shortAddr(sig, 6, 6)}
    </a>
  );

  const note = (
    label: string,
    body: string,
    accent: string,
    bg: string = `${accent}14`,
    border: string = `${accent}33`,
  ) => (
    <div
      style={{
        marginBottom: 14,
        padding: "10px 12px",
        borderRadius: 10,
        background: bg,
        border: `1px solid ${border}`,
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <MonoLabel size={9} color={accent}>
        {label}
      </MonoLabel>
      <span style={{ flex: 1, fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>{body}</span>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : reset}
      title={done ? "" : isOpening ? t("modal.freeBid.open.title") : t("modal.freeBid.seal.title")}
      subtitle={
        done
          ? undefined
          : isOpening
            ? t("modal.freeBid.open.subtitle")
            : t("modal.freeBid.seal.subtitle")
      }
      closeable={!submitting}
      width={480}
    >
      {done ? (
        <ModalSuccess
          title={
            done === "sealed" ? t("modal.freeBid.sealed.title") : t("modal.freeBid.opened.title")
          }
          body={
            <>
              {done === "sealed"
                ? t("modal.freeBid.sealed.body", { n: view.targetCycle + 1 })
                : t("modal.freeBid.opened.body", { n: view.targetCycle + 1 })}
              {txSig ? explorerLink(txSig) : null}
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
          {/* Group + cycle context */}
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
                background: `${tokens.teal}1A`,
                border: `1px solid ${tokens.teal}4D`,
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

          {isOpening ? (
            <>
              {/* ── OPEN act ─────────────────────────────────────────── */}
              {secret ? (
                <div
                  style={{
                    padding: 18,
                    borderRadius: 14,
                    background: `linear-gradient(145deg, ${tokens.teal}26, ${tokens.surface1} 80%)`,
                    border: `1px solid ${tokens.teal}55`,
                    marginBottom: 16,
                    textAlign: "center",
                  }}
                >
                  <MonoLabel size={9} color={tokens.teal}>
                    {t("modal.freeBid.open.sealedLabel")}
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
                    {secret.parcels}×
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      color: tokens.muted,
                      fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    }}
                  >
                    {fmtMoney(secretBrl, { noCents: true })}
                  </div>
                </div>
              ) : (
                note(
                  t("modal.freeBid.recover.label"),
                  t("modal.freeBid.recover.body"),
                  tokens.amber,
                )
              )}

              {note(
                t("modal.freeBid.open.payLabel"),
                t("modal.freeBid.open.payBody", { n: view.targetCycle + 1 }),
                tokens.purple,
              )}
              {note(
                t("modal.freeBid.open.loseLabel"),
                t("modal.freeBid.open.loseBody"),
                tokens.green,
              )}
            </>
          ) : (
            <>
              {/* ── SEAL act ─────────────────────────────────────────── */}
              <MonoLabel size={9}>{t("modal.freeBid.seal.pick")}</MonoLabel>
              <div
                style={{
                  marginTop: 8,
                  marginBottom: 14,
                  padding: 14,
                  borderRadius: 12,
                  background: tokens.fillSoft,
                  border: `1px solid ${tokens.borderStr}`,
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
                >
                  <button
                    type="button"
                    onClick={() => setParcels((p) => Math.max(1, p - 1))}
                    disabled={parcels <= 1}
                    style={{
                      ...ghostBtn(tokens),
                      width: 40,
                      padding: "6px 0",
                      opacity: parcels <= 1 ? 0.4 : 1,
                    }}
                  >
                    −
                  </button>
                  <div style={{ textAlign: "center" }}>
                    <div
                      style={{
                        fontFamily: "var(--font-syne), Syne",
                        fontSize: 34,
                        fontWeight: 800,
                        color: tokens.text,
                        lineHeight: 1,
                      }}
                    >
                      {parcels}×
                    </div>
                    <div style={{ fontSize: 11, color: tokens.muted, marginTop: 4 }}>
                      {fmtMoney(bidBrl, { noCents: true })}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setParcels((p) => Math.min(view.maxParcels, p + 1))}
                    disabled={parcels >= view.maxParcels}
                    style={{
                      ...ghostBtn(tokens),
                      width: 40,
                      padding: "6px 0",
                      opacity: parcels >= view.maxParcels ? 0.4 : 1,
                    }}
                  >
                    +
                  </button>
                </div>
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 10,
                    color: tokens.muted,
                    textAlign: "center",
                    lineHeight: 1.5,
                  }}
                >
                  {t("modal.freeBid.seal.max", { n: view.maxParcels })}
                </div>
              </div>

              {note(
                t("modal.freeBid.seal.secretLabel"),
                t("modal.freeBid.seal.secretBody"),
                tokens.teal,
              )}
              {note(
                t("modal.freeBid.seal.windowLabel"),
                t("modal.freeBid.seal.windowBody"),
                tokens.purple,
              )}
              {note(
                t("modal.freeBid.seal.loseLabel"),
                t("modal.freeBid.seal.loseBody"),
                tokens.green,
              )}
            </>
          )}

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

          {/* Sealing moves nothing; opening pays the bid. */}
          <IntentPanel
            action={isOpening ? "place_bid_reveal" : "place_bid_commit"}
            amountUsdc={isOpening ? installmentUsdc * (secret?.parcels ?? 0) : 0}
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
            {isOpening && !secret ? (
              <button
                type="button"
                onClick={handleRecover}
                disabled={recovering}
                style={{
                  ...primaryBtn(tokens),
                  background: `linear-gradient(135deg, ${tokens.amber}, ${tokens.purple})`,
                  opacity: recovering ? 0.45 : 1,
                }}
              >
                {recovering ? t("modal.freeBid.recover.working") : t("modal.freeBid.recover.cta")}
              </button>
            ) : (
              <button
                type="button"
                onClick={isOpening ? handleOpen : handleSeal}
                disabled={submitting || (isOpening && !secret)}
                style={{
                  ...primaryBtn(tokens),
                  background: `linear-gradient(135deg, ${tokens.teal}, ${tokens.purple})`,
                  opacity: submitting || (isOpening && !secret) ? 0.45 : 1,
                  cursor: submitting ? "default" : "pointer",
                }}
              >
                {submitting
                  ? t("modal.freeBid.cta.working")
                  : isOpening
                    ? t("modal.freeBid.cta.open")
                    : t("modal.freeBid.cta.seal")}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

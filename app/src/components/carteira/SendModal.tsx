"use client";

import { useEffect, useState } from "react";

import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

import { MonoLabel } from "@/components/brand/brand";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import { ghostBtn, primaryBtn } from "@/components/modals/JoinGroupModal";
import { useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { shortAddr, useWallet } from "@/lib/wallet";
import { simulateOrThrow } from "@/lib/simulateTx";

// Send modal — address + amount form, demo confirmation. Real
// signing happens via the Phantom adapter post-M3 (the on-chain
// SPL transfer is just a token::transfer CPI, not a roundfi-core
// instruction — but we frame it as demo to be honest pre-devnet).

type Phase = "form" | "success";

// Solana base58 pubkeys are 32–44 chars.
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function SendModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tokens } = useTheme();
  const t = useT();
  const { fmtMoney } = useI18n();
  const { user, sendPayment } = useSession();
  const [phase, setPhase] = useState<Phase>("form");
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const { connection } = useConnection();
  const adapter = useAdapterWallet();
  const wallet = useWallet();

  // Real-send detection — when a wallet is connected on devnet we do an
  // actual SystemProgram.transfer of SOL; otherwise the demo mock runs.
  const onChainReady =
    wallet.status === "connected" && !!adapter.publicKey && wallet.balanceSol != null;

  useEffect(() => {
    if (open) {
      setPhase("form");
      setAddress("");
      setAmount("");
      setTxSig(null);
      setChainError(null);
    }
  }, [open]);

  const numericAmount = Number(amount) || 0;
  const availBalance = onChainReady ? (wallet.balanceSol ?? 0) : user.balance;
  const validAddress = SOLANA_ADDRESS_RE.test(address.trim());
  const validAmount = numericAmount > 0 && numericAmount <= availBalance;
  const canSubmit = validAddress && validAmount;

  const handleConfirm = async () => {
    setSubmitting(true);
    setChainError(null);

    if (onChainReady && adapter.publicKey && adapter.sendTransaction) {
      try {
        const fromPubkey = adapter.publicKey;
        const toPubkey = new PublicKey(address.trim());
        const lamports = Math.round(numericAmount * LAMPORTS_PER_SOL);
        const tx = new Transaction().add(
          SystemProgram.transfer({ fromPubkey, toPubkey, lamports }),
        );
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer = fromPubkey;
        // Dry-run before the wallet signs — never sign a tx that will
        // fail on-chain (frontend-security checklist §2.2). The catch
        // below already surfaces the simulation error's message + logs.
        await simulateOrThrow(connection, tx);
        const sig = await adapter.sendTransaction(tx, connection);
        await connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        setTxSig(sig);
        void wallet.refresh();
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
        console.error("[RoundFi] SOL transfer failed:", err);
        setChainError(parts.join("\n"));
        setSubmitting(false);
      }
      return;
    }

    // Mock fallback — the original demo flow (decrements the demo balance +
    // emits a payment event). Real Phantom signing only when connected.
    setTimeout(() => {
      sendPayment(numericAmount, address.trim());
      setSubmitting(false);
      setPhase("success");
    }, 900);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={phase === "form" ? t("modal.send.title") : t("modal.send.successTitle")}
      subtitle={phase === "form" ? t("modal.send.subtitle") : undefined}
      width={460}
    >
      {phase === "form" ? (
        <>
          {/* Available balance */}
          <div
            style={{
              padding: 12,
              borderRadius: 12,
              background: tokens.fillSoft,
              border: `1px solid ${tokens.border}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <MonoLabel size={9}>{t("modal.send.balance")}</MonoLabel>
            <span
              style={{
                fontFamily: "var(--font-syne), Syne",
                fontSize: 18,
                fontWeight: 700,
                color: tokens.text,
                letterSpacing: "-0.02em",
              }}
            >
              {onChainReady
                ? `${(wallet.balanceSol ?? 0).toFixed(4)} SOL`
                : fmtMoney(user.balance, { noCents: true })}
            </span>
          </div>

          {/* Address input */}
          <div style={{ marginTop: 14 }}>
            <MonoLabel size={9}>{t("modal.send.toLabel")}</MonoLabel>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t("modal.send.toPlaceholder")}
              aria-label={t("modal.send.toLabel")}
              style={{
                marginTop: 6,
                width: "100%",
                padding: "12px 14px",
                borderRadius: 10,
                background: tokens.fillSoft,
                border: `1px solid ${
                  address.length === 0 || validAddress ? tokens.border : tokens.red + "55"
                }`,
                color: tokens.text,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                fontSize: 12,
                outline: "none",
                transition: "border-color 180ms ease",
              }}
            />
            {address.length > 0 && !validAddress && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 10,
                  color: tokens.red,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {t("modal.send.invalidAddress")}
              </div>
            )}
          </div>

          {/* Amount input */}
          <div style={{ marginTop: 14 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <MonoLabel size={9}>{t("modal.send.amountLabel")}</MonoLabel>
              <button
                type="button"
                onClick={() =>
                  setAmount(
                    String(
                      onChainReady ? Math.max(0, (wallet.balanceSol ?? 0) - 0.001) : user.balance,
                    ),
                  )
                }
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 10,
                  color: tokens.teal,
                  fontWeight: 700,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  letterSpacing: "0.08em",
                }}
              >
                {t("modal.send.max")}
              </button>
            </div>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              min={0}
              max={availBalance}
              step={0.01}
              aria-label={t("modal.send.amountLabel")}
              style={{
                marginTop: 6,
                width: "100%",
                padding: "12px 14px",
                borderRadius: 10,
                background: tokens.fillSoft,
                border: `1px solid ${
                  amount.length === 0 || validAmount ? tokens.border : tokens.red + "55"
                }`,
                color: tokens.text,
                fontFamily: "var(--font-syne), Syne",
                fontSize: 18,
                fontWeight: 700,
                outline: "none",
              }}
            />
            {amount.length > 0 && !validAmount && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 10,
                  color: tokens.red,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {numericAmount > user.balance
                  ? t("modal.send.insufficientFunds")
                  : t("modal.send.invalidAmount")}
              </div>
            )}
          </div>

          {/* Mode callout — real devnet transfer vs demo */}
          <div
            style={{
              marginTop: 14,
              padding: "10px 12px",
              borderRadius: 10,
              background: onChainReady ? `${tokens.green}14` : `${tokens.amber}14`,
              border: `1px solid ${onChainReady ? `${tokens.green}33` : `${tokens.amber}33`}`,
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <MonoLabel size={9} color={onChainReady ? tokens.green : tokens.amber}>
              {t(onChainReady ? "modal.send.realBadge" : "modal.send.demoBadge")}
            </MonoLabel>
            <span style={{ fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
              {t(onChainReady ? "modal.send.realBody" : "modal.send.demoBody")}
            </span>
          </div>

          {chainError ? (
            <div
              style={{
                marginTop: 12,
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
            <button type="button" onClick={onClose} style={ghostBtn(tokens)}>
              {t("modal.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canSubmit || submitting}
              style={{
                ...primaryBtn(tokens),
                opacity: !canSubmit || submitting ? 0.45 : 1,
                cursor: !canSubmit || submitting ? "default" : "pointer",
              }}
            >
              {submitting
                ? t("modal.processing")
                : t(onChainReady ? "modal.send.realConfirm" : "modal.send.confirm")}
            </button>
          </div>
        </>
      ) : (
        <ModalSuccess
          title={t("modal.send.successHeadline")}
          body={
            txSig ? (
              <>
                {numericAmount} SOL → {shortAddr(address.trim(), 4, 4)}
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
              t("modal.send.successBody", {
                amount: fmtMoney(numericAmount, { noCents: true }),
                to: `${address.slice(0, 4)}…${address.slice(-4)}`,
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
              {t("modal.send.close")}
            </button>
          }
        />
      )}
    </Modal>
  );
}

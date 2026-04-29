"use client";

import { useEffect, useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import { ghostBtn, primaryBtn } from "@/components/modals/JoinGroupModal";
import { useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

// Send modal — address + amount form, demo confirmation. Real
// signing happens via the Phantom adapter post-M3 (the on-chain
// SPL transfer is just a token::transfer CPI, not a roundfi-core
// instruction — but we frame it as demo to be honest pre-devnet).

type Phase = "form" | "success";

// Solana base58 pubkeys are 32–44 chars.
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function SendModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { tokens } = useTheme();
  const t = useT();
  const { fmtMoney } = useI18n();
  const { user } = useSession();
  const [phase, setPhase] = useState<Phase>("form");
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (open) {
      setPhase("form");
      setAddress("");
      setAmount("");
    }
  }, [open]);

  const numericAmount = Number(amount) || 0;
  const validAddress = SOLANA_ADDRESS_RE.test(address.trim());
  const validAmount = numericAmount > 0 && numericAmount <= user.balance;
  const canSubmit = validAddress && validAmount;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        phase === "form"
          ? t("modal.send.title")
          : t("modal.send.successTitle")
      }
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
              {fmtMoney(user.balance, { noCents: true })}
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
              style={{
                marginTop: 6,
                width: "100%",
                padding: "12px 14px",
                borderRadius: 10,
                background: tokens.fillSoft,
                border: `1px solid ${
                  address.length === 0 || validAddress
                    ? tokens.border
                    : tokens.red + "55"
                }`,
                color: tokens.text,
                fontFamily:
                  "var(--font-jetbrains-mono), JetBrains Mono, monospace",
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
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
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
                onClick={() => setAmount(String(user.balance))}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 10,
                  color: tokens.teal,
                  fontWeight: 700,
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
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
              max={user.balance}
              step={0.01}
              style={{
                marginTop: 6,
                width: "100%",
                padding: "12px 14px",
                borderRadius: 10,
                background: tokens.fillSoft,
                border: `1px solid ${
                  amount.length === 0 || validAmount
                    ? tokens.border
                    : tokens.red + "55"
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
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {numericAmount > user.balance
                  ? t("modal.send.insufficientFunds")
                  : t("modal.send.invalidAmount")}
              </div>
            )}
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
              {t("modal.send.demoBadge")}
            </MonoLabel>
            <span
              style={{ fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}
            >
              {t("modal.send.demoBody")}
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
              onClick={() => setPhase("success")}
              disabled={!canSubmit}
              style={{
                ...primaryBtn(tokens),
                opacity: canSubmit ? 1 : 0.45,
                cursor: canSubmit ? "pointer" : "not-allowed",
              }}
            >
              {t("modal.send.confirm")}
            </button>
          </div>
        </>
      ) : (
        <ModalSuccess
          title={t("modal.send.successHeadline")}
          body={t("modal.send.successBody", {
            amount: fmtMoney(numericAmount, { noCents: true }),
            to: `${address.slice(0, 4)}…${address.slice(-4)}`,
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
              {t("modal.send.close")}
            </button>
          }
        />
      )}
    </Modal>
  );
}

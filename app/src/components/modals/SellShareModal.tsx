"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";

import { MonoLabel } from "@/components/brand/brand";
import { ghostBtn, primaryBtn } from "@/components/modals/JoinGroupModal";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import type { NftPosition, Tone } from "@/data/carteira";
import { DEVNET_POOLS } from "@/lib/devnet";
import { sendEscapeValveList } from "@/lib/escape-valve-list";
import { USDC_RATE, useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { shortAddr, useWallet } from "@/lib/wallet";

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
  const [txSig, setTxSig] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const { connection } = useConnection();
  const adapter = useAdapterWallet();
  const wallet = useWallet();

  useEffect(() => {
    if (open) {
      setDiscount(8);
      setSubmitting(false);
      setDone(false);
      setTxSig(null);
      setChainError(null);
    }
  }, [open]);

  if (!position) return null;

  const askPrice = position.value * (1 - discount / 100);
  // Linear interpolation: 0% discount -> 0% APY bonus,
  // 30% discount -> APY_AT_FULL_DISCOUNT bonus (rough hint).
  const buyerApy = (discount / 30) * APY_AT_FULL_DISCOUNT;

  // Real escape_valve_list when this is the wallet's REAL on-chain slot
  // (surfaced from usePoolMembers — carries devnetPool + slotIndex). Mock
  // positions lack those, so they keep the original demo flow unchanged.
  const onChainReady =
    !!position.devnetPool &&
    position.slotIndex != null &&
    wallet.status === "connected" &&
    !!adapter.publicKey;

  // `position.value` is unit-polymorphic: whole USDC for real on-chain slots
  // (useMyDevnetPositions), BRL for the mock fixtures. fmtMoney expects BRL, so
  // scale the on-chain (USDC) values up by USDC_RATE for the face/ask preview;
  // the mock values are already BRL. Keeps what the seller sees consistent with
  // the USDC actually signed below.
  const faceBrl = onChainReady ? position.value * USDC_RATE : position.value;
  const askBrl = onChainReady ? askPrice * USDC_RATE : askPrice;

  const reset = () => {
    setSubmitting(false);
    setDone(false);
    setTxSig(null);
    setChainError(null);
    onClose();
  };

  const handleConfirm = async () => {
    if (!position) return;
    setSubmitting(true);
    setChainError(null);

    if (
      onChainReady &&
      position.devnetPool &&
      position.slotIndex != null &&
      adapter.publicKey &&
      adapter.sendTransaction
    ) {
      try {
        const sig = await sendEscapeValveList({
          connection,
          sendTransaction: adapter.sendTransaction,
          pool: DEVNET_POOLS[position.devnetPool].pda,
          sellerWallet: adapter.publicKey,
          slotIndex: position.slotIndex,
          // The real escape_valve_list path only fires for on-chain slots
          // (devnetPool + slotIndex), whose `value` is whole USDC
          // (useMyDevnetPositions: creditAmount / 1e6) — so askPrice is already
          // whole USDC; scale straight to 1e6 base units. Do NOT divide by
          // USDC_RATE here: the BRL unit only applies to the mock fixtures,
          // which never reach this branch (they lack devnetPool/slotIndex).
          priceUsdc: Math.round(askPrice * 1e6),
        });
        setTxSig(sig);
        // Mirror the mock bookkeeping so the listings UI advances.
        sellShare(position, askPrice, discount);
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
        console.error("[RoundFi] escape_valve_list failed:", err);
        setChainError(parts.join("\n"));
        setSubmitting(false);
      }
      return;
    }

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
          body={
            txSig ? (
              <>
                {t("modal.sell.success.body", { d: discount.toFixed(1) })}
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
              t("modal.sell.success.body", { d: discount.toFixed(1) })
            )
          }
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
              aria-label="Desconto"
              aria-valuetext={`${discount.toFixed(1)}%`}
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
                {fmtMoney(faceBrl, { noCents: true })}
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
                {fmtMoney(askBrl, { noCents: true })}
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

          {onChainReady ? (
            <div
              style={{
                marginBottom: 14,
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
                slot on-chain #{position.slotIndex} · Phantom
              </span>
            </div>
          ) : null}

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
                TX FAILED
              </MonoLabel>
              <div style={{ marginTop: 4 }}>{chainError}</div>
            </div>
          ) : null}

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

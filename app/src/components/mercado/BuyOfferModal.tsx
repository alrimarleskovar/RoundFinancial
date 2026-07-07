"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";

import { memberPda } from "@roundfi/sdk/pda";

import { MonoLabel } from "@/components/brand/brand";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import type { OnchainListingRef } from "@/data/market";
import { DEVNET_POOLS, DEVNET_PROGRAM_IDS } from "@/lib/devnet";
import { sendEscapeValveBuy } from "@/lib/escape-valve-buy";
import { hoverBtn } from "@/lib/hoverLift";
import { useI18n, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Buy-flow modal for the secondary market. Two states:
//   1. confirm — offer summary + a CTA.
//   2. success — ModalSuccess with a green check + auto-close hint.
//
// Two buy paths, chosen by `target.onchain`:
//   - REAL on-chain listing (useDevnetListings): the CTA signs an
//     `escape_valve_buy` via the wallet adapter — the buyer pays USDC straight
//     to the seller and the cota transfers on-chain. Simulated before signing.
//   - demo fixture: a simulated ~900ms acknowledgement, clearly badged DEMO so
//     the UI never claims a real purchase happened.

export interface BuyOfferTarget {
  /** Marketplace offer id — fed back to session.buyShare so the
   *  OffersTable can mark the row as purchased. */
  id: string;
  /** Pool / ROSCA group label. */
  group: string;
  /** Optional second-line detail (e.g. "Cota #02 · Mês 2/12"). */
  detail?: string;
  /** Face value of the share, in BRL. */
  face: number;
  /** Resale ask price, in BRL. */
  price: number;
  /** Discount as a positive percent (e.g. 12.2 → "−12.2%"). */
  discount: number;
  // ── Optional NFT-position metadata ─────────────────────────────────
  // Forwarded to session.buyShare so /carteira can render the
  // acquired cota natively. OffersTable populates all four; the
  // FeaturedOffer card may omit some fields and the reducer falls
  // back to safe defaults.
  num?: string;
  month?: number;
  total?: number;
  tone?: import("@/data/carteira").Tone;
  /** Present for REAL on-chain listings — switches the CTA to escape_valve_buy
   *  instead of the simulated demo path. Absent on fixtures. */
  onchain?: OnchainListingRef;
}

type Phase = "confirm" | "success";

export function BuyOfferModal({
  target,
  open,
  onClose,
  onPurchased,
}: {
  target: BuyOfferTarget | null;
  open: boolean;
  onClose: () => void;
  onPurchased?: (target: BuyOfferTarget) => void;
}) {
  const { tokens } = useTheme();
  const { fmtMoney } = useI18n();
  const t = useT();
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useAdapterWallet();
  const [phase, setPhase] = useState<Phase>("confirm");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = unknown / not applicable (demo path or no wallet); true = the buyer
  // already holds a Member PDA in this pool. escape_valve_buy inits a fresh
  // Member seeded by (pool, buyer wallet); if the buyer is already a member
  // that init collides and the System Program reverts AccountAlreadyInUse
  // (custom program error 0x0) in simulation. Pre-check it so we can show a
  // human message instead of leaking the raw code (mirrors the crank funding
  // pre-check, #613).
  const [alreadyMember, setAlreadyMember] = useState<boolean | null>(null);

  const onchain = target?.onchain;
  const poolKey = onchain?.poolKey;

  // Reset to confirm phase + clear errors whenever the modal opens anew.
  useEffect(() => {
    if (open) {
      setPhase("confirm");
      setError(null);
    }
  }, [open, target?.group]);

  // Existing-member pre-check (real on-chain path only).
  useEffect(() => {
    if (!open || !poolKey || !publicKey) {
      setAlreadyMember(null);
      return;
    }
    let cancelled = false;
    const poolPda = DEVNET_POOLS[poolKey].pda;
    const [member] = memberPda(DEVNET_PROGRAM_IDS.core, poolPda, publicKey);
    connection
      .getAccountInfo(member)
      .then((info) => {
        if (!cancelled) setAlreadyMember(info !== null);
      })
      .catch(() => {
        // Fall back to the on-chain simulation guard if the lookup fails.
        if (!cancelled) setAlreadyMember(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, poolKey, publicKey, connection]);

  if (!target) return null;

  const savings = Math.max(0, target.face - target.price);

  // Demo path: a simulated ~900ms acknowledgement (no chain write).
  const runDemoBuy = () => {
    setSubmitting(true);
    setTimeout(() => {
      onPurchased?.(target);
      setSubmitting(false);
      setPhase("success");
    }, 900);
  };

  // Real path: sign + send escape_valve_buy. The helper dry-runs the tx
  // on-chain first, so one that would fail never reaches the wallet.
  const runRealBuy = async () => {
    if (!onchain) return;
    if (!publicKey || !sendTransaction) {
      setError(t("market.buyModal.errConnect"));
      return;
    }
    if (alreadyMember) {
      setError(t("market.buyModal.alreadyMember"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await sendEscapeValveBuy({
        connection,
        sendTransaction,
        pool: DEVNET_POOLS[onchain.poolKey].pda,
        buyerWallet: publicKey,
        slotIndex: onchain.slotIndex,
        expectedPriceUsdc: BigInt(onchain.priceUsdc),
      });
      onPurchased?.(target);
      setPhase("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        phase === "confirm"
          ? t("market.buyModal.title")
          : t(onchain ? "market.buyModal.realSuccessTitle" : "market.buyModal.successTitle")
      }
      subtitle={phase === "confirm" ? t("market.buyModal.subtitle") : undefined}
      width={480}
    >
      {phase === "confirm" ? (
        <>
          {/* Offer summary card */}
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: tokens.fillSoft,
              border: `1px solid ${tokens.border}`,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-syne), Syne",
                fontSize: 18,
                fontWeight: 700,
                color: tokens.text,
                letterSpacing: "-0.02em",
              }}
            >
              {target.group}
            </div>
            {target.detail && (
              <div
                style={{
                  fontSize: 11,
                  color: tokens.muted,
                  marginTop: 4,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {target.detail}
              </div>
            )}

            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <Stat
                label={t("market.buyModal.face")}
                value={fmtMoney(target.face, { noCents: true })}
                color={tokens.text2}
              />
              <Stat
                label={t("market.buyModal.price")}
                value={fmtMoney(target.price, { noCents: true })}
                color={tokens.text}
                emphasis
              />
              <Stat
                label={t("market.buyModal.discount")}
                value={`−${target.discount.toFixed(1)}%`}
                color={tokens.green}
              />
              <Stat
                label={t("market.buyModal.savings")}
                value={fmtMoney(savings, { noCents: true })}
                color={tokens.green}
              />
            </div>
          </div>

          {/* Path disclaimer — real (on-chain, teal) vs demo (amber). */}
          <div
            style={{
              marginTop: 14,
              padding: "10px 12px",
              borderRadius: 10,
              background: `${onchain ? tokens.teal : tokens.amber}14`,
              border: `1px solid ${onchain ? tokens.teal : tokens.amber}33`,
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <MonoLabel size={9} color={onchain ? tokens.teal : tokens.amber}>
              {t(onchain ? "market.buyModal.realBadge" : "market.buyModal.demoBadge")}
            </MonoLabel>
            <span
              style={{
                fontSize: 11,
                color: tokens.text2,
                lineHeight: 1.5,
              }}
            >
              {t(onchain ? "market.buyModal.realBody" : "market.buyModal.demoBody")}
            </span>
          </div>

          {/* Already-a-member notice (real path) — pre-empts the raw
              AccountAlreadyInUse (0x0) the new-Member init would throw. */}
          {alreadyMember && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 10,
                background: `${tokens.amber}14`,
                border: `1px solid ${tokens.amber}40`,
                fontSize: 11,
                color: tokens.amber,
                lineHeight: 1.5,
              }}
            >
              {t("market.buyModal.alreadyMember")}
            </div>
          )}

          {/* Buy error (real path — readable message from the helper / sim). */}
          {error && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 10,
                background: `${tokens.red}14`,
                border: `1px solid ${tokens.red}40`,
                fontSize: 11,
                color: tokens.red,
                lineHeight: 1.5,
                wordBreak: "break-word",
              }}
            >
              {error}
            </div>
          )}

          {/* Action row */}
          <div
            style={{
              marginTop: 18,
              display: "flex",
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: 11,
                borderRadius: 11,
                background: tokens.fillMed,
                color: tokens.text2,
                border: `1px solid ${tokens.borderStr}`,
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                transition: "transform 140ms ease, filter 140ms ease",
              }}
              {...hoverBtn()}
            >
              {t("market.buyModal.cancel")}
            </button>
            <button
              type="button"
              disabled={submitting || alreadyMember === true}
              onClick={() => (onchain ? void runRealBuy() : runDemoBuy())}
              style={{
                flex: 1.4,
                padding: 11,
                borderRadius: 11,
                background: `linear-gradient(135deg, ${tokens.purple}, ${tokens.teal})`,
                color: "#fff",
                border: "none",
                fontWeight: 700,
                fontSize: 12,
                cursor: submitting || alreadyMember === true ? "default" : "pointer",
                opacity: submitting || alreadyMember === true ? 0.6 : 1,
                fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                transition: "transform 140ms ease, filter 140ms ease",
              }}
              {...hoverBtn()}
            >
              {submitting
                ? t("modal.processing")
                : t(onchain ? "market.buyModal.confirmReal" : "market.buyModal.confirm")}
            </button>
          </div>
        </>
      ) : (
        <ModalSuccess
          title={t(
            onchain ? "market.buyModal.realSuccessHeadline" : "market.buyModal.successHeadline",
          )}
          body={t(onchain ? "market.buyModal.realSuccessBody" : "market.buyModal.successBody", {
            group: target.group,
            price: fmtMoney(target.price, { noCents: true }),
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
                transition: "transform 140ms ease, filter 140ms ease",
              }}
              {...hoverBtn()}
            >
              {t("market.buyModal.close")}
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
}: {
  label: string;
  value: string;
  color: string;
  emphasis?: boolean;
}) {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
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
      <span
        style={{
          fontFamily: emphasis
            ? "var(--font-syne), Syne"
            : "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          fontSize: emphasis ? 18 : 13,
          fontWeight: emphasis ? 800 : 600,
          color,
          letterSpacing: emphasis ? "-0.02em" : 0,
        }}
      >
        {value}
      </span>
    </div>
  );
}

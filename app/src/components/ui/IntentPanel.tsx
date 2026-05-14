"use client";

import type { ReactNode } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// IntentPanel — phishing-resistance review surface for issue #249
// workstream 3. Renders a human-readable summary of what the user is
// about to sign BEFORE the wallet prompt fires.
//
// Auditor's concern (T4, T5, T10 from
// docs/security/frontend-security-checklist.md):
//   - User clicks "Confirm" without reading the wallet prompt
//   - Front-end displays one amount but signs a different one
//   - Browser-extension drainer intercepts the prompt
//
// IntentPanel mitigates by surfacing the AUTHORITATIVE intent inside
// our app — independent of the wallet prompt — so the user has a
// reference to cross-check Phantom's display against.
//
// Pattern (caller responsibility):
//   <Modal>
//     <IntentPanel
//       action="contribute"
//       amountUsdc={50}
//       poolLabel="Pedreiros · 6-membros"
//       network={wallet.network}
//       walletLabel={wallet.walletLabel}
//       isHardware={wallet.isHardware}
//       isUnknownWallet={wallet.isUnknownWallet}
//     />
//     <button onClick={() => wallet.sendTransaction(...)}>Confirm</button>
//   </Modal>
//
// Internationalized: PT + EN keys via score-style i18n.

export type IntentAction =
  | "contribute"
  | "claim_payout"
  | "release_escrow"
  | "escape_valve_list"
  | "escape_valve_buy"
  | "harvest_yield"
  | "deposit_idle_to_yield"
  | "settle_default";

export interface IntentPanelProps {
  /** Which instruction is about to be signed. */
  action: IntentAction;
  /** Net USDC the user pays (positive) or receives (negative).
   *  Use 0 for permissionless cranks (harvest, deposit_idle, settle_default). */
  amountUsdc: number;
  /** Human-readable pool name for context. */
  poolLabel: string;
  /** Current network — surfaces "DEVNET" / "MAINNET" inline so the
   *  user can cross-check against Phantom's network label. */
  network: "devnet" | "localnet" | "mainnet-beta";
  /** Connected wallet name (e.g., "Phantom", "Ledger"). */
  walletLabel: string | null;
  /** From `wallet.isHardware` — surfaces a "🔒 Hardware wallet" confidence cue. */
  isHardware?: boolean;
  /** From `wallet.isUnknownWallet` — surfaces an "⚠ Unknown wallet" caution. */
  isUnknownWallet?: boolean;
  /** Approximate SOL fee. Default ~5000 lamports (a typical tx). */
  feeLamports?: number;
}

export function IntentPanel({
  action,
  amountUsdc,
  poolLabel,
  network,
  walletLabel,
  isHardware = false,
  isUnknownWallet = false,
  feeLamports = 5_000,
}: IntentPanelProps): ReactNode {
  const { tokens } = useTheme();
  const t = useT();

  const isMainnet = network === "mainnet-beta";
  const isCrank = amountUsdc === 0;
  const direction = amountUsdc > 0 ? "send" : amountUsdc < 0 ? "receive" : "crank";

  // Convert lamports → SOL with 4-decimal precision (matches the
  // wallet-chip balance display).
  const feeSol = feeLamports / 1_000_000_000;

  // Locale-aware USDC formatting — uses 2 decimals (USDC is 6-decimal
  // on chain but UX presents whole-dollar cents).
  const fmtUsdc = (n: number): string =>
    Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <div
      role="region"
      aria-label={t("intent.regionLabel")}
      style={{
        marginTop: 16,
        padding: 16,
        borderRadius: 12,
        background: isMainnet ? `${tokens.red}0F` : tokens.fillSoft,
        border: `2px solid ${isMainnet ? tokens.red : tokens.borderStr}`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <MonoLabel color={isMainnet ? tokens.red : tokens.teal}>◆ {t("intent.title")}</MonoLabel>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            padding: "2px 7px",
            borderRadius: 5,
            background: isMainnet ? `${tokens.red}1A` : `${tokens.teal}1A`,
            color: isMainnet ? tokens.red : tokens.teal,
            border: `1px solid ${isMainnet ? `${tokens.red}55` : `${tokens.teal}55`}`,
            letterSpacing: "0.08em",
          }}
        >
          {isMainnet ? t("intent.networkMainnet") : t("intent.networkDevnet")}
        </span>
      </div>

      <p
        style={{
          margin: "10px 0 0",
          fontSize: 13,
          lineHeight: 1.5,
          color: tokens.text,
        }}
      >
        {direction === "send" && (
          <>
            {t("intent.bodySend", {
              amount: fmtUsdc(amountUsdc),
              action: t(`intent.action.${action}`),
              pool: poolLabel,
            })}
          </>
        )}
        {direction === "receive" && (
          <>
            {t("intent.bodyReceive", {
              amount: fmtUsdc(amountUsdc),
              action: t(`intent.action.${action}`),
              pool: poolLabel,
            })}
          </>
        )}
        {direction === "crank" && (
          <>
            {t("intent.bodyCrank", {
              action: t(`intent.action.${action}`),
              pool: poolLabel,
            })}
          </>
        )}
      </p>

      <ul
        style={{
          margin: "12px 0 0",
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          fontSize: 11,
          color: tokens.text2,
        }}
      >
        {!isCrank && (
          <li>
            <strong style={{ color: tokens.text }}>{t("intent.row.amount")}:</strong>{" "}
            {fmtUsdc(amountUsdc)} USDC
          </li>
        )}
        <li>
          <strong style={{ color: tokens.text }}>{t("intent.row.fee")}:</strong> ~
          {feeSol.toFixed(6)} SOL
        </li>
        <li>
          <strong style={{ color: tokens.text }}>{t("intent.row.wallet")}:</strong>{" "}
          {walletLabel ?? t("intent.row.walletUnknown")}{" "}
          {isHardware && <span style={{ color: tokens.green }}>🔒 HW</span>}
          {isUnknownWallet && !isHardware && <span style={{ color: tokens.amber }}>⚠</span>}
        </li>
      </ul>

      {isMainnet && (
        <p
          style={{
            margin: "12px 0 0",
            padding: "8px 10px",
            borderRadius: 8,
            background: `${tokens.red}1A`,
            color: tokens.red,
            fontSize: 11,
            fontWeight: 700,
            border: `1px solid ${tokens.red}55`,
          }}
        >
          <Icons.info size={12} stroke={tokens.red} /> {t("intent.mainnetWarning")}
        </p>
      )}
    </div>
  );
}

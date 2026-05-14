// Wallet allowlist + hardware detection.
//
// Issue #249 workstream 1 — wallet adapter hardening. The base
// `@solana/wallet-adapter-react` integration accepts any wallet that
// implements the wallet-standard spec. For mainnet user safety we want
// to gate the connect flow to a curated list and visually warn users
// when they're about to connect with an unknown wallet.
//
// Policy:
//   - DEVNET: warn but allow (encourage new-wallet testing)
//   - MAINNET: block non-allowlisted wallets entirely
//
// The allowlist is intentionally conservative. New wallets get added
// after a basic vetting pass (responsive maintenance, no known
// drainer history, audited release process).

import type { NetworkId } from "@/lib/network";

/**
 * Curated set of supported wallet adapter names. Standard-wallet
 * auto-discovery surfaces wallet `name` from `adapter.wallet.adapter.name`;
 * comparison is case-sensitive (matches upstream convention).
 *
 * Adding a new wallet:
 *   1. Verify the wallet has been actively maintained for ≥ 6 months
 *   2. Confirm no known drainer / supply-chain incidents
 *   3. Test connect + sign flow on devnet first
 *   4. Document the addition in CHANGELOG + bug-bounty scope
 */
export const ALLOWED_WALLET_NAMES: ReadonlySet<string> = new Set([
  // Hot wallets (browser extension + mobile)
  "Phantom",
  "Solflare",
  "Backpack",
  "Glow",
  "Nightly",
  // Hardware wallets
  "Ledger",
  "Trezor",
]);

/**
 * Subset of the allowlist that are hardware wallets. Used to surface a
 * "🔒 Hardware wallet detected" badge in the wallet chip, which gives
 * users a confidence signal at sign time (HW wallets show tx details
 * on a physical device — phishing-resistant).
 */
export const HARDWARE_WALLET_NAMES: ReadonlySet<string> = new Set(["Ledger", "Trezor"]);

export type WalletAllowlistDecision =
  | { kind: "allowed" }
  | { kind: "warn"; reason: "unknown_wallet" }
  | { kind: "block"; reason: "unknown_wallet_on_mainnet" };

/**
 * Decide whether a wallet adapter name should be allowed at connect time
 * for the given network. Returns one of three outcomes:
 *
 *   - "allowed"  → wallet is on the curated allowlist
 *   - "warn"     → unknown wallet, but devnet → show a yellow warning + proceed
 *   - "block"    → unknown wallet on mainnet → refuse connect with a clear reason
 */
export function decideWalletAllowlist(
  walletName: string,
  network: NetworkId,
): WalletAllowlistDecision {
  if (ALLOWED_WALLET_NAMES.has(walletName)) {
    return { kind: "allowed" };
  }
  // Note: mainnet support is tracked under MAINNET_READINESS.md §5
  // (front-end mainnet readiness). When NetworkId gains "mainnet-beta"
  // the policy below becomes load-bearing; today (devnet only) it's
  // a guard rail for the next milestone.
  const isMainnet = (network as string) === "mainnet-beta";
  if (isMainnet) {
    return { kind: "block", reason: "unknown_wallet_on_mainnet" };
  }
  return { kind: "warn", reason: "unknown_wallet" };
}

/**
 * `true` iff the wallet is a known hardware wallet. Used for visual
 * indicator only — does not affect connect/sign decisions.
 */
export function isHardwareWallet(walletName: string | null | undefined): boolean {
  if (!walletName) return false;
  return HARDWARE_WALLET_NAMES.has(walletName);
}

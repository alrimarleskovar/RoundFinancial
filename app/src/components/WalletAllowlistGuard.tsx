"use client";

import { useEffect, useRef } from "react";

import { useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";

import { useNetwork } from "@/lib/network";
import { useI18n } from "@/lib/i18n";
import { isBlockedWallet } from "@/lib/walletAllowlist";

/**
 * Post-connect allowlist enforcement (Issue #249 W1 / frontend-security
 * checklist §2.5).
 *
 * `connect()` in `wallet.tsx` only gates the *auto-select* path (when no
 * wallet is selected yet). A wallet chosen through the WalletModal, or
 * auto-reconnected by `autoConnect`, sets `adapter.wallet` directly and
 * therefore bypasses that check. This guard re-validates AFTER the
 * adapter reports `connected` and force-disconnects a hard-blocked wallet
 * (mainnet + non-allowlisted), regardless of how it connected.
 *
 * On devnet/localnet `isBlockedWallet` is always `false`, so this guard
 * is inert there (it never disconnects a devnet test wallet).
 *
 * Mounted once inside `<WalletProvider>` (ClientProviders) so a single
 * instance owns the disconnect — no duplicate toasts.
 */
export function WalletAllowlistGuard() {
  const { connected, wallet, disconnect } = useAdapterWallet();
  const net = useNetwork();
  const { t } = useI18n();

  // Don't re-toast for the same blocked wallet on every render.
  const warnedFor = useRef<string | null>(null);

  useEffect(() => {
    const name = wallet?.adapter.name ?? null;
    if (!connected || !name) {
      warnedFor.current = null;
      return;
    }
    if (isBlockedWallet(name, net.id)) {
      void disconnect();
      if (warnedFor.current !== name) {
        warnedFor.current = name;
        toast.error(t("wallet.allowlist.blocked", { name }));
      }
    } else {
      warnedFor.current = null;
    }
  }, [connected, wallet, net.id, disconnect, t]);

  return null;
}

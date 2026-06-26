"use client";

import { useCallback, useMemo, type ReactNode } from "react";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import type { Adapter } from "@solana/wallet-adapter-base";
import { Toaster } from "sonner";

import { ConnectionsProvider } from "@/lib/connections";
import { MotionProvider } from "@/lib/motion";
import { NetworkContextProvider, useNetwork } from "@/lib/network";
import { SessionProvider } from "@/lib/session";
import { ThemeProvider } from "@/lib/theme";
import { I18nProvider } from "@/lib/i18n";
import { shouldAutoConnect } from "@/lib/walletAllowlist";
import { NetworkBanner } from "@/components/ui/NetworkBanner";
import { PhishingBanner } from "@/components/ui/PhishingBanner";
import { WalletAllowlistGuard } from "@/components/WalletAllowlistGuard";
import { WalletSessionGuard } from "@/components/WalletSessionGuard";

function InnerProviders({ children }: { children: ReactNode }) {
  const { endpoint, id: networkId } = useNetwork();
  // Standard-wallet discovery picks up Phantom / Solflare / Backpack
  // automatically when they're installed as browser extensions — no
  // adapter registration needed here.
  const wallets = useMemo<Adapter[]>(() => [], []);
  // autoConnect is gated through the wallet allowlist (checklist §2.5):
  // a previously approved wallet only auto-reconnects if it isn't a hard
  // `block` for the active network. On mainnet that refuses silent
  // reconnects of non-allowlisted wallets; on devnet/localnet it always
  // resolves true (warn-but-allow), preserving today's test-wallet UX.
  const autoConnect = useCallback(
    async (adapter: Adapter) => shouldAutoConnect(adapter.name, networkId),
    [networkId],
  );
  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect={autoConnect}>
        <WalletModalProvider>
          {/* Post-connect allowlist enforcement (#520) + session-lifecycle
              guard (#523): force-disconnect a modal/auto-reconnected
              non-allowlisted wallet, and disconnect on network-switch /
              mainnet idle / tab-close. */}
          <WalletAllowlistGuard />
          <WalletSessionGuard />
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider initial="neon">
      <MotionProvider initial="fade">
        <I18nProvider initialLang="pt" initialCurrency="BRL">
          <ConnectionsProvider>
            <SessionProvider>
              <NetworkContextProvider>
                <InnerProviders>
                  {/* Phishing-resistance banner (#249 W3) — renders at
                      top of every page when hostname is unknown. SSR-safe
                      (renders nothing during SSR; classifies post-hydration). */}
                  <PhishingBanner />
                  {/* Network identity banner (item 4.6 of MAINNET_READINESS)
                      — renders below PhishingBanner. Mitigates RPC-confusion:
                      flags devnet/localnet/unknown clusters so users can't be
                      phished into thinking devnet is mainnet via a malicious
                      RPC swap. Reads connection.rpcEndpoint as source of truth. */}
                  <NetworkBanner />
                  {children}
                </InnerProviders>
              </NetworkContextProvider>
            </SessionProvider>
          </ConnectionsProvider>
        </I18nProvider>
      </MotionProvider>
      {/* Sonner toast surface — bottom-right matches the wallet chip
          glow halo, stays out of the way of the bento dashboard top.
          richColors lets sonner use its themed success/error palette
          (we override per-call when needed via toast.custom). */}
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        theme="dark"
        toastOptions={{
          style: {
            background: "rgba(6,9,15,0.92)",
            border: "1px solid rgba(255,255,255,0.08)",
            backdropFilter: "blur(8px)",
            fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
          },
        }}
      />
    </ThemeProvider>
  );
}

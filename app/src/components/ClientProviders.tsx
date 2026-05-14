"use client";

import { useMemo, type ReactNode } from "react";

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
import { PhishingBanner } from "@/components/ui/PhishingBanner";

function InnerProviders({ children }: { children: ReactNode }) {
  const { endpoint } = useNetwork();
  // Standard-wallet discovery picks up Phantom / Solflare / Backpack
  // automatically when they're installed as browser extensions — no
  // adapter registration needed here.
  const wallets = useMemo<Adapter[]>(() => [], []);
  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
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

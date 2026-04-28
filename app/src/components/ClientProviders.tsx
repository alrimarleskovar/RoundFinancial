"use client";

import { useMemo, type ReactNode } from "react";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import type { Adapter } from "@solana/wallet-adapter-base";

import { ConnectionsProvider } from "@/lib/connections";
import { MotionProvider } from "@/lib/motion";
import { NetworkContextProvider, useNetwork } from "@/lib/network";
import { SessionProvider } from "@/lib/session";
import { ThemeProvider } from "@/lib/theme";
import { I18nProvider } from "@/lib/i18n";

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
                <InnerProviders>{children}</InnerProviders>
              </NetworkContextProvider>
            </SessionProvider>
          </ConnectionsProvider>
        </I18nProvider>
      </MotionProvider>
    </ThemeProvider>
  );
}

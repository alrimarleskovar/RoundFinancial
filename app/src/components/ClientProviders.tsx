"use client";

import { useMemo, type ReactNode } from "react";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import type { Adapter } from "@solana/wallet-adapter-base";

import { NetworkContextProvider, useNetwork } from "@/lib/network";

function InnerProviders({ children }: { children: ReactNode }) {
  const { endpoint } = useNetwork();
  // Standard-wallet discovery picks up Phantom / Solflare / Backpack
  // automatically when they're installed as browser extensions — no
  // adapter registration needed here.
  const wallets = useMemo<Adapter[]>(() => [], []);
  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <NetworkContextProvider>
      <InnerProviders>{children}</InnerProviders>
    </NetworkContextProvider>
  );
}

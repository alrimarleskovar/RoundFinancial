"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { resolveRpcAllowlist } from "./rpcAllowlist";

// SEV-045: `NetworkId` lives in `./networkTypes` (pure .ts, no JSX)
// so the workspace-root tsc + Mocha tests can import the type without
// pulling in React. Re-export here for back-compat with all existing
// call-sites that import from `@/lib/network`.
//
// The original (pre-SEV-045) union was `"localnet" | "devnet"`; the
// downstream `walletAllowlist` and `rpcAllowlist` paths were
// un-exercised for mainnet. Adding the `"mainnet-beta"` variant makes
// those allowlists load-bearing instead of guard-railing-for-future,
// and unblocks the ClusterBanner red-state on mainnet.
export type { NetworkId } from "./networkTypes";
import type { NetworkId } from "./networkTypes";

export interface NetworkOption {
  id: NetworkId;
  label: string;
  endpoint: string;
  canAirdrop: boolean;
  notes: string;
}

// Endpoints come from `resolveRpcAllowlist().primary` — the single source
// of truth in rpcAllowlist.ts — so the RPC allowlist is load-bearing for
// the actual ConnectionProvider endpoint, not just a future guard-rail
// (frontend-security checklist §2.2). The primary is always the canonical
// public RPC; keyed Helius/Triton stay read-only quorum members.
export const NETWORK_OPTIONS: Record<NetworkId, NetworkOption> = {
  localnet: {
    id: "localnet",
    label: "Localnet",
    endpoint: resolveRpcAllowlist("localnet").primary,
    canAirdrop: true,
    notes: "Requires `solana-test-validator` running locally with the three programs deployed.",
  },
  devnet: {
    id: "devnet",
    label: "Devnet",
    endpoint: resolveRpcAllowlist("devnet").primary,
    canAirdrop: true,
    notes: "Devnet airdrops are rate-limited; real mode here is best-effort.",
  },
  "mainnet-beta": {
    id: "mainnet-beta",
    label: "Mainnet",
    endpoint: resolveRpcAllowlist("mainnet-beta").primary,
    canAirdrop: false,
    notes:
      "REAL FUNDS. Every signed transaction moves real USDC. Triple-check before confirming any action.",
  },
};

interface NetworkContextValue {
  id: NetworkId;
  endpoint: string;
  canAirdrop: boolean;
  option: NetworkOption;
  setNetwork: (id: NetworkId) => void;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkContextProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<NetworkId>("devnet");
  const setNetwork = useCallback((next: NetworkId) => setId(next), []);
  const value = useMemo<NetworkContextValue>(() => {
    const option = NETWORK_OPTIONS[id];
    return {
      id,
      endpoint: option.endpoint,
      canAirdrop: option.canAirdrop,
      option,
      setNetwork,
    };
  }, [id, setNetwork]);
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
  const v = useContext(NetworkContext);
  if (!v) throw new Error("useNetwork() must be used within NetworkContextProvider");
  return v;
}

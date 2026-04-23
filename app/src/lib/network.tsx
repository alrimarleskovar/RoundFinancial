"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { clusterApiUrl } from "@solana/web3.js";

export type NetworkId = "localnet" | "devnet";

export interface NetworkOption {
  id: NetworkId;
  label: string;
  endpoint: string;
  canAirdrop: boolean;
  notes: string;
}

export const NETWORK_OPTIONS: Record<NetworkId, NetworkOption> = {
  localnet: {
    id: "localnet",
    label: "Localnet",
    endpoint: "http://127.0.0.1:8899",
    canAirdrop: true,
    notes:
      "Requires `solana-test-validator` running locally with the three programs deployed.",
  },
  devnet: {
    id: "devnet",
    label: "Devnet",
    endpoint: clusterApiUrl("devnet"),
    canAirdrop: true,
    notes:
      "Devnet airdrops are rate-limited; real mode here is best-effort.",
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
  const [id, setId] = useState<NetworkId>("localnet");
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

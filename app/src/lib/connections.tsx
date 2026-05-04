"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// Mock integrations runtime (everything except Phantom — Phantom uses
// useWallet() directly). Replaces the prototype's APP_STATE.connections
// + setConnection() pub/sub.

export type ConnId = "civic" | "kamino" | "solflare" | "pix";
export type ConnStatus = "connected" | "disconnected" | "pending";

export interface ConnRuntime {
  status: ConnStatus;
  since?: string; // e.g. "Mar 2026"
}

export type ConnectionsState = Record<ConnId, ConnRuntime>;

const DEFAULT_STATE: ConnectionsState = {
  civic: { status: "connected", since: "Mar 2026" },
  kamino: { status: "connected", since: "Jan 2026" },
  solflare: { status: "disconnected" },
  pix: { status: "pending" },
};

interface ConnectionsContextValue {
  state: ConnectionsState;
  connect: (id: ConnId, since?: string) => void;
  disconnect: (id: ConnId) => void;
  setStatus: (id: ConnId, status: ConnStatus, since?: string) => void;
}

const ConnectionsContext = createContext<ConnectionsContextValue | null>(null);

export function ConnectionsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnectionsState>(DEFAULT_STATE);

  const setStatus = useCallback((id: ConnId, status: ConnStatus, since?: string) => {
    setState((prev) => ({
      ...prev,
      [id]: { ...prev[id], status, ...(since != null ? { since } : {}) },
    }));
  }, []);

  const connect = useCallback(
    (id: ConnId, since?: string) => setStatus(id, "connected", since),
    [setStatus],
  );

  const disconnect = useCallback((id: ConnId) => setStatus(id, "disconnected"), [setStatus]);

  const value = useMemo(
    () => ({ state, connect, disconnect, setStatus }),
    [state, connect, disconnect, setStatus],
  );

  return <ConnectionsContext.Provider value={value}>{children}</ConnectionsContext.Provider>;
}

export function useConnections(): ConnectionsContextValue {
  const v = useContext(ConnectionsContext);
  if (!v) throw new Error("useConnections() must be used within <ConnectionsProvider>");
  return v;
}

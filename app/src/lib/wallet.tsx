"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

import { useNetwork } from "@/lib/network";

// RoundFi wallet hook — wraps @solana/wallet-adapter-react to give screens
// the same shape as the prototype's useWallet(). Covers connect/disconnect,
// balance, and devnet SOL airdrops.

export type WalletStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface WalletView {
  status: WalletStatus;
  publicKey: string | null;
  balance: number | null; // lamports
  balanceSol: number | null;
  network: "devnet" | "localnet";
  lastError: string | null;
  lastTxSig: string | null;
  airdropping: boolean;
  isInstalled: boolean;
  walletLabel: string | null;
  connect: () => Promise<{ ok: boolean; reason?: string }>;
  disconnect: () => Promise<{ ok: boolean }>;
  airdrop: (lamports?: number) => Promise<{ ok: boolean; signature?: string; reason?: string }>;
  refresh: () => Promise<void>;
  explorerTx: (sig: string) => string;
  explorerAddr: (addr: string) => string;
}

const AIRDROP_DEFAULT = LAMPORTS_PER_SOL; // 1 SOL

function explorerCluster(id: "devnet" | "localnet"): string {
  // Solana Explorer supports ?cluster=devnet / ?cluster=custom for local
  return id === "localnet" ? "custom" : "devnet";
}

export function useWallet(): WalletView {
  const adapter = useAdapterWallet();
  const { connection } = useConnection();
  const net = useNetwork();

  const [balance, setBalance] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastTxSig, setLastTxSig] = useState<string | null>(null);
  const [airdropping, setAirdropping] = useState(false);

  const status: WalletStatus = adapter.connecting
    ? "connecting"
    : adapter.connected
    ? "connected"
    : lastError
    ? "error"
    : "disconnected";

  const publicKey = adapter.publicKey ? adapter.publicKey.toBase58() : null;
  const walletLabel = adapter.wallet?.adapter.name ?? null;
  const isInstalled = adapter.wallets.some((w) => w.readyState === "Installed");

  // Track the current pubkey in a ref so async calls don't see stale state.
  const pkRef = useRef<string | null>(null);
  useEffect(() => {
    pkRef.current = publicKey;
  }, [publicKey]);

  const refresh = useCallback(async () => {
    const pk = pkRef.current;
    if (!pk) {
      setBalance(null);
      return;
    }
    try {
      const lamports = await connection.getBalance(new PublicKey(pk), "confirmed");
      setBalance(lamports);
    } catch (err: unknown) {
      setLastError(`balance_fetch_failed: ${(err as Error)?.message ?? err}`);
    }
  }, [connection]);

  // Refresh balance when pubkey flips on or the network endpoint changes.
  useEffect(() => {
    if (adapter.connected && publicKey) {
      refresh();
    } else {
      setBalance(null);
    }
  }, [adapter.connected, publicKey, refresh, net.endpoint]);

  const connect = useCallback(async (): Promise<{ ok: boolean; reason?: string }> => {
    if (!adapter.wallet) {
      // No wallet selected yet — try picking the first installed one.
      const installed = adapter.wallets.find((w) => w.readyState === "Installed");
      if (!installed) {
        setLastError("phantom_not_installed");
        return { ok: false, reason: "phantom_not_installed" };
      }
      adapter.select(installed.adapter.name);
      // select() is sync; connecting happens via autoConnect or next call.
    }
    try {
      setLastError(null);
      await adapter.connect();
      return { ok: true };
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string };
      const reason =
        e?.code === 4001 ? "user_rejected" : e?.message ?? "connect_failed";
      setLastError(reason);
      return { ok: false, reason };
    }
  }, [adapter]);

  const disconnect = useCallback(async (): Promise<{ ok: boolean }> => {
    try {
      await adapter.disconnect();
    } catch {
      // Ignore — disconnect failures shouldn't block UI.
    }
    setLastError(null);
    setBalance(null);
    return { ok: true };
  }, [adapter]);

  const airdrop = useCallback(
    async (lamports: number = AIRDROP_DEFAULT) => {
      const pk = pkRef.current;
      if (!pk) return { ok: false as const, reason: "not_connected" };
      setAirdropping(true);
      setLastError(null);
      try {
        const sig = await connection.requestAirdrop(new PublicKey(pk), lamports);
        await connection.confirmTransaction(sig, "confirmed");
        setLastTxSig(sig);
        setAirdropping(false);
        refresh();
        return { ok: true as const, signature: sig };
      } catch (err: unknown) {
        const msg = (err as Error)?.message ?? String(err);
        const reason = /429|rate.?limit|too many/i.test(msg)
          ? "rate_limited"
          : /airdrop.*limit/i.test(msg)
          ? "airdrop_limit"
          : msg;
        setLastError(reason);
        setAirdropping(false);
        return { ok: false as const, reason };
      }
    },
    [connection, refresh],
  );

  const explorerTx = useCallback(
    (sig: string) =>
      `https://explorer.solana.com/tx/${sig}?cluster=${explorerCluster(net.id)}`,
    [net.id],
  );
  const explorerAddr = useCallback(
    (addr: string) =>
      `https://explorer.solana.com/address/${addr}?cluster=${explorerCluster(net.id)}`,
    [net.id],
  );

  return useMemo<WalletView>(
    () => ({
      status,
      publicKey,
      balance,
      balanceSol: balance == null ? null : balance / LAMPORTS_PER_SOL,
      network: net.id,
      lastError,
      lastTxSig,
      airdropping,
      isInstalled,
      walletLabel,
      connect,
      disconnect,
      airdrop,
      refresh,
      explorerTx,
      explorerAddr,
    }),
    [
      status,
      publicKey,
      balance,
      net.id,
      lastError,
      lastTxSig,
      airdropping,
      isInstalled,
      walletLabel,
      connect,
      disconnect,
      airdrop,
      refresh,
      explorerTx,
      explorerAddr,
    ],
  );
}

// Short address like "4xRf…KpQ2" — matches prototype helper.
export function shortAddr(addr: string | null | undefined, left = 4, right = 4): string {
  if (!addr) return "";
  if (addr.length <= left + right + 1) return addr;
  return `${addr.slice(0, left)}…${addr.slice(-right)}`;
}

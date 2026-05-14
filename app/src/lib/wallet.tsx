"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

import { useNetwork } from "@/lib/network";
import { decideWalletAllowlist, isHardwareWallet } from "@/lib/walletAllowlist";

// RoundFi wallet hook — wraps @solana/wallet-adapter-react to give screens
// the same shape as the prototype's useWallet(). Covers connect/disconnect,
// balance, and devnet SOL airdrops.

export type WalletStatus = "disconnected" | "connecting" | "connected" | "error";

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
  /** `true` iff the connected wallet is a known hardware wallet
   *  (Ledger, Trezor). UI surfaces a "🔒 Hardware" badge for these.
   *  Source-of-truth: `walletAllowlist.ts`. */
  isHardware: boolean;
  /** `true` iff the connected wallet is NOT on the curated allowlist.
   *  On devnet this is a soft warning (banner). On mainnet the connect
   *  would have been blocked before we got here. Issue #249 workstream 1. */
  isUnknownWallet: boolean;
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
      // Balance polling failures (rate-limited RPC, extension hijacks
      // the fetch, transient network blips) shouldn't surface as a
      // wallet-error toast — they're not actionable and the airdrop
      // / wallet UI works fine without a balance number.
      // eslint-disable-next-line no-console
      console.warn("[RoundFi] balance fetch failed:", err);
      setBalance(null);
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
      // Issue #249 workstream 1: filter through the wallet allowlist
      // before auto-selecting. On mainnet, non-allowlisted wallets are
      // blocked outright; on devnet they're warned (but we still prefer
      // an allowlisted one when one is available).
      const installedAllowlisted = adapter.wallets.find(
        (w) =>
          w.readyState === "Installed" &&
          decideWalletAllowlist(w.adapter.name, net.id).kind === "allowed",
      );
      const installedAny = adapter.wallets.find((w) => w.readyState === "Installed");

      const chosen = installedAllowlisted ?? installedAny;
      if (!chosen) {
        setLastError("phantom_not_installed");
        return { ok: false, reason: "phantom_not_installed" };
      }

      // If we fell back to a non-allowlisted wallet on mainnet, refuse
      // the connect with a typed reason the UI can surface clearly.
      const decision = decideWalletAllowlist(chosen.adapter.name, net.id);
      if (decision.kind === "block") {
        setLastError(decision.reason);
        return { ok: false, reason: decision.reason };
      }

      adapter.select(chosen.adapter.name);
      // select() is sync; connecting happens via autoConnect or next call.
    }
    try {
      setLastError(null);
      await adapter.connect();
      return { ok: true };
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string };
      const reason = e?.code === 4001 ? "user_rejected" : (e?.message ?? "connect_failed");
      setLastError(reason);
      return { ok: false, reason };
    }
  }, [adapter, net.id]);

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
        // Surface the raw error to DevTools so users can copy the
        // exact reason (devnet airdrops fail for a dozen reasons —
        // the categorized banner can't cover them all).
        // eslint-disable-next-line no-console
        console.error("[RoundFi] airdrop failed:", err);
        const msg = (err as Error)?.message ?? String(err);
        const reason = /429|rate.?limit|too many/i.test(msg)
          ? "rate_limited"
          : /airdrop.*limit|faucet.*has.*run.*dry/i.test(msg)
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
    (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=${explorerCluster(net.id)}`,
    [net.id],
  );
  const explorerAddr = useCallback(
    (addr: string) =>
      `https://explorer.solana.com/address/${addr}?cluster=${explorerCluster(net.id)}`,
    [net.id],
  );

  // Derived allowlist signals — refreshed whenever the wallet selection
  // changes. These drive the "🔒 Hardware" / "⚠ Unknown wallet" badges
  // in WalletChip + warning banners around sign actions.
  const isHardware = isHardwareWallet(walletLabel);
  const isUnknownWallet =
    walletLabel != null && decideWalletAllowlist(walletLabel, net.id).kind !== "allowed";

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
      isHardware,
      isUnknownWallet,
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
      isHardware,
      isUnknownWallet,
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

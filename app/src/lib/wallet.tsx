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
  network: "devnet" | "localnet" | "mainnet-beta";
  lastError: string | null;
  lastTxSig: string | null;
  /** Amounts moved by the last successful faucet drip (whole units). The
   *  faucet tops up ONLY what's missing, so a wallet that already holds SOL
   *  gets `{ sol: 0, usdc: 6 }` — the UI shows exactly what was sent so a
   *  USDC-only top-up doesn't read as "broken / wrong faucet". null until the
   *  first successful drip. */
  lastDrip: { sol: number; usdc: number } | null;
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
  /** ed25519 message signer, when the connected wallet supports it
   *  (MessageSignerWalletAdapter). null otherwise. Used by the admin
   *  console's SIWS sign-in (ADR 0009). */
  signMessage: ((message: Uint8Array) => Promise<Uint8Array>) | null;
  airdrop: (lamports?: number) => Promise<{ ok: boolean; signature?: string; reason?: string }>;
  refresh: () => Promise<void>;
  explorerTx: (sig: string) => string;
  explorerAddr: (addr: string) => string;
}

function explorerCluster(id: "devnet" | "localnet" | "mainnet-beta"): string {
  // Solana Explorer cluster query values:
  //   ?cluster=mainnet-beta (default if omitted)
  //   ?cluster=devnet
  //   ?cluster=custom (for localnet — pairs with `customUrl=http://...`)
  if (id === "localnet") return "custom";
  if (id === "mainnet-beta") return "mainnet-beta";
  return "devnet";
}

export function useWallet(): WalletView {
  const adapter = useAdapterWallet();
  const { connection } = useConnection();
  const net = useNetwork();

  const [balance, setBalance] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastTxSig, setLastTxSig] = useState<string | null>(null);
  const [lastDrip, setLastDrip] = useState<{ sol: number; usdc: number } | null>(null);
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

  // Airdrop SOL via the server-side faucet route (/api/faucet) instead of
  // connection.requestAirdrop(): the public devnet RPC rate-limits the
  // native airdrop method hard (429 on the first try), so we transfer from
  // a team-funded keypair server-side. Same return shape + the server's
  // reasons are mapped onto the UI's existing vocabulary so PhantomFaucet
  // renders the right banner / fallback links.
  const airdrop = useCallback(async () => {
    const pk = pkRef.current;
    if (!pk) return { ok: false as const, reason: "not_connected" };
    setAirdropping(true);
    setLastError(null);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: pk }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        signature?: string;
        reason?: string;
        sol?: number;
        usdc?: number;
      };
      if (res.ok && data.ok && data.signature) {
        setLastTxSig(data.signature);
        // Record what actually moved so PhantomFaucet can show "1 SOL + 6 USDC"
        // vs "6 USDC (you already had SOL)" — the faucet only tops up what's
        // missing, and a silent USDC-only drip looked like a broken faucet.
        setLastDrip({ sol: data.sol ?? 0, usdc: data.usdc ?? 0 });
        setAirdropping(false);
        refresh();
        return { ok: true as const, signature: data.signature };
      }
      // Map server reasons onto the categorized banners PhantomFaucet
      // already renders (rate_limited → "try a hosted faucet", etc.).
      const reason =
        data.reason === "cooldown"
          ? "rate_limited"
          : data.reason === "faucet_drained" || data.reason === "faucet_unconfigured"
            ? "airdrop_limit"
            : (data.reason ?? "airdrop_failed");
      setLastError(reason);
      setAirdropping(false);
      return { ok: false as const, reason };
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error("[RoundFi] faucet request failed:", err);
      setLastError("airdrop_failed");
      setAirdropping(false);
      return { ok: false as const, reason: "airdrop_failed" };
    }
  }, [refresh]);

  // Message signer — present only when the selected wallet implements
  // MessageSignerWalletAdapter (Phantom/Solflare/Backpack do). Wrapped so
  // the view exposes a stable `null` when unsupported.
  const adapterSignMessage = adapter.signMessage;
  const signMessage = useMemo<((message: Uint8Array) => Promise<Uint8Array>) | null>(
    () => (adapterSignMessage ? (message) => adapterSignMessage(message) : null),
    [adapterSignMessage],
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
      lastDrip,
      airdropping,
      isInstalled,
      walletLabel,
      isHardware,
      isUnknownWallet,
      connect,
      disconnect,
      signMessage,
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
      lastDrip,
      airdropping,
      isInstalled,
      walletLabel,
      isHardware,
      isUnknownWallet,
      connect,
      disconnect,
      signMessage,
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

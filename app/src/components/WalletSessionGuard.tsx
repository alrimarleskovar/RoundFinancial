"use client";

import { useEffect, useRef } from "react";

import { useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";

import { useNetwork } from "@/lib/network";

// §2.5 — auto-disconnect after this much idle time on mainnet.
const IDLE_DISCONNECT_MS = 15 * 60 * 1000;

/**
 * Wallet session-lifecycle guard (frontend-security checklist §2.1 / §2.5).
 * Mounted once inside <WalletProvider>. Three independent protections:
 *
 *  1. Network switch → disconnect. Switching cluster swaps the RPC
 *     endpoint under the wallet; carrying a live connection across (esp.
 *     devnet → mainnet) risks signing against the wrong network. Force a
 *     fresh, explicit reconnect on the new cluster.
 *  2. Idle timeout (mainnet only) → disconnect after 15 min of no user
 *     input, so an unattended tab can't keep a hot mainnet session open.
 *     Devnet/localnet are exempt to avoid disrupting the test loop.
 *  3. Tab close / refresh (beforeunload) → best-effort disconnect.
 */
export function WalletSessionGuard() {
  const { connected, disconnect } = useAdapterWallet();
  const net = useNetwork();

  // 1) Disconnect on network change (skips the initial render).
  const prevNet = useRef(net.id);
  useEffect(() => {
    if (prevNet.current !== net.id) {
      prevNet.current = net.id;
      if (connected) void disconnect();
    }
  }, [net.id, connected, disconnect]);

  // 2) Idle-timeout disconnect — mainnet only.
  useEffect(() => {
    if (!connected || net.id !== "mainnet-beta") return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void disconnect(), IDLE_DISCONNECT_MS);
    };
    const activity = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;
    activity.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      clearTimeout(timer);
      activity.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [connected, net.id, disconnect]);

  // 3) Disconnect on tab close / refresh.
  useEffect(() => {
    if (!connected) return;
    const onUnload = () => {
      void disconnect();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [connected, disconnect]);

  return null;
}

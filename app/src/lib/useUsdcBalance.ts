"use client";

// useUsdcBalance() — reads the connected wallet's devnet USDC balance from
// its associated token account (ATA of DEVNET_USDC_MINT). USDC is 6 decimals.
//
// A fresh wallet has no ATA yet → getAccount throws TokenAccountNotFoundError
// → we report 0, which is the correct empty-state (not an error). Any other
// failure (RPC blip) yields status:"fallback" / uiAmount:null so callers can
// render "—" rather than a misleading zero.

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { DEVNET_USDC_MINT } from "./devnet";

export type UseUsdcBalanceStatus = "loading" | "ok" | "fallback";

export interface UseUsdcBalanceResult {
  status: UseUsdcBalanceStatus;
  /** Balance in USDC (6-decimal scaling applied). null while loading / on RPC failure. */
  uiAmount: number | null;
  refresh: () => Promise<void>;
}

const USDC_DECIMALS = 6;

export function useUsdcBalance(refreshMs = 30_000): UseUsdcBalanceResult {
  const { connection } = useConnection();
  const { publicKey } = useAdapterWallet();
  const [state, setState] = useState<{ status: UseUsdcBalanceStatus; uiAmount: number | null }>({
    status: "loading",
    uiAmount: null,
  });
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    if (!publicKey) {
      setState({ status: "ok", uiAmount: null });
      return;
    }
    try {
      const ata = getAssociatedTokenAddressSync(DEVNET_USDC_MINT, publicKey);
      const account = await getAccount(connection, ata, "confirmed");
      if (cancelledRef.current) return;
      setState({ status: "ok", uiAmount: Number(account.amount) / 10 ** USDC_DECIMALS });
    } catch (err) {
      if (cancelledRef.current) return;
      // A missing ATA (fresh wallet) is the COMMON case → balance is 0, not
      // an error. Other failures (RPC down) → fallback/null.
      const name = err instanceof Error ? err.name : "";
      if (name === "TokenAccountNotFoundError" || name === "TokenInvalidAccountOwnerError") {
        setState({ status: "ok", uiAmount: 0 });
      } else {
        setState({ status: "fallback", uiAmount: null });
      }
    }
  }, [connection, publicKey]);

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    const id = window.setInterval(load, refreshMs);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, [load, refreshMs]);

  return { ...state, refresh: load };
}

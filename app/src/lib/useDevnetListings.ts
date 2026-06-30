"use client";

/**
 * `useDevnetListings()` — the REAL secondary market: every active
 * escape-valve `Listing` on chain, mapped to the same `MarketOffer` shape
 * the /mercado buy side renders. Replaces the empty real-mode market (the
 * pitch fixtures only show in demo) with genuine on-chain cotas for sale.
 *
 * Strategy: for each deployed pool, `fetchActivePoolListings` enumerates its
 * active Listing accounts (getProgramAccounts, dataSize + pool memcmp), and
 * one `fetchPoolRaw` gives the pool's `creditAmount` (the cota's face value).
 * Prices are stored on chain in USDC base units; we scale to the BRL preview
 * basis the rest of the UI uses (`× USDC_RATE`, same as SellShareModal). Names
 * come from the catalog so the rows read consistently with the cards.
 *
 * `enabled` gates the scan to real (non-demo) mode so demo sessions never pay
 * the getProgramAccounts cost. Read-only convenience: an RPC hiccup falls back
 * to the last-known offers instead of throwing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";

import { fetchActivePoolListings, fetchPoolRaw } from "@roundfi/sdk/onchain-raw";

import type { MarketOffer } from "@/data/market";
import { DISCOVER_GROUPS } from "@/data/groups";
import { DEVNET_POOLS, DEVNET_PROGRAM_IDS, type DevnetPoolKey } from "@/lib/devnet";
import { USDC_RATE } from "@/lib/i18n";

// Pool display name by devnet pool key, from the same catalogs the cards use.
const POOL_NAME: Partial<Record<DevnetPoolKey, string>> = (() => {
  const out: Partial<Record<DevnetPoolKey, string>> = {};
  // Real catalog only — never the demo fixtures, so a real listing never shows
  // a pitch name (pool3's "Renovação MEI"); unknown pools fall back to "Pool N".
  for (const d of DISCOVER_GROUPS)
    if (d.devnetPool && !out[d.devnetPool]) out[d.devnetPool] = d.name;
  return out;
})();

export interface UseDevnetListingsResult {
  status: "loading" | "ok" | "fallback";
  offers: MarketOffer[];
  refresh: () => Promise<void>;
}

export function useDevnetListings(enabled: boolean, refreshMs = 45_000): UseDevnetListingsResult {
  const { connection } = useConnection();
  const [state, setState] = useState<{
    status: UseDevnetListingsResult["status"];
    offers: MarketOffer[];
  }>({ status: "loading", offers: [] });
  const cancelled = useRef(false);

  const load = useCallback(async () => {
    if (!enabled) {
      setState({ status: "ok", offers: [] });
      return;
    }
    try {
      const keys = Object.keys(DEVNET_POOLS) as DevnetPoolKey[];
      const perPool = await Promise.all(
        keys.map(async (key) => {
          const poolPda = DEVNET_POOLS[key].pda;
          const listings = await fetchActivePoolListings(
            connection,
            DEVNET_PROGRAM_IDS.core,
            poolPda,
          );
          if (listings.length === 0) return [];
          // creditAmount = the cota's face value (what the contemplated member
          // receives), in USDC base units → BRL preview basis.
          const pool = await fetchPoolRaw(connection, poolPda);
          const faceBrl = pool ? (Number(pool.creditAmount) / 1e6) * USDC_RATE : 0;
          const total = pool ? pool.membersTarget : 0;
          const month = pool ? pool.currentCycle + 1 : 0;
          const name = POOL_NAME[key] ?? `Pool ${key.replace("pool", "")}`;
          return listings.map((l): MarketOffer => {
            const priceBrl = (Number(l.priceUsdc) / 1e6) * USDC_RATE;
            const disc = faceBrl > 0 ? Math.max(0, ((faceBrl - priceBrl) / faceBrl) * 100) : 0;
            return {
              id: l.address.toBase58(),
              num: String(l.slotIndex + 1).padStart(2, "0"),
              group: name,
              month,
              total,
              face: Math.round(faceBrl),
              price: Math.round(priceBrl),
              disc: Number(disc.toFixed(1)),
              // Carries what escape_valve_buy needs (the seller + NFT asset are
              // resolved on-chain at buy time); marks the row as a real buy.
              onchain: { poolKey: key, slotIndex: l.slotIndex, priceUsdc: l.priceUsdc.toString() },
            };
          });
        }),
      );
      if (cancelled.current) return;
      const offers = perPool.flat().sort((a, b) => b.disc - a.disc);
      setState({ status: "ok", offers });
    } catch {
      // RPC hiccup / rate-limit — keep the last-known offers; never throw, the
      // market is a read-only convenience.
      if (cancelled.current) return;
      setState((prev) => ({ status: "fallback", offers: prev.offers }));
    }
  }, [connection, enabled]);

  useEffect(() => {
    cancelled.current = false;
    void load();
    const id = window.setInterval(load, refreshMs);
    return () => {
      cancelled.current = true;
      window.clearInterval(id);
    };
  }, [load, refreshMs]);

  return { ...state, refresh: load };
}

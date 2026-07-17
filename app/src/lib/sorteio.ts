"use client";

/**
 * Sorteio ordering helpers (ADR pool_v2) — the ONE place the front-end
 * translates between a member's seat (`slot_index`, permanent identity)
 * and the cycle they receive in.
 *
 * ArrivalOrder pools (`ordering_policy == 0`, every pool before pool8):
 * seat == cycle, the identity translation — nothing changes for them.
 *
 * Sorteio pools (`ordering_policy == 1`): the payout order lives in the
 * DrawResult PDA (`order[seat] = cycle`), minted exactly once by the
 * permissionless `finalize_draw` when the pool fills. Until it exists,
 * NOBODY is contemplated — payouts are fail-closed on-chain
 * (`DrawRequired`) and every helper here returns null so the UI shows
 * "aguardando sorteio" instead of wrongly pointing at seat 0 (the
 * arrival-order assumption would do exactly that).
 *
 * Consumers: grupos GroupCard (Receber / Processar gating + the
 * "Sortear ordem" CTA), Claim/Crank/PayInstallment modals, usePoolRadar.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import {
  ORDERING_POLICY,
  drawResultPda,
  fetchDrawRaw,
  type RawDrawView,
  type RawPoolView,
} from "@roundfi/sdk";

import { DEVNET_POOLS, DEVNET_PROGRAM_IDS, type DevnetPoolKey } from "./devnet";
import { cacheGet, cacheSet } from "./poolCache";

/** True when the pool assigns payout order by on-chain draw (pool8+). */
export function isSorteioPool(pool: RawPoolView | null | undefined): boolean {
  return pool?.orderingPolicy === ORDERING_POLICY.Sorteio;
}

/**
 * The seat contemplated in `cycle`, or null when that isn't knowable:
 * a sorteio pool whose draw hasn't been finalized has NO contemplated
 * seat (mirrors the on-chain `DrawRequired` gate — never fall back to
 * the arrival-order guess).
 */
export function contemplatedSlotForCycle(
  pool: RawPoolView,
  draw: RawDrawView | null,
  cycle: number,
): number | null {
  if (!isSorteioPool(pool)) return cycle; // arrival order: seat == cycle
  if (!draw) return null;
  const seat = draw.order.findIndex((c) => c === cycle);
  return seat >= 0 ? seat : null;
}

/** The cycle a seat receives in (`order[seat]`); null pre-draw on sorteio. */
export function drawnCycleForSlot(
  pool: RawPoolView,
  draw: RawDrawView | null,
  slotIndex: number,
): number | null {
  if (!isSorteioPool(pool)) return slotIndex;
  if (!draw) return null;
  return draw.order[slotIndex] ?? null;
}

/**
 * Friendly classification for the sorteio fail-closed revert: the raw
 * Anchor log carries the error name, so a payout fired against an
 * undrawn pool (stale UI, race with the draw) matches here.
 */
export function isDrawRequiredError(blob: string): boolean {
  return /DrawRequired/i.test(blob);
}

export type UseDrawStatus = "idle" | "loading" | "ok";

export interface UseDrawResult {
  /** null while loading, on RPC failure, or before finalize_draw ran. */
  draw: RawDrawView | null;
  /** The pool's DrawResult PDA — pass to the payout encoders (sorteio only). */
  drawPda: PublicKey | null;
  status: UseDrawStatus;
  refresh: () => Promise<void>;
}

/**
 * Poll a devnet pool's DrawResult. Fetches ONLY when the pool is a
 * sorteio pool (`enabled` gate) — ArrivalOrder pools never pay the RPC
 * read and get `{draw: null, status: "idle"}`, which the pure helpers
 * above treat as the identity translation.
 */
export function useDraw(
  seedKey: DevnetPoolKey | null | undefined,
  pool: RawPoolView | null,
  refreshMs = 30_000,
): UseDrawResult {
  const { connection } = useConnection();
  const enabled = !!seedKey && isSorteioPool(pool);
  const [state, setState] = useState<{ draw: RawDrawView | null; status: UseDrawStatus }>({
    draw: null,
    status: "idle",
  });
  const cancelledRef = useRef(false);

  const drawPda = seedKey
    ? drawResultPda(DEVNET_PROGRAM_IDS.core, DEVNET_POOLS[seedKey].pda)[0]
    : null;

  const load = useCallback(async () => {
    if (!enabled || !seedKey) return;
    try {
      const view = await fetchDrawRaw(
        connection,
        DEVNET_PROGRAM_IDS.core,
        DEVNET_POOLS[seedKey].pda,
      );
      if (cancelledRef.current) return;
      // A minted DrawResult is IMMUTABLE (single-shot PDA) — the ideal cache
      // entry. draw=null (undrawn) is deliberately NOT cached: it flips once.
      if (view) cacheSet("draw", `${seedKey}:${DEVNET_POOLS[seedKey].pda.toBase58()}`, view);
      setState({ draw: view, status: "ok" });
    } catch {
      if (cancelledRef.current) return;
      // RPC hiccup — keep whatever we had; "ok" with draw=null reads as
      // "awaiting draw", which is the safe (fail-closed) presentation.
      setState((prev) => ({ draw: prev.draw, status: "ok" }));
    }
  }, [connection, seedKey, enabled]);

  useEffect(() => {
    if (!enabled) {
      setState({ draw: null, status: "idle" });
      return;
    }
    cancelledRef.current = false;
    // Stale-while-revalidate: the drawn order paints instantly (the "você
    // recebe no ciclo N" chip), then load() re-reads the immutable account.
    setState((prev) => {
      if (prev.draw) return prev;
      const cached = seedKey
        ? cacheGet<RawDrawView>("draw", `${seedKey}:${DEVNET_POOLS[seedKey].pda.toBase58()}`)
        : null;
      if (cached) return { draw: cached, status: "ok" };
      return prev.status === "idle" ? { ...prev, status: "loading" } : prev;
    });
    void load();
    const id = window.setInterval(load, refreshMs);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, [load, refreshMs, enabled, seedKey]);

  return { ...state, drawPda, refresh: load };
}

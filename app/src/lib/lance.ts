/**
 * Lance embutido — the pure arithmetic behind the "Dar lance" UI
 * (ADR 0012 Fase 2, `programs/roundfi-core/src/instructions/place_embedded_bid.rs`).
 *
 * Kept dependency-free (no React, no web3 objects) for two reasons:
 *   1. it unit-tests without a chain (`tests/lance_ui.spec.ts`), and
 *   2. the numbers it produces are the SAME numbers the program gates on,
 *      so the UI can promise "this bid will land" instead of discovering
 *      the revert after the wallet signs.
 *
 * The one metric that matters is DEPTH:
 *
 *     depth = contributions_paid − current_cycle − 1
 *
 * i.e. installments prepaid BEYOND the one currently due. The `−1` is
 * load-bearing: `contributions_paid == current_cycle + 1` is just the
 * normal "paid this cycle" state, so counting it would let any merely
 * up-to-date member take the cycle with a zero bid. Winning requires a
 * STRICTLY deeper bid than the one standing (`pool.current_bid_depth`),
 * so the depth to beat is always `current_bid_depth + 1` — which is ≥ 1
 * even on a fresh cycle, exactly matching the on-chain `depth >= 1` gate.
 */

/** Raw inputs — every one of these is read from chain by the caller. */
export interface LanceInputs {
  /** `pool.ordering_policy == Sorteio`. Arrival pools have no draw to swap. */
  isSorteio: boolean;
  /** `pool.status == Active`. */
  poolActive: boolean;
  currentCycle: number;
  cyclesTotal: number;
  /** `pool.current_bid_depth` — best bid standing for the current cycle. */
  currentBidDepth: number;
  /** `DrawResult.order[my_seat]`; null while the draw hasn't been minted. */
  myDrawnCycle: number | null;
  /** `member.contributions_paid`; null when the wallet isn't a member. */
  contributionsPaid: number | null;
  defaulted: boolean;
  paidOut: boolean;
}

export type LanceStatus =
  /** Arrival-order pool, inactive pool, non-member or defaulted member —
   *  the lance simply doesn't apply. */
  | "notApplicable"
  /** Sorteio pool whose DrawResult hasn't been minted yet: there is no
   *  order to swap, and the on-chain account doesn't even exist. */
  | "awaitingDraw"
  /** Already received (paid_out), or the current cycle is ALREADY theirs
   *  — nothing left to bid for. */
  | "contemplated"
  /** Eligible, but even prepaying every remaining installment can't reach
   *  the depth needed to beat the standing bid. */
  | "outOfRunway"
  /** Eligible; needs `prepaysNeeded` more prepaid installments first. */
  | "needsPrepay"
  /** The bid would land right now. */
  | "ready";

export interface LanceView {
  status: LanceStatus;
  /** The member's current bid depth (0 when merely up to date). */
  depth: number;
  /** The depth standing for this cycle (`pool.current_bid_depth`). */
  bestDepth: number;
  /** Depth required to WIN right now = bestDepth + 1 (never below 1). */
  requiredDepth: number;
  /** Installments still to prepay to reach `requiredDepth` (0 when ready). */
  prepaysNeeded: number;
  /** The deepest bid this member could ever reach in this cycle. */
  maxDepth: number;
  /** The cycle they'd take by winning (the pool's current cycle). */
  targetCycle: number;
  /** The cycle they hold today (null pre-draw). */
  myCycle: number | null;
}

/**
 * Classify a member's lance position. Never throws; every impossible
 * combination degrades to `notApplicable`, which the UI renders as
 * "no panel" rather than a wrong affordance.
 */
export function lanceView(input: LanceInputs): LanceView {
  const bestDepth = Math.max(0, input.currentBidDepth);
  // Beat-the-book: strictly deeper than what stands. On a fresh cycle
  // (bestDepth 0) this is 1 — the program's own floor.
  const requiredDepth = bestDepth + 1;
  const depth =
    input.contributionsPaid === null
      ? 0
      : Math.max(0, input.contributionsPaid - input.currentCycle - 1);
  // Paying every installment left tops out at contributions_paid ==
  // cycles_total (contribute requires `cycle < cycles_total`).
  const maxDepth = Math.max(0, input.cyclesTotal - input.currentCycle - 1);
  const prepaysNeeded = Math.max(0, requiredDepth - depth);

  const base = {
    depth,
    bestDepth,
    requiredDepth,
    prepaysNeeded,
    maxDepth,
    targetCycle: input.currentCycle,
    myCycle: input.myDrawnCycle,
  };

  if (
    !input.isSorteio ||
    !input.poolActive ||
    input.contributionsPaid === null ||
    input.defaulted
  ) {
    return { ...base, status: "notApplicable" };
  }
  // paid_out is the gate that keeps a contemplated member from swapping
  // back in for a SECOND payout — mirror it before anything else.
  if (input.paidOut) return { ...base, status: "contemplated" };
  if (input.myDrawnCycle === null) return { ...base, status: "awaitingDraw" };
  // Their turn is now (or already passed): nothing to bring forward.
  if (input.myDrawnCycle <= input.currentCycle) return { ...base, status: "contemplated" };
  if (requiredDepth > maxDepth) return { ...base, status: "outOfRunway" };
  if (prepaysNeeded > 0) return { ...base, status: "needsPrepay" };
  return { ...base, status: "ready" };
}

/** The three statuses that put the "Dar lance" panel on screen. */
export function showsLancePanel(status: LanceStatus): boolean {
  return status === "ready" || status === "needsPrepay" || status === "outOfRunway";
}

/**
 * Map a failed `place_embedded_bid` revert to a user-facing i18n key.
 *
 * Same contract as `classifyEscapeValveListError`: pure, string-only,
 * returns null for an unrecognized revert so the caller falls back to
 * the distilled reason instead of a blank.
 *
 * The interesting case is `EmbeddedBidTooShallow`: it means someone
 * outbid you between the simulation and the signature — a live auction
 * loss, not a bug, and the copy has to say so.
 */
export function classifyLanceError(errorText: string): string | null {
  const s = errorText;
  if (/EmbeddedBidTooShallow/i.test(s)) return "modal.lance.err.tooShallow";
  if (/EmbeddedBidUnavailable/i.test(s)) return "modal.lance.err.unavailable";
  // The DrawResult account doesn't exist — the pool hasn't been drawn (or
  // is an arrival-order pool, where it can NEVER exist). Anchor rejects at
  // the account layer, before any constraint runs.
  if (/AccountNotInitialized/i.test(s)) return "modal.lance.err.noDraw";
  if (/DefaultedMember/i.test(s)) return "modal.lance.err.defaulted";
  if (/PoolNotActive/i.test(s)) return "modal.lance.err.poolInactive";
  if (/ProtocolPaused/i.test(s)) return "modal.lance.err.paused";
  return null;
}

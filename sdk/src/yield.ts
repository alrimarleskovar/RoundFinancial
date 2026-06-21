/**
 * Harvest slippage-floor computation (RoundFi internal audit Wave 3).
 *
 * `roundfi-core::harvest_yield` enforces `realized >= min_realized_usdc`
 * — a caller-supplied floor that reverts the harvest if the adapter
 * delivers less yield than expected (defending against a malicious or
 * malfunctioning yield adapter that under-reports realized yield). The
 * on-chain guard is correct, but it is only as strong as the floor the
 * OFF-CHAIN caller passes: a floor of 0 disables it entirely.
 *
 * The audit found the devnet harvest crank defaulted the floor to 0
 * while already computing the expected surplus — leaving the guard
 * inert by default. This module is the single, testable source of truth
 * for turning an expected-surplus reading into a defensible floor, so
 * the crank (and the eventual orchestrator cranker) wires a real floor
 * instead of opting out.
 *
 * Pure + bigint-exact: no I/O, mirrors the on-chain u64 base-unit math.
 */

/** Default slippage tolerance applied to the expected surplus, in bps. */
export const DEFAULT_HARVEST_TOLERANCE_BPS = 100; // 1%

/** Basis-point denominator. */
const BPS_DENOM = 10_000n;

export interface HarvestFloorInputs {
  /**
   * Expected realized surplus in USDC base units, read on-chain as
   * `yield_vault.amount − tracked_principal` (the surplus currently
   * sitting in the adapter shadow vault, available to harvest).
   */
  expectedRealized: bigint;
  /**
   * Slippage tolerance in bps. The floor is set BELOW the expected
   * surplus by this fraction so normal rounding / timing jitter doesn't
   * trip the guard. Clamped to [0, 10_000].
   */
  toleranceBps?: number;
  /**
   * Explicit operator override in USDC base units. When provided (incl.
   * 0n for an intentional opt-out), it wins over the computed floor —
   * the operator is in full control, but opting out is now EXPLICIT.
   */
  override?: bigint;
}

export interface HarvestFloor {
  /** The floor to pass as `min_realized_usdc` (USDC base units). */
  minRealizedUsdc: bigint;
  /**
   * Why this value was chosen — surfaced so the crank can log it and a
   * `disabled` floor is never silent.
   *   - "override"  → operator-supplied explicit value.
   *   - "computed"  → expectedRealized × (1 − tolerance).
   *   - "disabled"  → floor is 0 (guard inert): no override, and the
   *                   expected surplus was 0 (nothing to floor).
   */
  source: "override" | "computed" | "disabled";
}

/**
 * Compute the `min_realized_usdc` floor for a harvest.
 *
 * Precedence:
 *   1. explicit `override` (incl. 0n) — operator is authoritative.
 *   2. `expectedRealized × (1 − toleranceBps/10_000)`, floored — the
 *      defensible default that keeps the on-chain guard live.
 *   3. 0n when there is no surplus to floor (reported as "disabled").
 *
 * All math is bigint base-unit exact; the tolerance is applied as
 * `expected × (10_000 − bps) / 10_000` with integer floor division so
 * the floor is never rounded ABOVE the expected surplus.
 */
export function computeHarvestFloor(inputs: HarvestFloorInputs): HarvestFloor {
  if (inputs.override !== undefined) {
    return { minRealizedUsdc: inputs.override, source: "override" };
  }
  const expected = inputs.expectedRealized;
  if (expected <= 0n) {
    return { minRealizedUsdc: 0n, source: "disabled" };
  }
  const rawBps = inputs.toleranceBps ?? DEFAULT_HARVEST_TOLERANCE_BPS;
  const clampedBps = Math.max(0, Math.min(10_000, Math.trunc(rawBps)));
  const keepBps = BPS_DENOM - BigInt(clampedBps);
  const floor = (expected * keepBps) / BPS_DENOM;
  return { minRealizedUsdc: floor, source: "computed" };
}

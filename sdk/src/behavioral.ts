/**
 * Canonical behavioral semantics for RoundFi — the ONE place that
 * defines "on time", "late", "grace used", "default eligible", and the
 * per-cycle deadline (`due_ts`).
 *
 * Lives in @roundfi/sdk because BOTH consumers must agree byte-for-byte:
 *   - the indexer (`services/indexer`) computes `due_ts` / `delta_seconds`
 *     / `grace_used` at ingest time and stores them on the `events` table,
 *   - the admin console (`app/`) renders + cross-checks those values.
 *
 * ─── PARITY CONTRACT ─────────────────────────────────────────────────
 * Every function here mirrors a specific line in the on-chain program.
 * The admin must NEVER tell a different story than the chain. If the
 * program's semantics change, update this module AND the cited program
 * line in the same change, and re-run the exact-value parity test
 * (`tests/behavioral.spec.ts`).
 *
 * Cadence (verified against the program):
 *   - `join_pool.rs:302-307` — at activation: `started_at = now`,
 *     `current_cycle = 0`, `next_cycle_at = started_at + cycle_duration`.
 *   - `claim_payout.rs:185-189` / `skip_defaulted_payout.rs:88-90` — each
 *     advance: `current_cycle += 1`, `next_cycle_at += cycle_duration`.
 *
 * Therefore while `current_cycle == c` (0-indexed):
 *   `next_cycle_at == started_at + (c + 1) * cycle_duration`
 * which is exactly `dueTs(startedAt, cycleDurationSec, c)` below.
 * ─────────────────────────────────────────────────────────────────────
 *
 * All timestamps are UNIX seconds as `bigint` to match the on-chain
 * `i64` clock and the indexer's `BigInt` columns. `delta_seconds` is
 * returned as a `number` to match the `Int` column in the schema (a
 * cycle delta never approaches the f64 safe-integer ceiling).
 */

import { CRANK_DEFAULTS } from "./constants.js";

/**
 * On-chain grace period, in seconds. Mirrors
 * `programs/roundfi-core/src/constants.rs:49` (`GRACE_PERIOD_SECS = 604_800`,
 * i.e. 7 days). Sourced from the SDK constant so there is a single
 * definition shared with the crank tooling.
 */
export const GRACE_PERIOD_SECS = CRANK_DEFAULTS.defaultGraceSec;

/**
 * Deadline (`due_ts`) for cycle `c` (0-indexed) of a pool.
 *
 * Mirrors the fixed cadence the program enforces (see PARITY CONTRACT):
 *   `dueTs(c) = startedAt + (c + 1) * cycleDurationSec`
 *
 * Returns `null` when the pool is not yet Active (`startedAt <= 0`): the
 * schedule is undefined while the pool is still Forming, so callers must
 * render "—" / "n/a" rather than computing a bogus deadline. The indexer
 * stores `due_ts = NULL` for any event whose pool had not started.
 */
export function dueTs(startedAt: bigint, cycleDurationSec: bigint, cycle: number): bigint | null {
  if (startedAt <= 0n) return null;
  if (cycle < 0) throw new Error(`dueTs: cycle must be >= 0, got ${cycle}`);
  return startedAt + BigInt(cycle + 1) * cycleDurationSec;
}

/**
 * `delta_seconds = on_chain_ts - due_ts`. Negative = paid before the
 * deadline (early), positive = paid after (late). Stored on the event
 * row so the admin avoids a runtime window function.
 */
export function deltaSeconds(onChainTs: bigint, due: bigint): number {
  return Number(onChainTs - due);
}

/**
 * On-time iff the payment landed at or before the deadline. Mirrors
 * `programs/roundfi-core/src/instructions/contribute.rs:181`
 * (`on_time = clock.unix_timestamp <= pool.next_cycle_at`) — note the
 * boundary is INCLUSIVE.
 *
 * On-chain, `!isOnTime` is the entire definition of "late" — it
 * increments `member.late_count` and mints a `SCHEMA_LATE` attestation.
 * There is no on-chain notion of "grace" for a contribution; grace only
 * affects default eligibility (see {@link usedGrace} / {@link isDefaultEligible}).
 */
export function isOnTime(onChainTs: bigint, due: bigint): boolean {
  return onChainTs <= due;
}

/**
 * `grace_used` — the payment was late (on-chain) BUT landed inside the
 * grace window, so the member never became default-eligible for this
 * cycle. Boolean sub-flag of "late", not a third timing category.
 *
 * Window is the open interval `(due, due + GRACE)`: at exactly
 * `due + GRACE` the member becomes default-eligible (see
 * {@link isDefaultEligible}), so that boundary is NOT "grace".
 *
 * Mirrors the migration definition
 * (`prisma/migrations/2026-05-canary-score-fields-options/README.md`):
 *   `grace_used = paid_at > due_at AND paid_at < (due_at + GRACE_PERIOD_SECS)`.
 */
export function usedGrace(
  onChainTs: bigint,
  due: bigint,
  graceSecs: number = GRACE_PERIOD_SECS,
): boolean {
  return onChainTs > due && onChainTs < due + BigInt(graceSecs);
}

/**
 * Coarse timing label for admin display. `on_chain` only distinguishes
 * on_time vs late; the `late_within_grace` / `late_past_grace` split is
 * an admin-side refinement layered on the grace window — surface it as
 * such, never as a distinct on-chain state.
 */
export type PaymentTiming = "on_time" | "late_within_grace" | "late_past_grace";

export function classifyTiming(
  onChainTs: bigint,
  due: bigint,
  graceSecs: number = GRACE_PERIOD_SECS,
): PaymentTiming {
  if (isOnTime(onChainTs, due)) return "on_time";
  if (usedGrace(onChainTs, due, graceSecs)) return "late_within_grace";
  return "late_past_grace";
}

/**
 * Whether a member is eligible to be settled as defaulted for the
 * current cycle. Mirrors the three preconditions in
 * `programs/roundfi-core/src/instructions/settle_default.rs:160-172`:
 *
 *   1. `now >= nextCycleAt + GRACE_PERIOD_SECS` — grace window elapsed,
 *   2. `contributionsPaid < currentCycle` — genuinely behind,
 *   3. `!defaulted` — one-directional state transition.
 *
 * `nextCycleAt` is the pool's CURRENT-cycle deadline (the on-chain check
 * uses `pool.next_cycle_at`, not the missed cycle's deadline) — pass the
 * live `pool.next_cycle_at`, not a recomputed `dueTs` of an older cycle.
 */
export function isDefaultEligible(args: {
  now: bigint;
  nextCycleAt: bigint;
  contributionsPaid: number;
  currentCycle: number;
  defaulted: boolean;
  graceSecs?: number;
}): boolean {
  const grace = BigInt(args.graceSecs ?? GRACE_PERIOD_SECS);
  return (
    !args.defaulted &&
    args.contributionsPaid < args.currentCycle &&
    args.now >= args.nextCycleAt + grace
  );
}

/**
 * Gap 1 of the canary audit — actually fire `settle_default` when a
 * member misses the grace deadline.
 *
 * Why this is critical: the on-chain program will not advance the cycle
 * past a defaulted member without `settle_default` (or `skip_defaulted_
 * payout`) being explicitly called. Without the crank firing this, the
 * pool sits stalled and every other member's score is held hostage to
 * the missing tx. The `services/orchestrator/src/runCycle.ts` is
 * explicit that it does NOT do this — the crank is the only path.
 *
 * INFRA_FAILURE vs PAYMENT_MISSED — ECO-V52-High fix:
 * The on-chain `settleDefault` is an IRREVERSIBLE penalty (seizes
 * collateral, sets `defaulted`, demotes the reputation level). The prior
 * code classified the reason but fired `settle_default` ANYWAY, even when
 * it deemed the miss non-attributable (the crank's own RPC was blind
 * across the member's grace window) — an irreversible penalty for a fault
 * that was not the member's. Worse, `checkRpcHealth` clears `rpcDownSince`
 * before this runs (pollingLoop: health-check → settle), so the old
 * `rpcDownSince ≤ deadline` rule could never even fire in production.
 *
 * Now: when the crank's last outage overlapped a member's grace window,
 * we EXTEND that member's deadline by the overlap and WITHHOLD
 * `settle_default` (status `skipped`, reason `INFRA_FAILURE`) until the
 * extended deadline passes. The classification reads the persisted
 * `crankState.lastOutage` window (survives recovery), not the cleared
 * `rpcDownSince`. Liveness is preserved: a genuine defaulter is settled as
 * `PAYMENT_MISSED` on a later healthy tick once the extended deadline has
 * elapsed — the extension is bounded by the outage duration, so the loop
 * always terminates.
 *
 *   INFRA_FAILURE (defer, do NOT settle) while
 *       now < graceDeadline + outageOverlap(graceWindow):
 *       the crank was unreachable across the member's grace window, so the
 *       miss is not necessarily their fault — give them the lost time back.
 *   PAYMENT_MISSED (settle) otherwise:
 *       the crank had a clean view of the (possibly extended) window and
 *       the member still didn't pay.
 *
 * Preconditions the on-chain handler enforces (we mirror them here so
 * we skip un-eligible calls instead of paying gas for guaranteed
 * reverts):
 *   - args.cycle == pool.current_cycle  (handler:155-161)
 *   - member.contributions_paid < pool.current_cycle  (MemberNotBehind)
 *   - clock.unix_timestamp >= pool.next_cycle_at + GRACE_PERIOD_SECS
 *   - !member.defaulted
 */

import type { MemberView, PoolView, RoundFiClient } from "@roundfi/sdk";
import { listPoolMembers, settleDefault } from "@roundfi/sdk";

import { classifyError } from "./classifyError.js";
import { crankState } from "./crankState.js";
import { logger } from "./logger.js";

/** GRACE_PERIOD_SECS = 7d (mainnet, SEV-002 floor; programs/roundfi-core/src/constants.rs:62). */
const GRACE_PERIOD_SECS = 7 * 24 * 60 * 60;

export type DefaultReason = "PAYMENT_MISSED" | "INFRA_FAILURE";

export interface DefaultSettleResult {
  pool: string;
  member: string;
  slotIndex: number;
  cycle: number;
  reason: DefaultReason;
  status: "settled" | "skipped" | "failed";
  errorKind?: "INFRA" | "LOGIC" | "UNKNOWN";
}

/**
 * For each pool, sweep its members and fire settle_default for any
 * who missed cycle N's contribute past the grace deadline. Returns one
 * entry per attempted settlement (settled / skipped / failed) for the
 * caller to roll up into a single tick summary.
 */
export async function checkAndSettleDefaults(
  client: RoundFiClient,
  pool: PoolView,
  nowEpochSecs: number = Math.floor(Date.now() / 1000),
): Promise<DefaultSettleResult[]> {
  const results: DefaultSettleResult[] = [];

  // Cycle alignment: handler requires args.cycle == pool.current_cycle.
  // The "missed" cycle is the previous one (current_cycle was advanced
  // by the most recent claim_payout / skip_defaulted_payout). If the
  // pool just transitioned and current_cycle is 0, nothing to settle.
  if (pool.currentCycle === 0) return results;

  const graceDeadlineSecs = Number(pool.nextCycleAt) + GRACE_PERIOD_SECS;
  if (nowEpochSecs < graceDeadlineSecs) {
    // Still inside the grace window for this cycle — nothing to do.
    return results;
  }

  const members = await listPoolMembers(client, pool.address);

  for (const member of members) {
    const eligible = isEligibleForSettle(member, pool);
    if (!eligible.ok) {
      // Skip silently for the routine reasons (already paid, already
      // defaulted, member not behind). Don't spam the log.
      continue;
    }

    const graceWindowStartSecs = Number(pool.nextCycleAt);
    const reason = classifyDefaultReason(graceWindowStartSecs, graceDeadlineSecs, nowEpochSecs);
    const ctx = {
      pool: pool.address.toBase58(),
      member: member.address.toBase58(),
      slotIndex: member.slotIndex,
      cycle: pool.currentCycle,
      reason,
    };

    // ECO-V52-High: never fire the IRREVERSIBLE settle_default for a
    // non-attributable (infra) miss. Defer instead — the member's deadline is
    // extended by the outage overlap, and a later healthy tick past the
    // extended deadline settles them as PAYMENT_MISSED if still behind.
    if (reason === "INFRA_FAILURE") {
      const graceExtensionSecs = outageOverlapSecs(graceWindowStartSecs, graceDeadlineSecs);
      logger.warn(
        { event_type: "settle.deferred_infra", ...ctx, graceExtensionSecs },
        "Withholding settle_default — crank infra outage overlapped this member's grace window",
      );
      results.push({ ...ctx, status: "skipped" });
      continue;
    }

    try {
      logger.info({ event_type: "settle.start", ...ctx }, "Firing settle_default");
      await settleDefault(client, {
        pool: pool.address,
        usdcMint: pool.usdcMint,
        defaultedMemberWallet: member.wallet,
        slotIndex: member.slotIndex,
        cycle: pool.currentCycle,
      });
      logger.info({ event_type: "settle.success", ...ctx }, "settle_default confirmed");
      results.push({ ...ctx, status: "settled" });
    } catch (err) {
      const errorKind = classifyError(err);
      const msg = err instanceof Error ? err.message : String(err);
      // LOGIC errors mean the on-chain state diverged from what we
      // believed — escalate. INFRA / UNKNOWN: log + carry on, next
      // tick will retry.
      const level = errorKind === "LOGIC" ? "error" : "warn";
      logger[level](
        { event_type: "settle.failed", ...ctx, errorKind, error: msg },
        `settle_default failed (${errorKind})`,
      );
      results.push({ ...ctx, status: "failed", errorKind });
    }
  }

  return results;
}

/** Compact result of the per-member precondition check. */
interface EligibilityCheck {
  ok: boolean;
  reason?: string;
}

export function isEligibleForSettle(member: MemberView, pool: PoolView): EligibilityCheck {
  if (member.defaulted) return { ok: false, reason: "already_defaulted" };
  if (member.paidOut) return { ok: false, reason: "already_paid_out" };
  // MemberNotBehind: handler:163 requires contributions_paid < current_cycle.
  if (member.contributionsPaid >= pool.currentCycle) {
    return { ok: false, reason: "not_behind" };
  }
  return { ok: true };
}

/**
 * Seconds the crank's last completed outage overlapped the grace window
 * `[graceWindowStartSecs, graceDeadlineSecs]`. 0 if there was no outage or it
 * fell entirely outside the window. This is the time the crank (our infra) was
 * blind while the member could still have paid within grace — the amount we
 * extend their deadline by before any liquidation. Reads the persisted
 * `lastOutage` window (set on recovery), so it survives `rpcDownSince` being
 * cleared by the pre-settle health check.
 */
export function outageOverlapSecs(graceWindowStartSecs: number, graceDeadlineSecs: number): number {
  const outage = crankState.snapshot.lastOutage;
  if (!outage) return 0;
  const outStart = Math.floor(outage.start.getTime() / 1000);
  const outEnd = Math.floor(outage.end.getTime() / 1000);
  const lo = Math.max(outStart, graceWindowStartSecs);
  const hi = Math.min(outEnd, graceDeadlineSecs);
  return Math.max(0, hi - lo);
}

/**
 * Decide whether a missed contribution is the member's fault
 * (`PAYMENT_MISSED` → settle) or a non-attributable infra miss still inside its
 * extension window (`INFRA_FAILURE` → defer). The member's effective deadline
 * is `graceDeadline + outageOverlap`; while `now` is before it we withhold the
 * irreversible liquidation. See the module header for the full rationale.
 */
export function classifyDefaultReason(
  graceWindowStartSecs: number,
  graceDeadlineSecs: number,
  nowSecs: number = Math.floor(Date.now() / 1000),
): DefaultReason {
  const overlap = outageOverlapSecs(graceWindowStartSecs, graceDeadlineSecs);
  const effectiveDeadlineSecs = graceDeadlineSecs + overlap;
  if (overlap > 0 && nowSecs < effectiveDeadlineSecs) {
    return "INFRA_FAILURE";
  }
  return "PAYMENT_MISSED";
}

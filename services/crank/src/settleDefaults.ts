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
 * Off-chain `reason` (PAYMENT_MISSED vs INFRA_FAILURE):
 * The on-chain `settleDefault` instruction does NOT take a reason
 * argument — adding one would require a roundfi-core PR + new audit,
 * out of crank scope. Instead we emit it in the structured event log
 * here so the indexer / admin score-contestation UI can flip the
 * verdict off-chain (the score lives in roundfi-reputation; penalty is
 * effectively soft from this layer). Classification rule:
 *
 *   INFRA_FAILURE if rpcDownSince ≤ graceDeadline:
 *       the crank's RPC was unreachable across the member's deadline,
 *       so this member's missed tx is not necessarily their fault —
 *       eligible for off-chain score reversal.
 *   PAYMENT_MISSED otherwise:
 *       the crank was healthy and the member simply didn't pay.
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

    const reason = classifyDefaultReason(graceDeadlineSecs);
    const ctx = {
      pool: pool.address.toBase58(),
      member: member.address.toBase58(),
      slotIndex: member.slotIndex,
      cycle: pool.currentCycle,
      reason,
    };

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

export function classifyDefaultReason(graceDeadlineSecs: number): DefaultReason {
  // If the crank's RPC was down at the time the deadline elapsed,
  // surface that — the member's failure to contribute may be due to
  // our infra, not theirs. The check is conservative: if `rpcDownSince`
  // is set at all and predates the deadline, classify as INFRA. If the
  // RPC recovered before the deadline, classify as PAYMENT_MISSED.
  const rpcDownSince = crankState.snapshot.rpcDownSince;
  if (rpcDownSince && Math.floor(rpcDownSince.getTime() / 1000) <= graceDeadlineSecs) {
    return "INFRA_FAILURE";
  }
  return "PAYMENT_MISSED";
}

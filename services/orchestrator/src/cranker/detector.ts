/**
 * Pure detection: given a pool snapshot + its members + the current
 * UNIX clock + the protocol grace window, return every (member, cycle)
 * tuple eligible for settle_default.
 *
 * Mirrors the on-chain preconditions in
 * programs/roundfi-core/src/instructions/settle_default.rs:
 *
 *   - pool.status == Active                       (status code 1)
 *   - now >= pool.next_cycle_at + GRACE_PERIOD_SECS
 *   - member.contributions_paid < pool.current_cycle  (genuinely behind)
 *   - !member.defaulted                            (one-shot transition)
 *
 * Conservative: false positives are fine (the chain rejects them);
 * false negatives are not (a missed default that never settles).
 *
 * No I/O. Easy to unit-test.
 */

import type { PublicKey } from "@solana/web3.js";

export interface PoolSnapshot {
  address: PublicKey;
  status: number; // 0 Forming · 1 Active · 2 Completed · 3 Liquidated · 4 Closed
  currentCycle: number;
  nextCycleAt: bigint; // UNIX seconds
}

export interface MemberSnapshot {
  wallet: PublicKey;
  slotIndex: number;
  contributionsPaid: number;
  defaulted: boolean;
}

export interface SettleCandidate {
  pool: PublicKey;
  memberWallet: PublicKey;
  slotIndex: number;
  cycle: number;
}

export function detectEligibleDefaults(
  pool: PoolSnapshot,
  members: MemberSnapshot[],
  nowSec: bigint,
  graceSec: bigint,
): SettleCandidate[] {
  if (pool.status !== 1) return [];

  const graceExpiresAt = pool.nextCycleAt + graceSec;
  if (nowSec < graceExpiresAt) return [];

  const out: SettleCandidate[] = [];
  for (const m of members) {
    if (m.defaulted) continue;
    if (m.contributionsPaid >= pool.currentCycle) continue;
    out.push({
      pool: pool.address,
      memberWallet: m.wallet,
      slotIndex: m.slotIndex,
      cycle: pool.currentCycle,
    });
  }
  return out;
}

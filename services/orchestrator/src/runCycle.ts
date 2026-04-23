/**
 * Run a single pool cycle, deterministically.
 *
 * A cycle has two phases:
 *
 *   1. contribute: every member whose `slotIndex` is not in `skip`
 *      calls `contribute({ cycle })` in slot order. The orchestrator
 *      never calls `settle_default` — a missed contribution is logged
 *      as `member.missed` with a note that on-chain settlement would
 *      fire after the 7-day grace window (handled separately by the
 *      bankrun edge test, not reachable on a fresh localnet).
 *
 *   2. claim: the member whose `slotIndex == cycle` calls
 *      `claim_payout({ cycle })`. This is also the instruction that
 *      advances `pool.current_cycle`.
 *
 * The cycle owner CAN claim even if they personally didn't contribute
 * this cycle (their on-chain `contributions_paid` can be < cycle+1),
 * as long as they aren't flagged defaulted + haven't been paid out.
 * That is exactly the "late claimant" scenario we want to showcase
 * in the demo, so we log it prominently.
 *
 * Emits events for every effect and a `pool.snapshot` at the end so
 * UI consumers can re-render state without a separate read.
 */

import type { PublicKey } from "@solana/web3.js";

import {
  claimPayout,
  contribute,
  fetchMemberByWallet,
  fetchPool,
  fetchTokenBalance,
  poolVaults,
} from "@roundfi/sdk";
import type { PoolView, RoundFiClient } from "@roundfi/sdk";

import type { EventSink } from "./events.js";
import { now } from "./events.js";
import type { DemoMember } from "./setup.js";

export interface RunCycleArgs {
  client: RoundFiClient;
  pool: PublicKey;
  usdcMint: PublicKey;
  members: DemoMember[];
  /** Zero-based cycle index to execute. */
  cycle: number;
  /** Slot indices that should NOT contribute this cycle. */
  skipContribute?: number[];
  /**
   * Slot indices that should contribute with the "Late" schema
   * (schemaId=2) instead of the default "Payment" schema (schemaId=1).
   * Purely cosmetic for the demo — economically identical on-chain.
   */
  lateContributors?: number[];
  sink: EventSink;
}

export interface RunCycleResult {
  cycle: number;
  contributionsSubmitted: number;
  contributionsSkipped: number;
  payoutSignature?: string;
  claimantSlot?: number;
  poolAfter: PoolView;
}

export async function runCycle(args: RunCycleArgs): Promise<RunCycleResult> {
  const skip = new Set(args.skipContribute ?? []);
  const late = new Set(args.lateContributors ?? []);

  // ── Contribution phase ───────────────────────────────────────────
  let submitted = 0;
  let skipped = 0;

  const ordered = [...args.members].sort((a, b) => a.slotIndex - b.slotIndex);

  for (const mbr of ordered) {
    if (skip.has(mbr.slotIndex)) {
      args.sink({
        kind: "member.missed",
        actor: mbr.name,
        slotIndex: mbr.slotIndex,
        cycle: args.cycle,
        note: "orchestrator skipped contribution (simulated default)",
        at: now(),
      });
      skipped += 1;
      continue;
    }

    try {
      const res = await contribute(args.client, {
        pool:           args.pool,
        usdcMint:       args.usdcMint,
        memberWallet:   mbr.wallet,
        slotIndex:      mbr.slotIndex,
        cycle:          args.cycle,
        schemaId:       late.has(mbr.slotIndex) ? 2 /* Late */ : 1 /* Payment */,
      });

      const pool = await fetchPool(args.client, args.pool);
      args.sink({
        kind: "member.contributed",
        actor: mbr.name,
        slotIndex: mbr.slotIndex,
        cycle: args.cycle,
        amount: pool?.installmentAmount ?? 0n,
        onTime: !late.has(mbr.slotIndex),
        at: now(),
      });
      args.sink({
        kind: "action.ok",
        action: "contribute",
        actor: mbr.name,
        signature: res.signature,
        detail: `Cycle ${args.cycle}: ${mbr.name} contributed (slot ${mbr.slotIndex})`,
        at: now(),
      });
      submitted += 1;
    } catch (err) {
      args.sink({
        kind: "action.fail",
        action: "contribute",
        actor: mbr.name,
        error: err instanceof Error ? err.message : String(err),
        at: now(),
      });
      throw err;
    }
  }

  // ── Claim phase ──────────────────────────────────────────────────
  const claimant = ordered.find((m) => m.slotIndex === args.cycle);
  let payoutSignature: string | undefined;
  let claimantSlot: number | undefined;

  if (!claimant) {
    args.sink({
      kind: "action.skip",
      action: "claimPayout",
      reason: `no member holds slot ${args.cycle} for cycle ${args.cycle}`,
      at: now(),
    });
  } else {
    const memberBefore = await fetchMemberByWallet(
      args.client,
      args.pool,
      claimant.wallet.publicKey,
    );
    if (memberBefore?.paidOut) {
      args.sink({
        kind: "action.skip",
        action: "claimPayout",
        actor: claimant.name,
        reason: `${claimant.name} has already been paid out for this pool`,
        at: now(),
      });
    } else if (memberBefore?.defaulted) {
      args.sink({
        kind: "action.skip",
        action: "claimPayout",
        actor: claimant.name,
        reason: `${claimant.name} is marked defaulted — payout skipped`,
        at: now(),
      });
    } else {
      const res = await claimPayout(args.client, {
        pool:         args.pool,
        usdcMint:     args.usdcMint,
        memberWallet: claimant.wallet,
        slotIndex:    claimant.slotIndex,
        cycle:        args.cycle,
      });

      const pool = await fetchPool(args.client, args.pool);
      args.sink({
        kind: "payout.executed",
        actor: claimant.name,
        slotIndex: claimant.slotIndex,
        cycle: args.cycle,
        amount: pool?.creditAmount ?? 0n,
        at: now(),
      });
      args.sink({
        kind: "action.ok",
        action: "claimPayout",
        actor: claimant.name,
        signature: res.signature,
        detail: `Cycle ${args.cycle}: ${claimant.name} claimed credit`,
        at: now(),
      });
      payoutSignature = res.signature;
      claimantSlot = claimant.slotIndex;
    }
  }

  // ── Snapshot ─────────────────────────────────────────────────────
  const poolAfter = await fetchPool(args.client, args.pool);
  if (!poolAfter) {
    throw new Error("runCycle: pool account disappeared mid-cycle");
  }
  const vaults = poolVaults(args.client, args.pool, args.usdcMint);
  const poolUsdcVaultBalance = await fetchTokenBalance(args.client, vaults.poolUsdcVault);

  args.sink({
    kind: "pool.snapshot",
    cycle: args.cycle,
    status: poolAfter.status,
    totalContributed: poolAfter.totalContributed,
    totalPaidOut: poolAfter.totalPaidOut,
    solidarityBalance: poolAfter.solidarityBalance,
    escrowBalance: poolAfter.escrowBalance,
    defaultedMembers: poolAfter.defaultedMembers,
    poolUsdcVaultBalance,
    at: now(),
  });

  return {
    cycle: args.cycle,
    contributionsSubmitted: submitted,
    contributionsSkipped: skipped,
    payoutSignature,
    claimantSlot,
    poolAfter,
  };
}

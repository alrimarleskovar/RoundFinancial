/**
 * edge — SEV-053 stall re-anchor: a late cycle advance opens a FULL window
 * (bankrun, real instruction path end-to-end).
 *
 * Found live on the devnet canary (2026-07-07): the cycle-0 contemplated
 * member deliberately never claimed; after the pool was cranked, the catch-up
 * contributions minted `SCHEMA_LATE` (−100 each) on members who had been on
 * time every prior cycle — the pool's `next_cycle_at` was frozen in the past
 * and the schedule-anchored advance (`next_cycle_at += cycle_duration`)
 * birthed the next window already expired. Members can't even pay ahead while
 * stalled (`WrongCycle` / `AlreadyContributed`), so the lateness was
 * structurally unavoidable — the owner's fairness rule: the party who failed
 * their duty may be penalized; the blocked group must NOT be.
 *
 * Fix under test: the three advance sites (`claim_payout`, `crank_payout`,
 * `skip_defaulted_payout`) now anchor on `max(next_cycle_at, now)`:
 *
 *   A. Stalled unstick (crank long past grace) → `next_cycle_at = now +
 *      cycle_duration` (re-anchored), NOT the stale `schedule + duration`.
 *   B. The fairness pin: a blocked member contributing right after the
 *      unstick is ON TIME (`SCHEMA_PAYMENT`, `on_time_count` increments).
 *      The attestation PDA carries schema_id in its seeds, so if the program
 *      still classified this LATE the tx would fail `ConstraintSeeds` — the
 *      assertion cannot false-pass.
 *   C. Control: an advance BEFORE the deadline (normal self-claim) keeps the
 *      scheduled cadence exactly (`max` picks the schedule) — no drift for
 *      healthy pools.
 *
 * Uses the compat harness's REAL path (createPool → joinMembers → contribute
 * → crank/claim), so the reputation CPI runs for real — no hand-seeded state.
 */

import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { ATTESTATION_SCHEMA } from "@roundfi/sdk";

import {
  attestationFor,
  attestationNonce,
  claimPayout,
  configPda,
  contribute,
  createPool,
  createUsdcMint,
  fetchMember,
  fetchPool,
  fundUsdc,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  memberKeypairs,
  reputationConfigFor,
  reputationProfileFor,
  usdc,
  type MemberHandle,
  type PoolHandle,
} from "./_harness/index.js";
import {
  setBankrunUnixTs,
  setupBankrunEnvCompat,
  type BankrunEnvCompat,
} from "./_harness/bankrun_compat.js";

const GRACE_PERIOD_SECS = 604_800n; // vanilla build (no devnet-canary feature)

const MEMBERS_TARGET = 3;
const CYCLES_TOTAL = 3;
const CYCLE_DURATION_SEC = 86_400; // MIN_CYCLE_DURATION
const CYCLE = BigInt(CYCLE_DURATION_SEC);
// SEV-031 viability with protocol defaults (sol=1%, esc=25% → net 0.74):
// 3 × 2000 × 0.74 = 4440 ≥ 2200 ✓.
const INSTALLMENT_BASE = usdc(2_000n);
const CREDIT_BASE = usdc(2_200n);

// A stall two full cycles long past the grace window — deep inside the
// cascade zone the old schedule-anchored advance could not recover from
// (schedule + duration stays in the past for TWO advances in a row).
const STALL_PAST_GRACE = 2n * CYCLE + 100n;

describe("edge — SEV-053 stall re-anchor opens a full window (bankrun)", function () {
  this.timeout(60_000);

  let env: BankrunEnvCompat;
  let usdcMint: PublicKey;

  const authority = Keypair.generate();
  const memberKps = memberKeypairs(MEMBERS_TARGET, "edge_stall_reanchor");

  let pool: PoolHandle;
  let m0: MemberHandle; // slot 0 — the contemplated who never claims
  let m1: MemberHandle; // slot 1 — the blocked member (the fairness subject)
  let m2: MemberHandle; // slot 2

  let deadline0: bigint; // next_cycle_at while the pool is stuck at cycle 0
  let crankTime: bigint; // clock at the moment of the unstick

  before(async function () {
    env = await setupBankrunEnvCompat();
    usdcMint = await createUsdcMint(env);
    await initializeProtocol(env, { usdcMint });
    await initializeReputation(env, { coreProgram: env.ids.core });

    pool = await createPool(env, {
      authority,
      usdcMint,
      membersTarget: MEMBERS_TARGET,
      installmentAmount: INSTALLMENT_BASE,
      creditAmount: CREDIT_BASE,
      cyclesTotal: CYCLES_TOTAL,
      cycleDurationSec: CYCLE_DURATION_SEC,
    });

    const joined = await joinMembers(env, pool, [
      { member: memberKps[0]!, reputationLevel: 1 },
      { member: memberKps[1]!, reputationLevel: 1 },
      { member: memberKps[2]!, reputationLevel: 1 },
    ]);
    [m0, m1, m2] = [joined[0]!, joined[1]!, joined[2]!];

    // Enough for every installment of the pool.
    for (const m of [m0, m1, m2]) {
      await fundUsdc(env, usdcMint, m.wallet.publicKey, INSTALLMENT_BASE * 3n);
    }

    // Cycle 0: everyone pays on time. The contemplated (slot 0) then never
    // claims — the SEV-051 liveness scenario that produces the stall.
    for (const m of [m0, m1, m2]) {
      await contribute(env, { pool, member: m, cycle: 0, schemaId: ATTESTATION_SCHEMA.Payment });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await fetchPool(env, pool.pool)) as any;
    deadline0 = BigInt(p.nextCycleAt.toString());
    expect(p.currentCycle, "pool stuck at cycle 0 (contemplated never claimed)").to.equal(0);
  });

  // Permissionless crank for the contemplated slot — mirrors the account
  // order of `CrankPayout<'info>`; the payer cranks, the member does NOT sign.
  function crank(target: MemberHandle, cycle: number) {
    const attestation = attestationFor(
      env,
      pool.pool,
      target.wallet.publicKey,
      ATTESTATION_SCHEMA.PayoutClaimed,
      attestationNonce(cycle, target.slotIndex),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (env.programs.core.methods as any).crankPayout({ cycle }).accounts({
      caller: env.payer.publicKey,
      config: configPda(env),
      pool: pool.pool,
      member: target.member,
      memberWallet: target.wallet.publicKey,
      usdcMint,
      memberUsdc: target.memberUsdc,
      poolUsdcVault: pool.poolUsdcVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      reputationProgram: env.ids.reputation,
      reputationConfig: reputationConfigFor(env),
      reputationProfile: reputationProfileFor(env, target.wallet.publicKey),
      identityRecord: env.ids.reputation, // None sentinel
      attestation,
      systemProgram: SystemProgram.programId,
    });
  }

  it("A. stalled unstick re-anchors: next_cycle_at = now + cycle_duration, not schedule + duration", async function () {
    crankTime = deadline0 + GRACE_PERIOD_SECS + STALL_PAST_GRACE;
    await setBankrunUnixTs(env.context, crankTime);

    await crank(m0, 0).rpc();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await fetchPool(env, pool.pool)) as any;
    expect(p.currentCycle, "cycle advanced 0 → 1").to.equal(1);

    const nextCycleAt = BigInt(p.nextCycleAt.toString());
    expect(nextCycleAt, "re-anchored on the unstick clock").to.equal(crankTime + CYCLE);
    // The pre-fix behavior — the window that is born already expired.
    expect(nextCycleAt, "NOT the stale schedule anchor").to.not.equal(deadline0 + CYCLE);
    expect(nextCycleAt > crankTime, "the new window is genuinely open").to.equal(true);
  });

  it("B. fairness pin: a blocked member contributing right after the unstick is ON TIME", async function () {
    // Under the pre-fix schedule anchor this contribution would be LATE
    // (now >> deadline0 + duration). The helper derives the attestation PDA
    // under SCHEMA_PAYMENT — a LATE classification on-chain would abort with
    // ConstraintSeeds, so success here IS the classification assertion.
    await contribute(env, { pool, member: m1, cycle: 1, schemaId: ATTESTATION_SCHEMA.Payment });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (await fetchMember(env, m1.member)) as any;
    expect(m.contributionsPaid, "cycle-1 installment recorded").to.equal(2);
    expect(m.onTimeCount, "catch-up payment counted ON TIME").to.equal(2);
    expect(m.lateCount, "no wrongful LATE for the blocked member").to.equal(0);
  });

  it("C. control: an advance BEFORE the deadline keeps the scheduled cadence exactly", async function () {
    // Remaining cycle-1 contributions land inside the re-anchored window.
    await contribute(env, { pool, member: m0, cycle: 1, schemaId: ATTESTATION_SCHEMA.Payment });
    await contribute(env, { pool, member: m2, cycle: 1, schemaId: ATTESTATION_SCHEMA.Payment });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = (await fetchPool(env, pool.pool)) as any;
    const deadline1 = BigInt(before.nextCycleAt.toString());

    // The cycle-1 contemplated self-claims WELL BEFORE the deadline — the
    // healthy path. max(schedule, now) must pick the schedule: no drift.
    const claimTime = deadline1 - 1_000n;
    await setBankrunUnixTs(env.context, claimTime);
    await claimPayout(env, { pool, member: m1, cycle: 1 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = (await fetchPool(env, pool.pool)) as any;
    expect(after.currentCycle, "cycle advanced 1 → 2").to.equal(2);
    expect(
      BigInt(after.nextCycleAt.toString()),
      "on-time advance keeps the exact scheduled cadence",
    ).to.equal(deadline1 + CYCLE);
  });
});

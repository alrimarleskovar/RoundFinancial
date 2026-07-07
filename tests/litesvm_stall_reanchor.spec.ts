/**
 * SEV-053 stall re-anchor: a late cycle advance opens a FULL window
 * (litesvm, real instruction path end-to-end — mpl_core join included).
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
 * `skip_defaulted_payout`) anchor on `max(next_cycle_at, now)`:
 *
 *   A. Stalled unstick (crank long past grace) → `next_cycle_at = now +
 *      cycle_duration` (re-anchored), NOT the stale `schedule + duration`;
 *      and the crank mints the SCHEMA_CLAIM_NEGLECT (−100) penalty on the
 *      non-claimer — which requires attest.rs's schema whitelist to accept
 *      id 7 (the gap that reverted every crank on devnet, InvalidSchema).
 *   B. The fairness pin: a blocked member contributing right after the
 *      unstick is ON TIME (`SCHEMA_PAYMENT`, `on_time_count` increments).
 *      The attestation PDA carries schema_id in its seeds, so if the program
 *      still classified this LATE the tx would fail `ConstraintSeeds` — the
 *      assertion cannot false-pass.
 *   C. Control: an advance BEFORE the deadline (normal self-claim) keeps the
 *      scheduled cadence exactly (`max` picks the schedule) — no drift for
 *      healthy pools.
 *
 * **Why litesvm and not bankrun.** This spec's first life was
 * `tests/edge_stall_reanchor.spec.ts` under the bankrun compat harness — a
 * file the CI never executed: `join_pool` needs mpl_core, and bankrun's
 * solana-program-test 1.18 panics on the current SBFv2 mpl_core.so
 * (SEV-012), so the bankrun lane pins mpl_core-free specs only and the
 * `edge_*` glob runs nowhere. The gap let the schema-whitelist regression
 * reach devnet with a "passing" test that had never run. litesvm loads
 * SBFv2 fine and `test:litesvm` globs `tests/litesvm_*.spec.ts`, so THIS
 * file executes in the `litesvm · mpl-core path` lane on every PR.
 *
 * Uses the harness's REAL path (createPool → joinMembers → contribute →
 * crank/claim), so the reputation CPI runs for real — no hand-seeded state.
 * Skips cleanly when build artifacts are absent (same guard as
 * litesvm_join_pool.spec.ts).
 */

import { expect } from "chai";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
  fetchProfile,
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
import { setLitesvmUnixTs, setupLitesvmEnv, type LitesvmEnv } from "./_harness/litesvm.js";

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

// litesvm's clock does not advance on its own; anchor it to a real epoch
// once up front (same pattern as litesvm_pool_complete_cooldown) so every
// `before`-phase contribute lands on-time against `next_cycle_at`.
const BASE_TS = 1_900_000_000n; // ~2030

const ARTIFACTS = [
  "target/idl/roundfi_core.json",
  "target/deploy/roundfi_core.so",
  "target/deploy/roundfi_reputation.so",
  "target/deploy/mpl_core.so",
].map((p) => resolve(process.cwd(), p));

describe("SEV-053 — stall re-anchor opens a full window (litesvm, mpl_core path)", function () {
  this.timeout(120_000);

  let env: LitesvmEnv;
  let litesvmAvailable = true;
  let usdcMint: PublicKey;

  const authority = Keypair.generate();
  const memberKps = memberKeypairs(MEMBERS_TARGET, "litesvm_stall_reanchor");

  let pool: PoolHandle;
  let m0: MemberHandle; // slot 0 — the contemplated who never claims
  let m1: MemberHandle; // slot 1 — the blocked member (the fairness subject)
  let m2: MemberHandle; // slot 2

  let deadline0: bigint; // next_cycle_at while the pool is stuck at cycle 0
  let crankTime: bigint; // clock at the moment of the unstick

  before(async function () {
    for (const p of ARTIFACTS) {
      if (!existsSync(p)) {
        console.warn(
          `\n[litesvm] SKIPPING — missing ${p} (run 'anchor build' + dump mpl_core.so).`,
        );
        litesvmAvailable = false;
        return;
      }
    }
    try {
      env = await setupLitesvmEnv();
    } catch (e) {
      console.warn(`\n[litesvm] SKIPPING — setup failed: ${(e as Error)?.message ?? e}`);
      litesvmAvailable = false;
      return;
    }

    await setLitesvmUnixTs(env.svm, BASE_TS);
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

  // Attestation PDA the SEV-053 option-B penalty lands in — same nonce as the
  // PAYOUT_CLAIMED breadcrumb, distinct schema seed.
  function neglectAttestationFor(target: MemberHandle, cycle: number) {
    return attestationFor(
      env,
      pool.pool,
      target.wallet.publicKey,
      ATTESTATION_SCHEMA.ClaimNeglect,
      attestationNonce(cycle, target.slotIndex),
    );
  }

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
      neglectAttestation: neglectAttestationFor(target, cycle),
      systemProgram: SystemProgram.programId,
    });
  }

  it("A. stalled unstick re-anchors: next_cycle_at = now + cycle_duration, not schedule + duration", async function () {
    if (!litesvmAvailable) return this.skip();
    crankTime = deadline0 + GRACE_PERIOD_SECS + STALL_PAST_GRACE;
    await setLitesvmUnixTs(env.svm, crankTime);

    // Pre-crank baseline: m0 has one unverified on-time payment (+5).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profPre = (await fetchProfile(env, m0.wallet.publicKey)) as any;
    const scorePre = BigInt(profPre.score.toString());

    await crank(m0, 0).rpc();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await fetchPool(env, pool.pool)) as any;
    expect(p.currentCycle, "cycle advanced 0 → 1").to.equal(1);

    const nextCycleAt = BigInt(p.nextCycleAt.toString());
    expect(nextCycleAt, "re-anchored on the unstick clock").to.equal(crankTime + CYCLE);
    // The pre-fix behavior — the window that is born already expired.
    expect(nextCycleAt, "NOT the stale schedule anchor").to.not.equal(deadline0 + CYCLE);
    expect(nextCycleAt > crankTime, "the new window is genuinely open").to.equal(true);

    // SEV-053 option B: the non-claimer's half of the fairness rule — being
    // cranked costs a flat SCORE_CLAIM_NEGLECT (−100, floor at 0) and mints
    // the CLAIM_NEGLECT attestation alongside the PAYOUT_CLAIMED breadcrumb.
    // This leg is ALSO the whitelist regression guard: attest.rs's upfront
    // schema-validity gate rejected id 7 with InvalidSchema on devnet, which
    // reverted this exact crank.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profPost = (await fetchProfile(env, m0.wallet.publicKey)) as any;
    const scorePost = BigInt(profPost.score.toString());
    const expected = scorePre - 100n > 0n ? scorePre - 100n : 0n;
    expect(scorePost, "crank applies the flat −100 neglect penalty (floor 0)").to.equal(expected);
    const neglectInfo = await env.connection.getAccountInfo(neglectAttestationFor(m0, 0));
    expect(neglectInfo, "CLAIM_NEGLECT attestation minted").to.not.equal(null);
  });

  it("B. fairness pin: a blocked member contributing right after the unstick is ON TIME", async function () {
    if (!litesvmAvailable) return this.skip();
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
    if (!litesvmAvailable) return this.skip();
    // Remaining cycle-1 contributions land inside the re-anchored window.
    await contribute(env, { pool, member: m0, cycle: 1, schemaId: ATTESTATION_SCHEMA.Payment });
    await contribute(env, { pool, member: m2, cycle: 1, schemaId: ATTESTATION_SCHEMA.Payment });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = (await fetchPool(env, pool.pool)) as any;
    const deadline1 = BigInt(before.nextCycleAt.toString());

    // The cycle-1 contemplated self-claims WELL BEFORE the deadline — the
    // healthy path. max(schedule, now) must pick the schedule: no drift.
    const claimTime = deadline1 - 1_000n;
    await setLitesvmUnixTs(env.svm, claimTime);
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

/**
 * SEV-054 — settle_default against a REAL (viability-constrained) pool,
 * mid-pool default. litesvm, CI-executed.
 *
 * The live pool7 revert this reproduces: `DebtCollateralViolation`
 * (settle_default.rs:288) on the pool's FIRST real default. Root cause:
 * the D/C invariant compared incompatible units —
 *
 *   D_init = credit_amount            (what the member can receive)
 *   D_rem  = unpaid × installment     (what they still owe in payments)
 *
 * On every CONSTRUCTIBLE pool, create_pool's viability guard forces
 * `credit ≤ members × installment × (1 − solidarity − escrow)`, i.e.
 * credit < cycles × installment ALWAYS — so a member behind early/mid
 * pool has D_rem > D_init while C_rem ≤ C_init by construction, the
 * floor `c_min = ceil(d_rem·c_init/d_init)` sits ABOVE the ceiling, and
 * settle_default is mathematically unsatisfiable exactly when defaults
 * actually happen. Nothing caught it before because every prior test
 * modeled credit ≈ cycles × installment (the bankrun boundary spec
 * mocked credit 3000 = 3×1000 — a pool create_pool would REJECT), and
 * the math crate's exhaustive cascade test proves the cascade never
 * WORSENS the ratio, not that the handler's floor is reachable.
 *
 * The fix anchors both sides in the same unit — D_init =
 * cycles_total × installment (the total contribution obligation), so
 * the floor reads "collateral must proportionally cover the REMAINING
 * obligation": at join D_rem/D_init = 1 = C/C_init, and a mid-pool
 * settle seizes down to the proportional line (partial seizure +
 * shortfall stays allowed, cascade math unchanged).
 *
 * This spec drives the REAL instruction path end-to-end on a pool the
 * program itself would create (SEV-031-viable shape: 3 × 2000 × 0.74 =
 * 4440 ≥ 2200 credit):
 *
 *   A. Two healthy cycles advance (all pay c0 → slot0 claims; members
 *      0,1 pay c1, member 2 SKIPS → slot1 claims) — member 2 is behind
 *      (paid 1 < current 2).
 *   B. Past the grace deadline, settle_default(cycle=current) SUCCEEDS:
 *      solidarity drains first, the member's escrow + stake are seized
 *      exactly down to the proportional D/C floor (closed-form asserted,
 *      not hardcoded), the uncovered shortfall is tolerated, and the
 *      member is marked defaulted (pool.defaulted_members = 1).
 *
 * Fail-first: on the pre-fix program this spec is RED with
 * DebtCollateralViolation — the exact live pool7 failure.
 *
 * Runs in the `litesvm · mpl-core path` lane via the `litesvm_*.spec.ts`
 * glob (SEV-053 lesson). Skips cleanly when build artifacts are absent.
 */

import { expect } from "chai";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";

import { ATTESTATION_SCHEMA } from "@roundfi/sdk";

import {
  claimPayout,
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
  settleDefault,
  usdc,
  type MemberHandle,
  type PoolHandle,
} from "./_harness/index.js";
import { setLitesvmUnixTs, setupLitesvmEnv, type LitesvmEnv } from "./_harness/litesvm.js";

const MEMBERS_TARGET = 3;
const CYCLES_TOTAL = 3;
const CYCLE_DURATION_SEC = 86_400;
// SEV-031-viable shape (same as the stall/sorteio specs): the ONLY kind
// of economics create_pool accepts — and the kind the old invariant
// could never settle mid-pool.
const INSTALLMENT = usdc(2_000n);
const CREDIT = usdc(2_200n);
// Lv1 stake = 50% of credit; 25% of each installment lands in member escrow.
const STAKE_INITIAL = (CREDIT * 5_000n) / 10_000n; // 1_100 USDC
const ESCROW_PER_PAYMENT = (INSTALLMENT * 2_500n) / 10_000n; // 500 USDC
// Vanilla (non-canary) grace — the CI-built roundfi_core.so default.
const GRACE_PERIOD_SECS = 604_800n;

const BASE_TS = 1_900_000_000n; // litesvm clock is manual — anchor it

const ARTIFACTS = [
  "target/idl/roundfi_core.json",
  "target/deploy/roundfi_core.so",
  "target/deploy/roundfi_reputation.so",
  "target/deploy/mpl_core.so",
].map((p) => resolve(process.cwd(), p));

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

describe("SEV-054 — settle_default on a real viability-constrained pool (litesvm)", function () {
  this.timeout(120_000);

  let env: LitesvmEnv;
  let litesvmAvailable = true;
  let usdcMint: PublicKey;

  const authority = Keypair.generate();
  const memberKps = memberKeypairs(MEMBERS_TARGET, "litesvm_sev054_settle");

  let pool: PoolHandle;
  let members: MemberHandle[] = [];

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
      installmentAmount: INSTALLMENT,
      creditAmount: CREDIT,
      cyclesTotal: CYCLES_TOTAL,
      cycleDurationSec: CYCLE_DURATION_SEC,
    });

    members = await joinMembers(env, pool, [
      { member: memberKps[0]!, reputationLevel: 1 },
      { member: memberKps[1]!, reputationLevel: 1 },
      { member: memberKps[2]!, reputationLevel: 1 },
    ]);

    for (const m of members) {
      await fundUsdc(env, usdcMint, m.wallet.publicKey, INSTALLMENT * 3n);
    }
  });

  it("A. two healthy cycles advance; member 2 falls behind (paid 1 < current 2)", async function () {
    if (!litesvmAvailable) return this.skip();

    // Cycle 0 — everyone pays; slot 0 claims → advance to cycle 1.
    for (const m of members) {
      await contribute(env, { pool, member: m, cycle: 0, schemaId: ATTESTATION_SCHEMA.Payment });
    }
    await claimPayout(env, { pool, member: members[0]!, cycle: 0 });

    // Cycle 1 — members 0 and 1 pay; member 2 SKIPS. Slot 1 claims →
    // advance to cycle 2. Member 2 is now genuinely behind, exactly the
    // pool7 defaulter shape.
    await contribute(env, {
      pool,
      member: members[0]!,
      cycle: 1,
      schemaId: ATTESTATION_SCHEMA.Payment,
    });
    await contribute(env, {
      pool,
      member: members[1]!,
      cycle: 1,
      schemaId: ATTESTATION_SCHEMA.Payment,
    });
    await claimPayout(env, { pool, member: members[1]!, cycle: 1 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await fetchPool(env, pool.pool)) as any;
    expect(p.currentCycle, "pool advanced to cycle 2").to.equal(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m2 = (await fetchMember(env, members[2]!.member)) as any;
    expect(m2.contributionsPaid, "member 2 paid only cycle 0").to.equal(1);
    expect(m2.defaulted).to.equal(false);
  });

  it("B. past grace, settle_default SUCCEEDS with a proportional partial seizure", async function () {
    if (!litesvmAvailable) return this.skip();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = (await fetchPool(env, pool.pool)) as any;
    const nextCycleAt = BigInt(before.nextCycleAt.toString());
    const solidarityBefore = BigInt(before.solidarityBalance.toString());
    // 5 contributions × 1% of 2_000 = 100 USDC in solidarity.
    expect(solidarityBefore).to.equal((INSTALLMENT * 100n * 5n) / 10_000n);

    await setLitesvmUnixTs(env.svm, nextCycleAt + GRACE_PERIOD_SECS + 5n);

    // The exact live pool7 call: cycle == pool.current_cycle (2), member
    // behind by one contribution. Pre-fix program: reverts
    // DebtCollateralViolation here (the fail-first RED).
    await settleDefault(env, { pool, defaulter: members[2]!, cycle: 2 });

    // ─── Closed-form expectations (computed, not hardcoded) ─────────────
    // D anchors in INSTALLMENT units on both sides (the SEV-054 fix):
    const dInit = BigInt(CYCLES_TOTAL) * INSTALLMENT; // 6_000
    const dRem = BigInt(CYCLES_TOTAL - 1) * INSTALLMENT; // paid 1 → 4_000
    const cInit = STAKE_INITIAL + ESCROW_PER_PAYMENT; // 1_600
    const cMin = ceilDiv(dRem * cInit, dInit); // proportional floor
    const maxSeizableFromMember = cInit - cMin;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m2 = (await fetchMember(env, members[2]!.member)) as any;
    expect(m2.defaulted, "member marked defaulted").to.equal(true);

    const escrowAfter = BigInt(m2.escrowBalance.toString());
    const stakeAfter = BigInt(m2.stakeDeposited.toString());
    const cAfter = escrowAfter + stakeAfter;

    // Solidarity (100) covers only part of the missed installment
    // (2_000); the member-side seizure is capped at the proportional
    // floor — escrow drains fully (500 ≤ cap), stake tops up to the cap.
    expect(escrowAfter, "escrow fully seized (within the floor cap)").to.equal(0n);
    expect(cAfter, "collateral seized exactly down to the D/C floor").to.equal(cMin);
    expect(STAKE_INITIAL - stakeAfter, "stake seized = cap − escrow part").to.equal(
      maxSeizableFromMember - ESCROW_PER_PAYMENT,
    );

    // Invariant holds post-seizure with the consistent anchor.
    expect(dRem * cInit <= cAfter * dInit, "D/C invariant holds after settle").to.equal(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = (await fetchPool(env, pool.pool)) as any;
    expect(after.defaultedMembers, "pool counts the default").to.equal(1);
    expect(
      BigInt(after.solidarityBalance.toString()),
      "solidarity drained FIRST (Shield 1)",
    ).to.equal(0n);
  });
});

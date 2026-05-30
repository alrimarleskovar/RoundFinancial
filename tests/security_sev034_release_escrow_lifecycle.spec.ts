/**
 * SEV-034 regression — release_escrow correctness under realistic
 * contribute / release interleaved lifecycle.
 *
 * **Why this test exists** (auditor's W4 process recommendation):
 *
 * The SEV-029 fix shipped with 4 unit tests + 2 proptest invariants in
 * `crates/math/src/escrow_vesting.rs`. Those tests passed and CI was
 * green — yet the on-chain code was still broken. The W4 pre-audit
 * surfaced SEV-034: the SEV-029 derivation
 *
 *   total_already_paid = stake_deposited - escrow_balance
 *
 * is wrong because `contribute()` increments `escrow_balance` between
 * releases. The pure-math simulator did not model `contribute()`, so
 * the broken derivation looked correct in tests.
 *
 * The auditor's process rule: *pure-math simulators prove function
 * properties, NOT on-chain behavior. Critical/High fixes need
 * integration-level tests (bankrun, anchor ts-mocha against localnet).*
 *
 * This spec is the integration test that would have caught SEV-034.
 * It exercises the **realistic lifecycle**: contribute → release →
 * contribute → release → ... — with releases at every intermediate
 * checkpoint, the exact pattern that triggers the bug.
 *
 * **Why it would have caught SEV-034**: replaying the auditor's trace
 * (stake=750 USDC, 3 cycles, 25% escrow_bps) on the SEV-029 code,
 * release(chk=2) returns 500 (should be 250) and release(chk=3) returns
 * 750 (should be 250). Total received: 1500 vs stake 750 — assertion
 * `walletDelta == STAKE_BASE / CYCLES_TOTAL` fails loudly on chk=2.
 *
 * **Difference from `edge_tiny_lifecycle.spec.ts`**: that spec walks
 * ALL contributes first, THEN all releases at checkpoint=cycles_total.
 * In that pattern `escrow_balance` only grows during contribute (never
 * decremented before final release), so the broken SEV-029 derivation
 * happens to produce correct results (saturating_sub gives 0 because
 * escrow_balance > stake_deposited; cumulative_paid = 0 IS correct
 * because no prior releases). The bug only manifests when releases
 * happen *between* contributes — which is the realistic lifecycle.
 *
 * **Note on harness**: this is a bankrun spec (same harness as
 * `security_lifecycle.spec.ts`). bankrun is upstream-blocked from CI
 * (SEV-012 — mpl-core 0.8 → Anchor 0.31 borsh compat, tracked in
 * #319). The test runs locally via `pnpm test`. When SEV-012 unblocks,
 * this spec automatically enters the CI lane.
 */

import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
  balanceOf,
  claimPayout,
  contribute,
  createPool,
  createUsdcMint,
  fetchMember,
  fundUsdc,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  memberKeypairs,
  releaseEscrow,
  usdc,
  type Env,
  type MemberHandle,
  type PoolHandle,
} from "./_harness/index.js";
import { setupBankrunEnvCompat } from "./_harness/bankrun_compat.js";

// ─── Pool shape ─────────────────────────────────────────────────────────
//
// Auditor's disclosed scenario uses stake=750 USDC, cycles=3, installment=
// 1000 USDC. We mirror it. SEV-038 tightened `cycles_total >=
// members_target` to `==`, so a 3-cycle pool needs exactly 3 members
// (one slot rotation per cycle, every member claims once).
//
// The SEV-034 math doesn't depend on member count — VEST_PER_CHECKPOINT
// is `stake/cycles` regardless. The lifecycle loop drives `handles[0]`
// through contribute → claim (at cycle 0, slot owner = handles[0]) →
// release, then contribute → claim (cycle 1, slot owner = handles[1])
// → release, etc.

const MEMBERS_TARGET = 3;
const CYCLES_TOTAL = 3;
// MIN_CYCLE_DURATION on-chain is 86_400s (1 day) — SEV-023 reverted the
// devnet 60s patch. The lifecycle here doesn't rely on wall-clock
// progression: `contribute()` only gates on `args.cycle ==
// pool.current_cycle`, and `claim_payout` is what bumps current_cycle.
// We pick the floor value so create_pool validation passes; the test
// still finishes in seconds.
const CYCLE_DURATION_SEC = 86_400;

// L1 = 50% stake. credit=1500 → stake=750 (matches auditor trace).
const LEVEL: 1 | 2 | 3 = 1;
const STAKE_BPS = 5_000;

const INSTALLMENT_BASE = usdc(1_000n); // 1_000_000_000
const CREDIT_BASE = usdc(1_500n); // 1_500_000_000
const STAKE_BASE = (CREDIT_BASE * BigInt(STAKE_BPS)) / 10_000n; // 750_000_000

// Installment split (solidarity=100 bps, escrow=2_500 bps):
const SOLIDARITY_PER_INST = (INSTALLMENT_BASE * 100n) / 10_000n; //   10_000_000
const ESCROW_PER_INST = (INSTALLMENT_BASE * 2_500n) / 10_000n; //  250_000_000
const POOL_FLOAT_PER_INST = INSTALLMENT_BASE - SOLIDARITY_PER_INST - ESCROW_PER_INST;

// Per-checkpoint vesting: stake / cycles. The vesting is linear floor;
// for stake=750 USDC and cycles=3 it divides cleanly to 250 USDC per chk.
const VEST_PER_CHECKPOINT = STAKE_BASE / BigInt(CYCLES_TOTAL); // 250_000_000

// ─── Spec ───────────────────────────────────────────────────────────────

describe("SEV-034 — release_escrow under interleaved contribute/release lifecycle", function () {
  this.timeout(120_000);

  let env: Env;
  let usdcMint: PublicKey;
  const authority = Keypair.generate();
  const members: Keypair[] = memberKeypairs(MEMBERS_TARGET, "sev_034_lifecycle");
  let pool: PoolHandle;
  let handles: MemberHandle[];

  before(async function () {
    // Item L: bankrun-native via the Env-compat wrapper. Same helper
    // surface as `setupEnv()` (localnet), but each run starts from a
    // pristine in-memory state — no validator reset needed, no
    // accumulating reputation-cooldown / config-singleton pollution
    // across runs. Closes the "spec passes in isolation, fails in
    // batch" mode the localnet SEV-034 spec exhibited.
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

    handles = await joinMembers(
      env,
      pool,
      members.map((m) => ({ member: m, reputationLevel: LEVEL })),
    );
    for (const m of members) {
      // Top up enough USDC for every cycle's installment.
      await fundUsdc(env, usdcMint, m.publicKey, BigInt(CYCLES_TOTAL) * INSTALLMENT_BASE);
    }
  });

  /**
   * Walk the lifecycle for a single member, asserting every release
   * returns the correct linear-vest delta. The test fixates on
   * `handles[0]` (slot 0 → claims at cycle 0) so we can independently
   * track its escrow_balance + wallet without slot-rotation noise.
   *
   * For each cycle c in 0..CYCLES_TOTAL:
   *   1. ALL members contribute (advances pool.current_cycle implicitly
   *      via claim_payout below).
   *   2. The slot-c member claims payout (rotates current_cycle).
   *   3. handles[0] calls release_escrow(checkpoint = c+1) and we
   *      assert wallet delta == VEST_PER_CHECKPOINT.
   *
   * Pre-SEV-034 trace for handles[0] (stake=750, cycles=3):
   *   c0 contribute(+250 escrow): esc_bal = 750 + 250 = 1000
   *   release(chk=1): broken derivation paid_so_far=sat_sub(750,1000)=0
   *                   delta_target = vested(1) - 0 = 250  ✓
   *                   esc_bal -> 750
   *   c1 contribute(+250 escrow): esc_bal = 1000
   *   release(chk=2): broken derivation paid_so_far=0 (sat_sub again)
   *                   delta_target = vested(2) - 0 = 500  ✗ (should be 250)
   *                   This is where assertion would fail loudly.
   *
   * Post-SEV-034 trace for handles[0]:
   *   c0 contribute: ever_dep=750+250=1000  esc_bal=1000  paid_derived=0
   *   release(chk=1): vested(1)=250, owed=250-0=250, delta=250 ✓
   *                   esc_bal -> 750  ever_dep=1000  paid_derived=250
   *   c1 contribute: ever_dep=1250  esc_bal=1000  paid_derived=250
   *   release(chk=2): vested(2)=500, owed=500-250=250, delta=250 ✓
   *                   esc_bal -> 750  paid_derived=500
   *   c2 contribute: ever_dep=1500  esc_bal=1000  paid_derived=500
   *   release(chk=3): vested(3)=750, owed=750-500=250, delta=250 ✓
   *                   esc_bal -> 750  paid_derived=750
   *
   *   Total received via release: 750 = stake. No overpay.
   */
  it("interleaved contribute/release returns exactly stake/cycles per call (SEV-034 fix)", async function () {
    const subject = handles[0]!;
    const subjectWalletStart = await balanceOf(env, subject.memberUsdc);

    let totalReleased = 0n;

    for (let cycle = 0; cycle < CYCLES_TOTAL; cycle++) {
      // 1. Every member contributes for this cycle.
      for (const h of handles) {
        await contribute(env, { pool, member: h, cycle });
      }

      // 2. Slot-c member claims payout — advances pool.current_cycle to
      //    cycle+1 (or flips status to Completed at the final cycle).
      const slotOwner = handles[cycle % MEMBERS_TARGET]!;
      await claimPayout(env, { pool, member: slotOwner, cycle });

      // 3. The subject (handles[0]) releases the just-vested checkpoint.
      //    On every cycle, the subject has paid `cycle+1` installments
      //    (on_time_count == cycle+1), so release(chk=cycle+1) clears
      //    the on-time gate.
      const checkpoint = cycle + 1;
      const walletBefore = await balanceOf(env, subject.memberUsdc);
      await releaseEscrow(env, { pool, member: subject, checkpoint });
      const walletAfter = await balanceOf(env, subject.memberUsdc);
      const delta = walletAfter - walletBefore;

      // **The SEV-034 assertion.** Pre-fix: chk=2 returns 500 (overpay
      // 250), chk=3 returns 750 (overpay 500). Post-fix: every release
      // returns exactly 250 = STAKE_BASE / CYCLES_TOTAL.
      expect(
        delta,
        `SEV-034: release(chk=${checkpoint}) must return exactly ${VEST_PER_CHECKPOINT} ` +
          `(stake/cycles); got ${delta}. Pre-fix this overpaid because the ` +
          `(stake_deposited - escrow_balance) derivation ignores contribute() ` +
          `incrementing escrow_balance between releases.`,
      ).to.equal(VEST_PER_CHECKPOINT);

      totalReleased += delta;

      // Member account state matches the derivation.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ms = (await fetchMember(env, subject.member)) as any;
      expect(
        ms.lastReleasedCheckpoint,
        `last_released_checkpoint must advance to ${checkpoint}`,
      ).to.equal(checkpoint);
    }

    // **Conservation property.** Total released across the lifecycle
    // must equal the stake exactly. Pre-SEV-034 this would have been
    // 250 + 500 + 750 = 1500 = 2× stake. Post-fix it's exactly stake.
    expect(
      totalReleased,
      `SEV-034 conservation: sum of release deltas (${totalReleased}) must equal stake (${STAKE_BASE})`,
    ).to.equal(STAKE_BASE);

    const subjectWalletEnd = await balanceOf(env, subject.memberUsdc);
    const walletGain = subjectWalletEnd - subjectWalletStart;
    // Net wallet change between `subjectWalletStart` (captured right after
    // `before` block — post-join, post-fundUsdc) and end of lifecycle:
    //
    //   Inflows:  stake released  (3 × 250 = STAKE_BASE)
    //             credit received (CREDIT_BASE; subject is slot 0 owner)
    //   Outflows: 3 × installment (INSTALLMENT_BASE × CYCLES_TOTAL)
    //
    //   Net = STAKE_BASE + CREDIT_BASE − INSTALLMENT_BASE × CYCLES_TOTAL
    //       = 750 + 1500 − 3000 = −750 USDC
    //
    // The negative net is expected: the subject's role as a borrower (paid
    // 3000 in installments to receive 1500 credit upfront + 750 stake back)
    // is a one-cycle credit advance, not a profit position. The pool
    // "earns" 750 (= installment × cycles − credit − stake) as solidarity
    // float + pool float, which funds the spread between credit and stake.
    const expectedNetGain = STAKE_BASE + CREDIT_BASE - INSTALLMENT_BASE * BigInt(CYCLES_TOTAL);
    expect(
      walletGain,
      `subject wallet net gain = stake released + credit received − contributions paid`,
    ).to.equal(expectedNetGain);
  });

  /**
   * Per-call ledger sanity. After the lifecycle above, member.escrow_balance
   * should hold exactly the accumulated escrow contributions (the
   * stake portion was released; the per-cycle escrow_per_inst deposits
   * remain in the vault and on the member's books).
   *
   * For our subject:
   *   stake released:                 750 USDC
   *   escrow contributions remaining: 3 × 250 = 750 USDC
   *   member.escrow_balance:          750 USDC (just the contributions)
   *
   * The pool-side total_escrow_deposited tracks this monotonically;
   * the difference (ever_deposited - escrow_balance) at end = 750
   * confirms cumulative_paid == stake. This is the on-chain invariant
   * the SEV-034 derivation relies on.
   */
  it("post-lifecycle member.escrow_balance equals accumulated contribute deposits", async function () {
    const subject = handles[0]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ms = (await fetchMember(env, subject.member)) as any;
    const subjectEscrowBalance = BigInt(ms.escrowBalance.toString());
    const subjectStakeInitial = BigInt(ms.stakeDepositedInitial.toString());
    const subjectTotalEscrowDeposited = BigInt(ms.totalEscrowDeposited.toString());

    // Conservation: ever_deposited - escrow_balance == cumulative released
    const everDeposited = subjectStakeInitial + subjectTotalEscrowDeposited;
    const derivedReleased = everDeposited - subjectEscrowBalance;
    expect(
      derivedReleased,
      `derived total_released = (stake_initial + total_escrow_deposited - escrow_balance) must equal stake (${STAKE_BASE})`,
    ).to.equal(STAKE_BASE);

    // Remaining balance is the accumulated escrow contributions.
    expect(
      subjectEscrowBalance,
      `member.escrow_balance after full lifecycle = sum of per-cycle escrow contributions`,
    ).to.equal(BigInt(CYCLES_TOTAL) * ESCROW_PER_INST);
  });
});

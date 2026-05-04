/**
 * Edge — degenerate pool shapes (Step 5f / 3).
 *
 * Boundary cases on the pool dimensions. `create_pool` already rejects
 * invalid shapes (cycles_total > 0, cycle_duration >= MIN, etc.), but
 * the smallest legal shapes still have non-trivial interactions —
 * the seed-draw check triggers even for a 2-member pool, the payout
 * loop collapses to a single tick when cycles_total == 1, and
 * claim_payout's "slot_index == current_cycle" guard has to work at
 * the very last tick without off-by-one on the transition to
 * `PoolStatus::Completed`.
 *
 * Scenarios:
 *
 *   A. cycles_total = 1 — the 1-cycle pool
 *      A.1 pool validly created with cycles_total=1, members_target=2
 *      A.2 both members contribute at cycle 0
 *      A.3 slot 0 claims → pool transitions Active→Completed in ONE
 *          payout (current_cycle stays at 0; status flips to Completed)
 *      A.4 slot 1 CANNOT claim — pool is Completed, PoolNotActive
 *
 *   B. Minimal 2×2 pool — smallest "real" ROSCA
 *      B.1 2 members, 2 cycles, each member claims their slot
 *      B.2 pool_vault drains through the two credit payouts; escrow
 *          still holds both members' stake-like deposits
 *      B.3 pool reaches Completed after the second claim
 *
 *   C. Seed-draw inclusive boundary
 *      C.1 at cycle 0, a 2-member pool must retain ≥ 91.6% of
 *          (members_target × installment). With the default split
 *          (solidarity=1%, escrow=25%, pool_float=74%), retained is
 *          (pool_float + escrow) = 99% > 91.6% — so claim_payout
 *          succeeds. This pins the inclusive `>=` behavior from the
 *          client side; exact-at-floor equality is pinned by the
 *          Rust unit tests in `math/seed_draw.rs`.
 *
 * Each scenario owns an independent pool (separate seedId) so a
 * failure in one doesn't taint the others.
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
  fetchPool,
  fundUsdc,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  memberKeypairs,
  setupEnv,
  usdc,
  type Env,
  type MemberHandle,
  type PoolHandle,
} from "./_harness/index.js";

// ─── Shared pool defaults ─────────────────────────────────────────────

const CYCLE_DURATION_SEC = 60;
const INSTALLMENT_BASE = usdc(1_000n);
// credit_amount = 1.48 × installment — large enough to exceed the
// seed-draw floor (1.832 × installment ÷ 2 members = 0.916 × installment)
// comfortably while still < pool_float_per_cycle × members.
// Actually: seed-draw floor at 2 members × I × 91.6% = 1.832I.
// Pool retained after cycle-0 contribute = (0.74 + 0.25) × 2I = 1.98I.
// Credit spendable cap = pool_float_per_cycle × 2 = 1.48I.
const CREDIT_BASE = usdc(1_480n);

// Installment split (solidarity=100bps, escrow=2500bps):
const SOLIDARITY_PER_INST = (INSTALLMENT_BASE * 100n) / 10_000n; //  10_000_000
const ESCROW_PER_INST = (INSTALLMENT_BASE * 2_500n) / 10_000n; // 250_000_000
const POOL_FLOAT_PER_INST = INSTALLMENT_BASE - SOLIDARITY_PER_INST - ESCROW_PER_INST;

// Loose getters.

function bn(x: { toString(): string }): bigint {
  return BigInt(x.toString());
}

// ─── Spec ─────────────────────────────────────────────────────────────

describe("edge — degenerate pool shapes", function () {
  this.timeout(180_000);

  let env: Env;
  let usdcMint: PublicKey;

  before(async function () {
    env = await setupEnv();
    usdcMint = await createUsdcMint(env);
    await initializeProtocol(env, { usdcMint });
    await initializeReputation(env, { coreProgram: env.ids.core });
  });

  // ─── A. cycles_total = 1 ──────────────────────────────────────────

  describe("A. cycles_total = 1 (one-shot pool)", function () {
    const authority = Keypair.generate();
    const [m0, m1] = memberKeypairs(2, "edge_deg_A") as [Keypair, Keypair];

    let pool: PoolHandle;
    let mh0: MemberHandle;
    let mh1: MemberHandle;

    it("accepts cycles_total=1 and activates with 2 members", async function () {
      pool = await createPool(env, {
        authority,
        usdcMint,
        membersTarget: 2,
        installmentAmount: INSTALLMENT_BASE,
        creditAmount: CREDIT_BASE,
        cyclesTotal: 1,
        cycleDurationSec: CYCLE_DURATION_SEC,
      });
      const handles = await joinMembers(env, pool, [
        { member: m0, reputationLevel: 1 },
        { member: m1, reputationLevel: 1 },
      ]);
      mh0 = handles[0]!;
      mh1 = handles[1]!;

      // Fund each member for one contribution (stakes already moved at join).
      await fundUsdc(env, usdcMint, mh0.wallet.publicKey, INSTALLMENT_BASE);
      await fundUsdc(env, usdcMint, mh1.wallet.publicKey, INSTALLMENT_BASE);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (await fetchPool(env, pool.pool)) as any;
      expect(p.status).to.equal(1); // Active
      expect(p.cyclesTotal).to.equal(1);
      expect(p.currentCycle).to.equal(0);
    });

    it("both members contribute at the single cycle 0", async function () {
      await contribute(env, { pool, member: mh0, cycle: 0 });
      await contribute(env, { pool, member: mh1, cycle: 0 });

      const poolFloat = await balanceOf(env, pool.poolUsdcVault);
      const escrow = await balanceOf(env, pool.escrowVault);
      const solidarity = await balanceOf(env, pool.solidarityVault);

      expect(poolFloat).to.equal(2n * POOL_FLOAT_PER_INST);
      expect(escrow).to.equal(2n * ESCROW_PER_INST + mh0.stakeAmount + mh1.stakeAmount);
      expect(solidarity).to.equal(2n * SOLIDARITY_PER_INST);
    });

    it("slot 0 claims — pool flips Active → Completed in one shot", async function () {
      await claimPayout(env, { pool, member: mh0, cycle: 0 });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (await fetchPool(env, pool.pool)) as any;
      // current_cycle stays at 0 (claim_payout only advances when
      // next_cycle < cycles_total; here next_cycle=1 == cycles_total=1
      // so the pool flips Completed without advancing the counter).
      expect(p.currentCycle).to.equal(0);
      expect(p.status).to.equal(2); // Completed

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (await fetchMember(env, mh0.member)) as any;
      expect(m.paidOut).to.equal(true);
      expect(bn(m.totalReceived)).to.equal(CREDIT_BASE);
    });

    it("slot 1 CANNOT claim post-completion — PoolNotActive", async function () {
      let caught: Error | null = null;
      try {
        await claimPayout(env, { pool, member: mh1, cycle: 0 });
      } catch (e) {
        caught = e as Error;
      }
      expect(caught, "slot 1 claim on Completed pool should revert").to.not.be.null;
      expect(caught!.message).to.match(/PoolNotActive|not.*active/i);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (await fetchMember(env, mh1.member)) as any;
      expect(m.paidOut).to.equal(false); // no state leak
    });
  });

  // ─── B. Minimal 2×2 pool ──────────────────────────────────────────

  describe("B. minimal 2×2 pool (2 members, 2 cycles)", function () {
    const authority = Keypair.generate();
    const [m0, m1] = memberKeypairs(2, "edge_deg_B") as [Keypair, Keypair];

    let pool: PoolHandle;
    let mh0: MemberHandle;
    let mh1: MemberHandle;

    it("setup: activate, fund, run cycle 0 (slot 0 payout)", async function () {
      pool = await createPool(env, {
        authority,
        usdcMint,
        membersTarget: 2,
        installmentAmount: INSTALLMENT_BASE,
        creditAmount: CREDIT_BASE,
        cyclesTotal: 2,
        cycleDurationSec: CYCLE_DURATION_SEC,
      });
      const handles = await joinMembers(env, pool, [
        { member: m0, reputationLevel: 1 },
        { member: m1, reputationLevel: 1 },
      ]);
      mh0 = handles[0]!;
      mh1 = handles[1]!;

      // Fund both wallets for TWO contributions each.
      await fundUsdc(env, usdcMint, mh0.wallet.publicKey, 2n * INSTALLMENT_BASE);
      await fundUsdc(env, usdcMint, mh1.wallet.publicKey, 2n * INSTALLMENT_BASE);

      await contribute(env, { pool, member: mh0, cycle: 0 });
      await contribute(env, { pool, member: mh1, cycle: 0 });
      await claimPayout(env, { pool, member: mh0, cycle: 0 });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (await fetchPool(env, pool.pool)) as any;
      expect(p.status).to.equal(1); // still Active
      expect(p.currentCycle).to.equal(1);
      expect(bn(p.totalPaidOut)).to.equal(CREDIT_BASE);
    });

    it("cycle 1: slot 1 contributes + claims, pool completes", async function () {
      await contribute(env, { pool, member: mh0, cycle: 1 });
      await contribute(env, { pool, member: mh1, cycle: 1 });

      // Slot 1 payout — monotonicity check: current_cycle==1, slot==1.
      await claimPayout(env, { pool, member: mh1, cycle: 1 });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (await fetchPool(env, pool.pool)) as any;
      expect(p.status).to.equal(2); // Completed
      // current_cycle never advances past the last cycle index.
      expect(p.currentCycle).to.equal(1);
      expect(bn(p.totalPaidOut)).to.equal(2n * CREDIT_BASE);

      // Both members marked paid_out; escrow vault still holds deposits.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m0s = (await fetchMember(env, mh0.member)) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m1s = (await fetchMember(env, mh1.member)) as any;
      expect(m0s.paidOut).to.equal(true);
      expect(m1s.paidOut).to.equal(true);

      const escrow = await balanceOf(env, pool.escrowVault);
      // 2 members × stake + 2 members × 2 cycles × escrow_per_inst.
      expect(escrow).to.equal(mh0.stakeAmount + mh1.stakeAmount + 4n * ESCROW_PER_INST);
    });
  });

  // ─── C. Seed-draw inclusive boundary ──────────────────────────────

  describe("C. seed-draw inclusive boundary", function () {
    const authority = Keypair.generate();
    const [m0, m1] = memberKeypairs(2, "edge_deg_C") as [Keypair, Keypair];

    let pool: PoolHandle;
    let mh0: MemberHandle;
    let mh1: MemberHandle;

    it("2-member cycle 0 claim passes the 91.6% retained-balance floor", async function () {
      pool = await createPool(env, {
        authority,
        usdcMint,
        membersTarget: 2,
        installmentAmount: INSTALLMENT_BASE,
        creditAmount: CREDIT_BASE,
        cyclesTotal: 2,
        cycleDurationSec: CYCLE_DURATION_SEC,
      });
      const handles = await joinMembers(env, pool, [
        { member: m0, reputationLevel: 1 },
        { member: m1, reputationLevel: 1 },
      ]);
      mh0 = handles[0]!;
      mh1 = handles[1]!;
      await fundUsdc(env, usdcMint, mh0.wallet.publicKey, INSTALLMENT_BASE);
      await fundUsdc(env, usdcMint, mh1.wallet.publicKey, INSTALLMENT_BASE);

      await contribute(env, { pool, member: mh0, cycle: 0 });
      await contribute(env, { pool, member: mh1, cycle: 0 });

      // Compute the seed-draw floor exactly as the on-chain handler does:
      // floor = members_target × installment × SEED_DRAW_BPS / 10_000.
      const SEED_DRAW_BPS = 9_160n;
      const floor = (2n * INSTALLMENT_BASE * SEED_DRAW_BPS) / 10_000n;

      // Retained = pool_usdc_vault.amount + pool.escrow_balance
      // (per claim_payout.rs line 102). Note the ON-CHAIN pool.escrow_balance
      // does NOT include stake — only escrow deposits. Stake sits in the
      // escrow vault *token* balance but is separately tracked via
      // member.stake_deposited. So retained here = pool_float + 2×escrow_per_inst.
      const poolFloat = await balanceOf(env, pool.poolUsdcVault);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (await fetchPool(env, pool.pool)) as any;
      const retained = poolFloat + bn(p.escrowBalance);
      // Chai v4's `.greaterThanOrEqual` doesn't accept bigint; compare
      // via boolean coercion so the bigint precision is preserved.
      expect(retained >= floor, `retained ${retained} < floor ${floor}`).to.equal(true);

      // With pool_float = 2 × 0.74 × I = 1.48I and escrow_balance =
      // 2 × 0.25 × I = 0.5I, retained = 1.98I. Floor = 1.832I. Margin 0.148I.
      const expectedMargin = retained - floor;
      expect(expectedMargin > 0n, `margin ${expectedMargin} not positive`).to.equal(true);

      // And claim_payout actually succeeds (this is the thing seed-draw
      // would block if retained < floor).
      await claimPayout(env, { pool, member: mh0, cycle: 0 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mAfter = (await fetchMember(env, mh0.member)) as any;
      expect(mAfter.paidOut).to.equal(true);
    });
  });
});

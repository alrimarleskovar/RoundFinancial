/**
 * Edge — tiny 3×3 full lifecycle reconciliation (Step 5f / 4).
 *
 * The `lifecycle.spec.ts` sibling uses a 4-member / 4-cycle pool with
 * a yield splice. This spec keeps the same end-to-end coverage but
 * at the smallest shape that still exercises the non-trivial cycle
 * loop (≥2 cycles) and the per-slot payout rotation. Goals:
 *
 *   1. Walk a 3-member / 3-cycle pool from Forming → Active → Completed
 *      with zero yield ops — pure contribution / payout / escrow flow.
 *   2. Assert `release_escrow` at `checkpoint = cycles_total` fully
 *      drains every member's stake (no rounding dust — see
 *      `escrow_vesting::cumulative_vested` final-case).
 *   3. Assert `close_pool` succeeds with `defaulted_members == 0`
 *      (the non-stake escrow contributions remain in the vault;
 *      close_pool doesn't require the escrow vault to be empty —
 *      only `escrow_balance == 0 || defaulted_members == 0`).
 *   4. Balance reconciliation: sum of every touched token account
 *      at end of run == total USDC minted at setup. No stray units,
 *      no double-accounting between stake / escrow / pool float.
 *
 * Pool shape (3 members, 3 cycles, Level-1 @ 50 % stake):
 *
 *   installment      = 1 000 USDC  →   1_000_000_000 base
 *   credit_amount    = 2 200 USDC  →   2_200_000_000 base
 *   stake            = 1 100 USDC  per member (50 % of credit)
 *
 *   per installment:   solidarity=10, escrow=250, pool_float=740  (USDC)
 *   per cycle into pool_vault:  3×740 – 2 200 =  +20 USDC
 *   seed-draw floor at cycle 0: 3 × 1 000 × 91.6 % = 2 748   USDC
 *   retained at cycle 0:        3 × (740 + 250)   = 2 970    USDC ✓
 *
 * Conservation accounting at close (base units):
 *
 *   minted = M×stake + M×C×installment = 3×1 100 + 3×3×1 000 = 12 300 USDC
 *
 *   end-of-run buckets:
 *     pool_vault        C × +20                          =    60 USDC
 *     solidarity_vault  M × C × 10                       =    90 USDC
 *     escrow_vault      M × C × 250   (stakes released)  = 2 250 USDC
 *     member wallets    M × (credit + stake)             = 9 900 USDC
 *                                                        ────────────
 *                                                         12 300 USDC ✓
 */

import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
  balanceOf,
  claimPayout,
  closePool,
  contribute,
  createPool,
  createUsdcMint,
  ensureAta,
  fetchMember,
  fetchPool,
  fundUsdc,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  memberKeypairs,
  releaseEscrow,
  setupEnv,
  usdc,
  type Env,
  type MemberHandle,
  type PoolHandle,
} from "./_harness/index.js";

// ─── Pool parameters (minimal non-trivial rotation) ───────────────────

const MEMBERS_TARGET = 3;
const CYCLES_TOTAL = 3;
const CYCLE_DURATION_SEC = 86_400; // MIN_CYCLE_DURATION

const LEVEL: 1 | 2 | 3 = 1; // 50 % stake
const STAKE_BPS = 5_000;

const INSTALLMENT_BASE = usdc(1_000n); // 1_000_000_000
const CREDIT_BASE = usdc(2_200n); // 2_200_000_000
const STAKE_BASE = (CREDIT_BASE * BigInt(STAKE_BPS)) / 10_000n; // 1_100_000_000

// Installment split (solidarity=100 bps, escrow=2 500 bps):
const SOLIDARITY_PER_INST = (INSTALLMENT_BASE * 100n) / 10_000n; //   10_000_000
const ESCROW_PER_INST = (INSTALLMENT_BASE * 2_500n) / 10_000n; //  250_000_000
const POOL_FLOAT_PER_INST = INSTALLMENT_BASE - SOLIDARITY_PER_INST - ESCROW_PER_INST; //  740_000_000

// ─── Helpers ──────────────────────────────────────────────────────────

function bn(x: { toString(): string }): bigint {
  return BigInt(x.toString());
}

// ─── Spec ─────────────────────────────────────────────────────────────

describe("edge — tiny 3×3 full lifecycle reconciliation", function () {
  // Tiny pool but each contribute / claim is still an RPC round-trip.
  // 60 s is ample (no real-time sleeps between cycles).
  this.timeout(120_000);

  let env: Env;
  let usdcMint: PublicKey;

  const authority = Keypair.generate();
  const members: Keypair[] = memberKeypairs(MEMBERS_TARGET, "edge_tiny_3x3");

  let pool: PoolHandle;
  let handles: MemberHandle[];

  // USDC conservation: cumulative minted during setup.
  let totalMinted = 0n;

  before(async function () {
    env = await setupEnv();
    usdcMint = await createUsdcMint(env);
    await initializeProtocol(env, { usdcMint });
    await initializeReputation(env, { coreProgram: env.ids.core });
  });

  it("creates a 3×3 pool and joins all members (auto-activates)", async function () {
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
    totalMinted += BigInt(MEMBERS_TARGET) * STAKE_BASE;

    // Top each wallet up to CYCLES_TOTAL × INSTALLMENT fresh USDC — the
    // stake they were minted in `joinMembers` is already locked in escrow.
    for (const m of members) {
      await fundUsdc(env, usdcMint, m.publicKey, BigInt(CYCLES_TOTAL) * INSTALLMENT_BASE);
    }
    totalMinted += BigInt(MEMBERS_TARGET) * BigInt(CYCLES_TOTAL) * INSTALLMENT_BASE;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await fetchPool(env, pool.pool)) as any;
    expect(p.status).to.equal(1); // Active
    expect(p.membersJoined).to.equal(MEMBERS_TARGET);
    expect(p.membersTarget).to.equal(MEMBERS_TARGET);
    expect(p.cyclesTotal).to.equal(CYCLES_TOTAL);
    expect(p.currentCycle).to.equal(0);

    // Escrow holds every stake, vault + solidarity start empty.
    expect(await balanceOf(env, pool.escrowVault)).to.equal(BigInt(MEMBERS_TARGET) * STAKE_BASE);
    expect(await balanceOf(env, pool.poolUsdcVault)).to.equal(0n);
    expect(await balanceOf(env, pool.solidarityVault)).to.equal(0n);
  });

  // ─── Walk all 3 cycles: contribute × 3 → claim by slot==cycle ────
  for (let cycle = 0; cycle < CYCLES_TOTAL; cycle++) {
    it(`cycle ${cycle}: 3 contributions + slot ${cycle} claim`, async function () {
      const poolBefore = await balanceOf(env, pool.poolUsdcVault);
      const solBefore = await balanceOf(env, pool.solidarityVault);
      const escBefore = await balanceOf(env, pool.escrowVault);

      for (const h of handles) {
        await contribute(env, { pool, member: h, cycle });
      }

      // Vault deltas match the per-cycle split exactly.
      expect((await balanceOf(env, pool.poolUsdcVault)) - poolBefore).to.equal(
        BigInt(MEMBERS_TARGET) * POOL_FLOAT_PER_INST,
      );
      expect((await balanceOf(env, pool.solidarityVault)) - solBefore).to.equal(
        BigInt(MEMBERS_TARGET) * SOLIDARITY_PER_INST,
      );
      expect((await balanceOf(env, pool.escrowVault)) - escBefore).to.equal(
        BigInt(MEMBERS_TARGET) * ESCROW_PER_INST,
      );

      // Claim: slot_index == cycle (monotonic rotation).
      const recipient = handles[cycle]!;
      const recipientBefore = await balanceOf(env, recipient.memberUsdc);
      await claimPayout(env, { pool, member: recipient, cycle });
      expect((await balanceOf(env, recipient.memberUsdc)) - recipientBefore).to.equal(CREDIT_BASE);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (await fetchPool(env, pool.pool)) as any;
      if (cycle + 1 < CYCLES_TOTAL) {
        expect(p.currentCycle).to.equal(cycle + 1);
        expect(p.status).to.equal(1); // Active
      } else {
        // On the final cycle `claim_payout` flips status to Completed
        // without advancing current_cycle past the last index.
        expect(p.currentCycle).to.equal(CYCLES_TOTAL - 1);
        expect(p.status).to.equal(2); // Completed
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ms = (await fetchMember(env, recipient.member)) as any;
      expect(ms.paidOut).to.equal(true);
    });
  }

  it("pool aggregates match hand-computed totals after 3 cycles", async function () {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await fetchPool(env, pool.pool)) as any;
    expect(p.status).to.equal(2); // Completed
    expect(bn(p.totalContributed)).to.equal(
      BigInt(CYCLES_TOTAL) * BigInt(MEMBERS_TARGET) * INSTALLMENT_BASE,
    );
    expect(bn(p.totalPaidOut)).to.equal(BigInt(CYCLES_TOTAL) * CREDIT_BASE);
    expect(bn(p.solidarityBalance)).to.equal(
      BigInt(MEMBERS_TARGET) * BigInt(CYCLES_TOTAL) * SOLIDARITY_PER_INST,
    );
    // pool.escrow_balance tracks stake + escrow contributions — stakes
    // not yet released.
    expect(bn(p.escrowBalance)).to.equal(
      BigInt(MEMBERS_TARGET) * STAKE_BASE +
        BigInt(MEMBERS_TARGET) * BigInt(CYCLES_TOTAL) * ESCROW_PER_INST,
    );

    // Every member contributed every cycle on-time and was paid once.
    for (const h of handles) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ms = (await fetchMember(env, h.member)) as any;
      expect(ms.contributionsPaid).to.equal(CYCLES_TOTAL);
      expect(ms.onTimeCount).to.equal(CYCLES_TOTAL);
      expect(ms.lateCount).to.equal(0);
      expect(ms.paidOut).to.equal(true);
      expect(ms.defaulted).to.equal(false);
    }
  });

  it("release_escrow at checkpoint=cycles_total drains every stake", async function () {
    for (const h of handles) {
      const walletBefore = await balanceOf(env, h.memberUsdc);
      const escrowBefore = await balanceOf(env, pool.escrowVault);

      await releaseEscrow(env, { pool, member: h, checkpoint: CYCLES_TOTAL });

      const walletAfter = await balanceOf(env, h.memberUsdc);
      const escrowAfter = await balanceOf(env, pool.escrowVault);

      // `cumulative_vested` at the terminal checkpoint returns exactly
      // `principal` — so the delta equals the full stake with zero dust.
      expect(walletAfter - walletBefore).to.equal(STAKE_BASE);
      expect(escrowBefore - escrowAfter).to.equal(STAKE_BASE);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ms = (await fetchMember(env, h.member)) as any;
      expect(ms.lastReleasedCheckpoint).to.equal(CYCLES_TOTAL);
      // member.escrow_balance was stake + C×escrow_per_inst; release
      // drained only the stake portion — escrow contributions remain
      // in the vault and stay tracked per-member.
      expect(bn(ms.escrowBalance)).to.equal(BigInt(CYCLES_TOTAL) * ESCROW_PER_INST);
    }

    // Aggregate: every stake is gone from the escrow vault.
    expect(await balanceOf(env, pool.escrowVault)).to.equal(
      BigInt(MEMBERS_TARGET) * BigInt(CYCLES_TOTAL) * ESCROW_PER_INST,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await fetchPool(env, pool.pool)) as any;
    expect(bn(p.escrowBalance)).to.equal(
      BigInt(MEMBERS_TARGET) * BigInt(CYCLES_TOTAL) * ESCROW_PER_INST,
    );
  });

  it("close_pool succeeds (status=Closed, zero defaults)", async function () {
    // close_pool requires `defaulted_members == 0 || escrow_balance == 0`.
    // Here defaulted_members == 0, so close is allowed even though the
    // non-stake escrow portion is still resident.
    await closePool(env, { pool });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await fetchPool(env, pool.pool)) as any;
    // SEV-005 fix added a distinct terminal `Closed = 4` variant so
    // close_pool is one-shot (entry constraint = status == Completed,
    // which the flip to Closed then bars). Pre-SEV-005 the pool stayed
    // at Completed = 2 after close and could be replayed, deflating
    // `committed_protocol_tvl_usdc` per call.
    expect(p.status, "post-close status must be Closed (4), not Completed (2)").to.equal(4);
    expect(p.defaultedMembers).to.equal(0);
  });

  it("global conservation: total USDC accounted for, every base unit", async function () {
    const poolVault = await balanceOf(env, pool.poolUsdcVault);
    const escrow = await balanceOf(env, pool.escrowVault);
    const solidarity = await balanceOf(env, pool.solidarityVault);

    let memberSum = 0n;
    for (const h of handles) {
      const ata = await ensureAta(env, usdcMint, h.wallet.publicKey);
      memberSum += await balanceOf(env, ata);
    }

    const total = poolVault + escrow + solidarity + memberSum;
    expect(total).to.equal(totalMinted);

    // Strict end-state per bucket — flags any accidental re-routing of
    // solidarity / escrow splits.
    const expectedPoolVault =
      BigInt(CYCLES_TOTAL) * (BigInt(MEMBERS_TARGET) * POOL_FLOAT_PER_INST - CREDIT_BASE); //    60 USDC
    const expectedSolidarity = BigInt(MEMBERS_TARGET) * BigInt(CYCLES_TOTAL) * SOLIDARITY_PER_INST; //    90 USDC
    const expectedEscrow = BigInt(MEMBERS_TARGET) * BigInt(CYCLES_TOTAL) * ESCROW_PER_INST; // 2 250 USDC
    const expectedMemberSum = BigInt(MEMBERS_TARGET) * (CREDIT_BASE + STAKE_BASE); // 9 900 USDC

    expect(poolVault, "pool vault").to.equal(expectedPoolVault);
    expect(solidarity, "solidarity vault").to.equal(expectedSolidarity);
    expect(escrow, "escrow vault").to.equal(expectedEscrow);
    expect(memberSum, "member wallets").to.equal(expectedMemberSum);
  });
});

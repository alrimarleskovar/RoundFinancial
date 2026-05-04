/**
 * Security — economic exploits + waterfall bypass (Step 5e / 3).
 *
 * Covers adversarial use of the economic primitives — claim_payout,
 * deposit_idle_to_yield, harvest_yield — to prove that every guard
 * that protects invariants holds under attack, and that the
 * waterfall (GF → Fee → Good-Faith → Participants) is conservative
 * and monotone under arbitrary harvest timing.
 *
 * Attacks covered:
 *
 *   A. claim_payout ordering / authorization
 *     A.1 wrong slot owner claims cycle 0 → NotYourPayoutSlot
 *     A.2 right owner claims wrong cycle (cycle=1 when pool at 0)
 *         → WrongCycle
 *     A.3 double-claim: legitimate claim succeeds, repeat tx
 *         → NotYourPayoutSlot (paid_out=true blocks re-entry)
 *     A.4 claim when vault < credit (no contributions yet)
 *         → WaterfallUnderflow
 *
 *   B. Deposit guards
 *     B.1 amount=0 → InvalidAmount
 *     B.2 amount > spendable_idle (vault=0) → InsufficientStake
 *     B.3 two sequential deposits — yield_principal_deposited
 *         increments by the exact actual-delivered amount each time
 *         (positive-path conservation)
 *
 *   C. Harvest waterfall + idempotency
 *     C.1 Realized yield → conservation holds (PDF order v1.1):
 *         fee + gf + lp_share + participants == realized,
 *         and post-tx bucket balances equal pre-tx + computed deltas.
 *     C.2 Second harvest immediately after C.1, no new prefund
 *         → realized=0, every bucket bit-identical (idempotent no-op).
 *
 *   D. Boundary values
 *     D.1 deposit(u64::MAX) → InsufficientStake (vault can't cover)
 *     D.2 deposit(1) — minimal non-zero amount accepted; principal += 1
 *
 * Fail-closed bar:
 *   - every rejection leaves pool_vault / mock_vault / treasury /
 *     solidarity / pool.guarantee_fund_balance /
 *     pool.total_protocol_fee_accrued / pool.yield_accrued /
 *     pool.yield_principal_deposited / pool.current_cycle
 *     bit-identical to the pre-attack snapshot.
 *   - every successful positive path checks the exact expected delta,
 *     not just "something happened".
 *
 * Notes:
 *   - GF-cap saturation (cap = 150% of accrued fees at default config)
 *     is exercised at cold-start in C.1: fees=0 ⇒ cap=0 ⇒ gf=0 on the
 *     first harvest. The full cap-growth curve is covered by Rust unit
 *     tests in `math::waterfall`; TS-layer re-probing buys little.
 *   - "Harvest same surplus twice" is the realized=0 branch proven in
 *     C.2 and also in `security_cpi.spec.ts` B.1 (different setup).
 *   - "Rounding dust" lives entirely inside `apply_bps`; any non-zero
 *     harvest with default fee_bps_yield=2000 / lp_share_bps=6500 tests
 *     the rounding path as a side-effect of C.1 (a 100-unit harvest
 *     leaves no residue, but the code path is identical).
 */

import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

import { FEES } from "@roundfi/sdk";

import {
  balanceOf,
  claimPayout,
  configPda,
  contribute,
  createPool,
  createUsdcMint,
  depositIdleToYield,
  ensureAta,
  fetchMember,
  fetchPool,
  fundUsdc,
  harvestYield,
  initMockVault,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  memberKeypairs,
  mintToAta,
  setupEnv,
  usdc,
  yieldMockStatePda,
  yieldMockVault,
  type Env,
  type MemberHandle,
  type PoolHandle,
} from "./_harness/index.js";

// ─── Pool parameters ──────────────────────────────────────────────────
//
// Pool E — 3 members, cycle 0 target. After all members contribute:
//   pool_float per installment  = 1_250 × (1 − fee_l2 − solidarity)
//                                ≈ 925 USDC   (identical to spec 1/2 setup)
//   pool_vault @ cycle 0        = 3 × 925     = 2_775 USDC
//   credit_amount               = 2_775        (must fit 3 × pool_float)
//   seed_draw floor at cycle 0  = 3 × 1_250 × 0.916 = 3_435 USDC
//     satisfied by pool_vault (2_775) + escrow (≈ 937) > 3_435
//
// Pool Y — 2 members, 2 cycles. No contributions. Used as a
// yield-adapter sandbox (deposit/harvest only). Pool_vault starts at
// 0; tests that need funds mint USDC directly into it.
//
const E_MEMBERS_TARGET = 3;
const E_CYCLES_TOTAL = 3;
const E_INSTALLMENT_USDC = 1_250n;
const E_CREDIT_USDC = 2_775n;
const E_LEVEL: 1 | 2 | 3 = 2;

const E_INSTALLMENT_BASE = usdc(E_INSTALLMENT_USDC);
const E_CREDIT_BASE = usdc(E_CREDIT_USDC);

const Y_MEMBERS_TARGET = 2;
const Y_CYCLES_TOTAL = 2;
const Y_INSTALLMENT_USDC = 1_000n;
const Y_CREDIT_USDC = 1_500n;
const Y_LEVEL: 1 | 2 | 3 = 2;

const Y_INSTALLMENT_BASE = usdc(Y_INSTALLMENT_USDC);
const Y_CREDIT_BASE = usdc(Y_CREDIT_USDC);

const CYCLE_DURATION_SEC = 60;

// u64::MAX — the upper bound BN can pass through Anchor's u64 layout.
const U64_MAX = (1n << 64n) - 1n;

// ─── Snapshot / assertion helpers ─────────────────────────────────────

interface PoolSnapshot {
  poolVault: bigint;
  solidarity: bigint;
  escrow: bigint;
  treasury: bigint;
  mockVault: bigint;
  gfBalance: bigint;
  solidarityBalance: bigint;
  /** v1.1: yield-waterfall LP slice earmarked on Pool. */
  lpDistribution: bigint;
  yieldAccrued: bigint;
  feeAccrued: bigint;
  principalDeposited: bigint;
  currentCycle: number;
  totalPaidOut: bigint;
}

function bn(x: { toString(): string }): bigint {
  return BigInt(x.toString());
}

async function snapshotPool(
  env: Env,
  pool: PoolHandle,
  treasury: PublicKey,
  mockVault: PublicKey,
): Promise<PoolSnapshot> {
  const [poolVault, solidarity, escrow, treasuryBal, mockBal] = await Promise.all([
    balanceOf(env, pool.poolUsdcVault),
    balanceOf(env, pool.solidarityVault),
    balanceOf(env, pool.escrowVault),
    balanceOf(env, treasury),
    balanceOf(env, mockVault),
  ]);
  const p = (await fetchPool(env, pool.pool)) as {
    currentCycle: number;
    guaranteeFundBalance: { toString(): string };
    solidarityBalance: { toString(): string };
    lpDistributionBalance: { toString(): string };
    yieldAccrued: { toString(): string };
    totalProtocolFeeAccrued: { toString(): string };
    yieldPrincipalDeposited: { toString(): string };
    totalPaidOut: { toString(): string };
  };
  return {
    poolVault,
    solidarity,
    escrow,
    treasury: treasuryBal,
    mockVault: mockBal,
    gfBalance: bn(p.guaranteeFundBalance),
    solidarityBalance: bn(p.solidarityBalance),
    lpDistribution: bn(p.lpDistributionBalance),
    yieldAccrued: bn(p.yieldAccrued),
    feeAccrued: bn(p.totalProtocolFeeAccrued),
    principalDeposited: bn(p.yieldPrincipalDeposited),
    currentCycle: p.currentCycle,
    totalPaidOut: bn(p.totalPaidOut),
  };
}

function expectPoolUnchanged(before: PoolSnapshot, after: PoolSnapshot, label: string): void {
  expect(after, `${label}: pool snapshot drift`).to.deep.equal(before);
}

async function expectRejected(thunk: () => Promise<unknown>): Promise<string> {
  try {
    await thunk();
  } catch (err) {
    return String((err as Error)?.message ?? err);
  }
  expect.fail("expected transaction to revert, but it succeeded");
  return "";
}

// Re-implementation of `math::waterfall` at the TS layer so tests can
// check the on-chain buckets exactly, not just within tolerance.
//
// Matches waterfall.rs line-for-line at default config (v1.1 PDF order):
//   step 1 fee          = yield × fee_bps / 10_000    (floor; on GROSS)
//   step 2 gf           = min(yield − fee, gf_room)
//   step 3 lp_share     = (yield − fee − gf) × lp_bps / 10_000  (floor)
//   step 4 participants = yield − fee − gf − lp_share
function computeWaterfall(
  realized: bigint,
  gfRoom: bigint,
  feeBps: bigint,
  lpShareBps: bigint,
): {
  fee: bigint;
  gf: bigint;
  lpShare: bigint;
  participants: bigint;
} {
  const fee = (realized * feeBps) / 10_000n;
  const afterFee = realized - fee;
  const gf = afterFee < gfRoom ? afterFee : gfRoom;
  const afterGf = afterFee - gf;
  const lpShare = (afterGf * lpShareBps) / 10_000n;
  const participants = afterGf - lpShare;
  return { fee, gf, lpShare, participants };
}

function computeGfRoom(feeAccrued: bigint, gfBalance: bigint, gfBps: bigint): bigint {
  // cap = fee_accrued × gf_bps / 10_000 (bps may exceed 10_000 — default 15_000).
  const cap = (feeAccrued * gfBps) / 10_000n;
  return cap > gfBalance ? cap - gfBalance : 0n;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("security — economic exploits + waterfall", function () {
  this.timeout(240_000);

  let env: Env;
  let usdcMint: PublicKey;
  let treasury: PublicKey;

  const authorityE = Keypair.generate();
  const authorityY = Keypair.generate();
  const membersE = memberKeypairs(E_MEMBERS_TARGET, "sec/econ/E");
  const membersY = memberKeypairs(Y_MEMBERS_TARGET, "sec/econ/Y");

  let poolE: PoolHandle;
  let poolY: PoolHandle;
  let handlesE: MemberHandle[];
  let handlesY: MemberHandle[];
  let mockVaultE: PublicKey;
  let mockVaultY: PublicKey;

  before(async function () {
    env = await setupEnv();
    usdcMint = await createUsdcMint(env);
    const proto = await initializeProtocol(env, { usdcMint });
    treasury = proto.treasury;
    await initializeReputation(env, { coreProgram: env.ids.core });

    // ─── Pool E ─────────────────────────────────────────────────────────
    poolE = await createPool(env, {
      authority: authorityE,
      usdcMint,
      membersTarget: E_MEMBERS_TARGET,
      installmentAmount: E_INSTALLMENT_BASE,
      creditAmount: E_CREDIT_BASE,
      cyclesTotal: E_CYCLES_TOTAL,
      cycleDurationSec: CYCLE_DURATION_SEC,
      escrowReleaseBps: 2_500,
    });
    handlesE = await joinMembers(
      env,
      poolE,
      membersE.map((m) => ({ member: m, reputationLevel: E_LEVEL })),
    );
    for (const m of membersE) {
      await fundUsdc(env, usdcMint, m.publicKey, BigInt(E_CYCLES_TOTAL) * E_INSTALLMENT_BASE);
    }
    for (const h of handlesE) {
      await contribute(env, { pool: poolE, member: h, cycle: 0 });
    }
    const initE = await initMockVault(env, poolE.pool, usdcMint);
    mockVaultE = initE.vault;

    // ─── Pool Y ─────────────────────────────────────────────────────────
    poolY = await createPool(env, {
      authority: authorityY,
      usdcMint,
      membersTarget: Y_MEMBERS_TARGET,
      installmentAmount: Y_INSTALLMENT_BASE,
      creditAmount: Y_CREDIT_BASE,
      cyclesTotal: Y_CYCLES_TOTAL,
      cycleDurationSec: CYCLE_DURATION_SEC,
      escrowReleaseBps: 2_500,
    });
    handlesY = await joinMembers(
      env,
      poolY,
      membersY.map((m) => ({ member: m, reputationLevel: Y_LEVEL })),
    );
    // Fund members so their ATAs exist (claim_payout requires
    // member_usdc.owner == member_wallet), and so A.4's attempt isn't
    // masked by an empty-ATA error before the WaterfallUnderflow check.
    for (const m of membersY) {
      await ensureAta(env, usdcMint, m.publicKey);
    }
    const initY = await initMockVault(env, poolY.pool, usdcMint);
    mockVaultY = initY.vault;
  });

  // ─── A. claim_payout guards ───────────────────────────────────────────

  it("A.1 wrong slot owner claims cycle 0 → NotYourPayoutSlot", async function () {
    // slot 0 belongs to handlesE[0]; handlesE[1] (slot 1) is not the
    // cycle-0 payout recipient. The member account exists and is not
    // defaulted — the `slot_index == cycle` guard is the one that trips.
    const intruder = handlesE[1]!;
    const before = await snapshotPool(env, poolE, treasury, mockVaultE);

    const msg = await expectRejected(() =>
      claimPayout(env, { pool: poolE, member: intruder, cycle: 0 }),
    );
    expect(msg, `A.1: ${msg}`).to.match(/NotYourPayoutSlot|slot owner/i);
    expectPoolUnchanged(before, await snapshotPool(env, poolE, treasury, mockVaultE), "A.1");
  });

  it("A.2 right owner claims wrong cycle → WrongCycle", async function () {
    const h = handlesE[0]!;
    const before = await snapshotPool(env, poolE, treasury, mockVaultE);

    const msg = await expectRejected(() => claimPayout(env, { pool: poolE, member: h, cycle: 1 }));
    expect(msg, `A.2: ${msg}`).to.match(/WrongCycle|cycle/i);
    expectPoolUnchanged(before, await snapshotPool(env, poolE, treasury, mockVaultE), "A.2");
  });

  it("A.3 double-claim: first succeeds, second rejects (paid_out)", async function () {
    const h = handlesE[0]!;
    const memberUsdcBefore = await balanceOf(env, h.memberUsdc);
    const poolVaultBefore = await balanceOf(env, poolE.poolUsdcVault);

    // First claim — must succeed. Cycle advances 0 → 1.
    await claimPayout(env, { pool: poolE, member: h, cycle: 0 });

    const memberUsdcAfter = await balanceOf(env, h.memberUsdc);
    const poolVaultAfter = await balanceOf(env, poolE.poolUsdcVault);
    const deltaMember = memberUsdcAfter - memberUsdcBefore;
    const deltaVault = poolVaultBefore - poolVaultAfter;
    expect(deltaMember, "A.3: member USDC should increase by credit").to.equal(E_CREDIT_BASE);
    expect(deltaVault, "A.3: pool vault should decrease by credit").to.equal(E_CREDIT_BASE);

    const memberRow = (await fetchMember(env, h.member)) as { paidOut: boolean };
    expect(memberRow.paidOut, "A.3: member.paid_out must be true post-claim").to.be.true;

    const poolRow = (await fetchPool(env, poolE.pool)) as { currentCycle: number };
    expect(poolRow.currentCycle, "A.3: pool advances to cycle 1").to.equal(1);

    // Second claim on the same slot — paid_out guard rejects before
    // any state mutation.
    const before = await snapshotPool(env, poolE, treasury, mockVaultE);
    const msg = await expectRejected(() => claimPayout(env, { pool: poolE, member: h, cycle: 1 }));
    // `constraint = !member.paid_out @ NotYourPayoutSlot` is the first
    // member-level guard to trip — the handler never runs.
    expect(msg, `A.3 double-claim: ${msg}`).to.match(/NotYourPayoutSlot|slot owner/i);
    expectPoolUnchanged(before, await snapshotPool(env, poolE, treasury, mockVaultE), "A.3/double");
  });

  it("A.4 claim from pool with no contributions → underfunded-pool rejection", async function () {
    // Pool Y has no contributions; pool_vault = 0, credit = 1_500 USDC.
    // Handler order at cycle 0 (claim_payout.rs):
    //   1. cycle/slot checks (pass)
    //   2. seed-draw: retained (vault+escrow) = 0 < required 1_832 USDC
    //      (2×1_000×0.916) → SeedDrawShortfall fires HERE, first
    //   3. spendable < credit → WaterfallUnderflow (unreached given #2)
    // Either rejection is fail-closed against an attempt to extract
    // credit from an unfunded pool. Match both.
    const h = handlesY[0]!;
    const before = await snapshotPool(env, poolY, treasury, mockVaultY);

    const msg = await expectRejected(() => claimPayout(env, { pool: poolY, member: h, cycle: 0 }));
    expect(msg, `A.4: ${msg}`).to.match(/WaterfallUnderflow|SeedDrawShortfall|underflow|seed/i);
    expectPoolUnchanged(before, await snapshotPool(env, poolY, treasury, mockVaultY), "A.4");
  });

  // ─── B. deposit_idle_to_yield guards ──────────────────────────────────

  it("B.1 deposit(amount=0) → InvalidAmount", async function () {
    const before = await snapshotPool(env, poolY, treasury, mockVaultY);

    const msg = await expectRejected(() => depositIdleToYield(env, { pool: poolY, amount: 0n }));
    expect(msg, `B.1: ${msg}`).to.match(/InvalidAmount|non-zero|amount/i);
    expectPoolUnchanged(before, await snapshotPool(env, poolY, treasury, mockVaultY), "B.1");
  });

  it("B.2 deposit(amount > spendable_idle) → InsufficientStake", async function () {
    // Pool Y vault == 0, gf == 0 ⇒ spendable_idle == 0.
    // Any positive amount trips the GF-solvency guard.
    const before = await snapshotPool(env, poolY, treasury, mockVaultY);
    expect(before.poolVault, "B.2 precondition: vault must be empty").to.equal(0n);

    const msg = await expectRejected(() => depositIdleToYield(env, { pool: poolY, amount: 1n }));
    expect(msg, `B.2: ${msg}`).to.match(/InsufficientStake|stake|below|solvency/i);
    expectPoolUnchanged(before, await snapshotPool(env, poolY, treasury, mockVaultY), "B.2");
  });

  it("B.3 two sequential deposits track principal exactly", async function () {
    // Seed pool Y's vault with exactly 2× the deposit amount. Each
    // deposit must book actual src_delta into
    // pool.yield_principal_deposited — after two deposits, principal
    // equals the sum and pool_vault is drained to 0.
    const amount = usdc(50n);
    await mintToAta(env, usdcMint, poolY.poolUsdcVault, amount * 2n);

    const t0 = await snapshotPool(env, poolY, treasury, mockVaultY);
    expect(t0.poolVault, "B.3 precondition: 2× amount in vault").to.equal(amount * 2n);

    await depositIdleToYield(env, { pool: poolY, amount });
    const t1 = await snapshotPool(env, poolY, treasury, mockVaultY);
    expect(t1.poolVault, "B.3/after-1: pool_vault drained by amount").to.equal(
      t0.poolVault - amount,
    );
    expect(t1.mockVault, "B.3/after-1: mock_vault gains amount").to.equal(t0.mockVault + amount);
    expect(t1.principalDeposited, "B.3/after-1: principal += amount").to.equal(
      t0.principalDeposited + amount,
    );
    // Non-yield state must not move.
    expect(t1.gfBalance, "B.3/after-1: gf unchanged").to.equal(t0.gfBalance);
    expect(t1.feeAccrued, "B.3/after-1: fee unchanged").to.equal(t0.feeAccrued);
    expect(t1.yieldAccrued, "B.3/after-1: yield_accrued unchanged").to.equal(t0.yieldAccrued);
    expect(t1.treasury, "B.3/after-1: treasury unchanged").to.equal(t0.treasury);

    await depositIdleToYield(env, { pool: poolY, amount });
    const t2 = await snapshotPool(env, poolY, treasury, mockVaultY);
    expect(t2.poolVault, "B.3/after-2: pool_vault fully drained").to.equal(0n);
    expect(t2.mockVault, "B.3/after-2: mock_vault holds 2× amount").to.equal(
      t0.mockVault + amount * 2n,
    );
    expect(t2.principalDeposited, "B.3/after-2: principal += 2× amount").to.equal(
      t0.principalDeposited + amount * 2n,
    );
  });

  // ─── C. Harvest waterfall + idempotency ───────────────────────────────

  it("C.1 realized yield → waterfall conservation + bucket deltas", async function () {
    // Entry state (post-B.3): pool_vault=0, mock_vault=100 USDC (tracked
    // principal). Prefund 100 USDC of "yield" into the mock vault. The
    // mock's harvest() sweeps (source.amount − tracked_principal) into
    // pool_vault, i.e. realized = 100 USDC.
    const realized = usdc(100n);
    await mintToAta(env, usdcMint, mockVaultY, realized);

    const before = await snapshotPool(env, poolY, treasury, mockVaultY);

    // GF room at cold start: fee_accrued = 0 ⇒ cap = 0 ⇒ gf = 0.
    // So the entire realized amount flows fee → LP → participants
    // (GF skipped, fee runs first on gross per PDF v1.1).
    const gfRoom = computeGfRoom(
      before.feeAccrued,
      before.gfBalance,
      BigInt(FEES.guaranteeFundBps),
    );
    expect(gfRoom, "C.1 precondition: gf_room at cold start").to.equal(0n);

    const w = computeWaterfall(
      realized,
      gfRoom,
      BigInt(FEES.yieldFeeBps),
      6_500n, // default lp_share_bps in harvestYield helper
    );
    // Conservation check at the TS level — mirrors `waterfall()` require.
    expect(w.fee + w.gf + w.lpShare + w.participants, "C.1: bucket sum == realized").to.equal(
      realized,
    );

    await harvestYield(env, {
      pool: poolY,
      treasuryUsdc: treasury,
    });

    const after = await snapshotPool(env, poolY, treasury, mockVaultY);

    // On-chain bucket deltas must match the TS-computed waterfall exactly.
    expect(after.gfBalance, "C.1: gf delta").to.equal(before.gfBalance + w.gf);
    expect(after.feeAccrued, "C.1: fee delta").to.equal(before.feeAccrued + w.fee);
    expect(after.treasury, "C.1: treasury delta").to.equal(before.treasury + w.fee);
    // Solidarity vault is no longer credited from yield (v1.1) — Cofre
    // Solidário is funded only from the 1% das parcelas in `contribute()`.
    expect(after.solidarity, "C.1: solidarity unchanged").to.equal(before.solidarity);
    expect(after.solidarityBalance, "C.1: solidarity_balance unchanged").to.equal(
      before.solidarityBalance,
    );
    // LP slice is now earmarked on pool.lp_distribution_balance.
    expect(after.lpDistribution, "C.1: lp_distribution delta").to.equal(
      before.lpDistribution + w.lpShare,
    );
    // Pool vault gains everything except what was transferred to treasury.
    expect(after.poolVault, "C.1: pool vault delta").to.equal(
      before.poolVault + w.gf + w.lpShare + w.participants,
    );
    expect(after.yieldAccrued, "C.1: yield_accrued += realized").to.equal(
      before.yieldAccrued + realized,
    );

    // Mock vault drained to tracked_principal — realized portion left.
    expect(after.mockVault, "C.1: mock vault drops by realized").to.equal(
      before.mockVault - realized,
    );
  });

  it("C.2 repeat harvest with no new yield → realized=0 no-op", async function () {
    // Entry state (post-C.1): mock_vault holds exactly tracked_principal
    // again (100 USDC). harvest() should return Ok(()) with zero delta.
    const before = await snapshotPool(env, poolY, treasury, mockVaultY);

    await harvestYield(env, {
      pool: poolY,
      treasuryUsdc: treasury,
    });

    const after = await snapshotPool(env, poolY, treasury, mockVaultY);
    // Full snapshot equality — if anything drifts, the zero-delta branch
    // was skipped.
    expectPoolUnchanged(before, after, "C.2");
  });

  // ─── D. Boundary values ───────────────────────────────────────────────

  it("D.1 deposit(u64::MAX) → InsufficientStake", async function () {
    const before = await snapshotPool(env, poolY, treasury, mockVaultY);

    const msg = await expectRejected(() =>
      (env.programs.core.methods as any)
        .depositIdleToYield({ amount: new BN(U64_MAX.toString()) })
        .accounts({
          caller: env.payer.publicKey,
          config: configPda(env),
          pool: poolY.pool,
          usdcMint,
          poolUsdcVault: poolY.poolUsdcVault,
          yieldVault: yieldMockVault(env, poolY.pool, usdcMint),
          yieldAdapterProgram: env.ids.yieldMock,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: yieldMockStatePda(env, poolY.pool), isSigner: false, isWritable: true },
        ])
        .signers([env.payer])
        .rpc(),
    );
    expect(msg, `D.1: ${msg}`).to.match(/InsufficientStake|stake|below|solvency/i);
    expectPoolUnchanged(before, await snapshotPool(env, poolY, treasury, mockVaultY), "D.1");
  });

  it("D.2 deposit(1 base unit) accepted; principal += 1", async function () {
    // Minimal non-zero deposit. Entry vault may hold residual
    // participants-bucket tokens from C.1 harvest (poolY gets its
    // participants share of realized yield); we only assert relative
    // deltas, not absolutes. Anchor/SPL accept arbitrary u64 amounts;
    // the guard boundary is at amount > 0 (InvalidAmount) and
    // amount <= spendable_idle (InsufficientStake). 1 passes both
    // because vault ≥ 1 and gf_balance = 0 (first harvest at cold cap).
    const before = await snapshotPool(env, poolY, treasury, mockVaultY);
    expect(before.poolVault - before.gfBalance >= 1n, "D.2 precondition: spendable ≥ 1").to.equal(
      true,
    );

    await depositIdleToYield(env, { pool: poolY, amount: 1n });

    const after = await snapshotPool(env, poolY, treasury, mockVaultY);
    expect(after.poolVault, "D.2: vault -= 1").to.equal(before.poolVault - 1n);
    expect(after.mockVault, "D.2: mock += 1").to.equal(before.mockVault + 1n);
    expect(after.principalDeposited, "D.2: principal += 1").to.equal(
      before.principalDeposited + 1n,
    );
    // Non-deposit state must not move.
    expect(after.gfBalance, "D.2: gf unchanged").to.equal(before.gfBalance);
    expect(after.feeAccrued, "D.2: fee unchanged").to.equal(before.feeAccrued);
    expect(after.yieldAccrued, "D.2: yield_accrued unchanged").to.equal(before.yieldAccrued);
    expect(after.treasury, "D.2: treasury unchanged").to.equal(before.treasury);
    expect(after.solidarity, "D.2: solidarity unchanged").to.equal(before.solidarity);
  });
});

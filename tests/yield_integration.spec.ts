/**
 * Yield integration — granular deposit/harvest + waterfall assertions (Step 5c).
 *
 * The lifecycle spec exercises yield once, at cycle 1, with a single
 * harvest. This spec instead walks one pool through several back-to-back
 * harvests that cover each branch of the waterfall:
 *
 *   A. zero-yield harvest is a no-op (early return, no state change)
 *   B. first harvest with an empty GF cap
 *      (total_protocol_fee_accrued == 0 → gf_room == 0)
 *      → yield flows straight to Fee → GoodFaith → Participants
 *   C. second harvest with fees now accrued
 *      → GF absorbs up to its 150%-of-fees cap, rest continues downstream
 *   D. small harvest entirely absorbed by the GF
 *      (amount ≤ remaining GF room)
 *
 * Plus the two guards on `deposit_idle_to_yield`:
 *   E. amount == 0 → InvalidAmount
 *   F. amount > (vault - guarantee_fund_balance) → InsufficientStake
 *      (the GF solvency guard — protects earmarked reserves from being
 *       pushed out to the adapter)
 *
 * Numbers are all small integers (base units of USDC with the default
 * 6 decimals) chosen so every waterfall split hits exact bps arithmetic
 * without rounding surprises. Verified by hand against
 * `programs/roundfi-core/src/math/waterfall.rs` and
 * `programs/roundfi-yield-mock/src/lib.rs`.
 */

import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
  balanceOf,
  claimPayout,
  contribute,
  createPool,
  createUsdcMint,
  depositIdleToYield,
  fetchPool,
  fetchMockVaultState,
  fundUsdc,
  harvestYield,
  initMockVault,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  memberKeypairs,
  mintToAta,
  prefundMockYield,
  setupEnv,
  usdc,
  type Env,
  type MemberHandle,
  type PoolHandle,
} from "./_harness/index.js";

// ─── Pool parameters ──────────────────────────────────────────────────

const MEMBERS_TARGET     = 4;
const CYCLES_TOTAL       = 4;
const CYCLE_DURATION_SEC = 60;
const INSTALLMENT_USDC   = 1_250n;
const CREDIT_USDC        = 3_500n;
const LEVEL: 1 | 2 | 3   = 2;

const INSTALLMENT_BASE    = usdc(INSTALLMENT_USDC);
const CREDIT_BASE         = usdc(CREDIT_USDC);
const POOL_FLOAT_PER_INST = INSTALLMENT_BASE
  - (INSTALLMENT_BASE * 100n)   / 10_000n     // solidarity 1%
  - (INSTALLMENT_BASE * 2_500n) / 10_000n;    // escrow 25%
// = 925_000_000 per member per cycle

// Pool-vault balance after every member contributes cycle 0:
const POOL_VAULT_AFTER_CYCLE0 = BigInt(MEMBERS_TARGET) * POOL_FLOAT_PER_INST;

// Yield numbers (hand-computed — see per-it header below each scenario):
const DEPOSIT_BASE         = usdc(200n);   // moved into the mock
const YIELD_B_BASE         = usdc(100n);   // "empty GF" harvest
const YIELD_C_BASE         = usdc(200n);   // "partial GF fill" harvest
const YIELD_D_BASE         = usdc(20n);    // "fully absorbed by GF" harvest

// Protocol defaults (mirrors DEFAULT_* in roundfi-core::constants):
const FEE_BPS_YIELD        = 2_000;   // 20 %
const GUARANTEE_FUND_BPS   = 15_000;  // 150 % of fees
const GOOD_FAITH_SHARE_BPS = 5_000;   // 50 %

// ─── Helpers ──────────────────────────────────────────────────────────

async function poolState(env: Env, pool: PublicKey) {
  return fetchPool(env, pool) as Promise<Record<string, unknown> & {
    currentCycle: number;
    status: number;
    guaranteeFundBalance: { toString(): string };
    yieldAccrued: { toString(): string };
    yieldPrincipalDeposited: { toString(): string };
    totalProtocolFeeAccrued: { toString(): string };
  }>;
}

function bn(x: { toString(): string }): bigint {
  return BigInt(x.toString());
}

/** Apply `bps` to `amount` with floor rounding — mirrors math::apply_bps. */
function applyBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / 10_000n;
}

/** Guarantee-fund cap: floor(fees_accrued * gf_bps / 10_000). */
function gfCap(feesAccrued: bigint): bigint {
  return (feesAccrued * BigInt(GUARANTEE_FUND_BPS)) / 10_000n;
}

/** Waterfall expected split — pure TS mirror of math::waterfall. */
function expectedSplit(
  yieldAmount: bigint,
  gfRoom: bigint,
): { gf: bigint; fee: bigint; goodFaith: bigint; participants: bigint } {
  const gf = yieldAmount < gfRoom ? yieldAmount : gfRoom;
  const afterGf = yieldAmount - gf;
  const fee = applyBps(afterGf, FEE_BPS_YIELD);
  const afterFee = afterGf - fee;
  const goodFaith = applyBps(afterFee, GOOD_FAITH_SHARE_BPS);
  const participants = afterFee - goodFaith;
  return { gf, fee, goodFaith, participants };
}

/**
 * Expect a send to revert — returns the thrown error's stringified form
 * so the caller can run regex / `.include` against it.
 */
async function expectRejected(thunk: () => Promise<unknown>): Promise<string> {
  try {
    await thunk();
  } catch (err) {
    return String((err as Error)?.message ?? err);
  }
  expect.fail("expected transaction to revert, but it succeeded");
  return "";  // unreachable — expect.fail throws
}

// ─── The test ─────────────────────────────────────────────────────────

describe("yield_integration — deposit / harvest / waterfall", function () {
  this.timeout(120_000);

  let env: Env;
  let usdcMint: PublicKey;
  let treasury: PublicKey;

  const authority = Keypair.generate();
  const members: Keypair[] = memberKeypairs(MEMBERS_TARGET, "yield-integ");

  let pool: PoolHandle;
  let handles: MemberHandle[];
  let mockVault: PublicKey;

  // Running waterfall state — each `it` updates these so the next
  // scenario can derive its expected gf_room / fee calculations.
  let gfBalance = 0n;
  let feesAccrued = 0n;
  let yieldAccrued = 0n;

  before(async function () {
    env = await setupEnv();
    usdcMint = await createUsdcMint(env);

    const proto = await initializeProtocol(env, { usdcMint });
    treasury = proto.treasury;

    await initializeReputation(env, { coreProgram: env.ids.core });
  });

  // ─── Setup a live, Active pool with cycle-0 funds in its vault ──────

  it("bootstraps an Active pool with funds in its USDC vault", async function () {
    pool = await createPool(env, {
      authority,
      usdcMint,
      membersTarget:     MEMBERS_TARGET,
      installmentAmount: INSTALLMENT_BASE,
      creditAmount:      CREDIT_BASE,
      cyclesTotal:       CYCLES_TOTAL,
      cycleDurationSec:  CYCLE_DURATION_SEC,
      escrowReleaseBps:  2_500,
    });

    handles = await joinMembers(
      env,
      pool,
      members.map((m) => ({ member: m, reputationLevel: LEVEL })),
    );

    // Top each member with one installment's worth so they can contribute
    // cycle 0. We only need pool_vault funded for deposit tests, not the
    // full ROSCA lifecycle.
    for (const m of members) {
      await fundUsdc(env, usdcMint, m.publicKey, INSTALLMENT_BASE);
    }

    // Cycle-0 contributions: drops 925 USDC per member into pool_vault.
    for (const h of handles) {
      await contribute(env, { pool, member: h, cycle: 0 });
    }

    expect(await balanceOf(env, pool.poolUsdcVault)).to.equal(POOL_VAULT_AFTER_CYCLE0);
    const p = await poolState(env, pool.pool);
    expect(p.status).to.equal(1);                 // Active
    expect(bn(p.guaranteeFundBalance)).to.equal(0n);
    expect(bn(p.yieldAccrued)).to.equal(0n);
    expect(bn(p.totalProtocolFeeAccrued)).to.equal(0n);
  });

  it("initializes the mock yield vault for this pool", async function () {
    const { state, vault } = await initMockVault(env, pool.pool, usdcMint);
    mockVault = vault;

    const ms = await fetchMockVaultState(env, pool.pool);
    expect(ms.pool.toBase58()).to.equal(pool.pool.toBase58());
    expect(ms.underlyingMint.toBase58()).to.equal(usdcMint.toBase58());
    expect(ms.vault.toBase58()).to.equal(vault.toBase58());
    expect(ms.trackedPrincipal).to.equal(0n);
    expect(state.toBase58()).to.be.a("string");
  });

  // ─── Deposit guards (E, F) ─────────────────────────────────────────

  it("rejects deposit with amount=0 (InvalidAmount)", async function () {
    // The mock vault is initialized but holds nothing. GF balance = 0.
    // This path is purely the amount>0 check in the core ix — never
    // reaches the adapter.
    const msg = await expectRejected(() =>
      depositIdleToYield(env, { pool, amount: 0n }),
    );
    expect(msg).to.match(/InvalidAmount/);
  });

  // ─── Happy-path deposit (tracks principal correctly) ───────────────

  it("deposits principal into the mock vault and tracks it on-chain", async function () {
    const before = {
      pool: await balanceOf(env, pool.poolUsdcVault),
      mock: await balanceOf(env, mockVault),
    };

    await depositIdleToYield(env, { pool, amount: DEPOSIT_BASE });

    const after = {
      pool: await balanceOf(env, pool.poolUsdcVault),
      mock: await balanceOf(env, mockVault),
    };

    expect(before.pool - after.pool).to.equal(DEPOSIT_BASE);
    expect(after.mock - before.mock).to.equal(DEPOSIT_BASE);

    const p = await poolState(env, pool.pool);
    expect(bn(p.yieldPrincipalDeposited)).to.equal(DEPOSIT_BASE);

    // Mock's own tracked_principal matches (it's authoritative on the
    // adapter side — core mirrors on a best-effort basis).
    const ms = await fetchMockVaultState(env, pool.pool);
    expect(ms.trackedPrincipal).to.equal(DEPOSIT_BASE);
  });

  // ─── Scenario A: zero-yield harvest is a no-op ─────────────────────

  it("harvest with nothing accrued is a no-op (A)", async function () {
    // Mock vault holds exactly tracked_principal, so harvest computes
    // realized = 0 and short-circuits before touching any bucket.
    const before = {
      pool:        await balanceOf(env, pool.poolUsdcVault),
      solidarity:  await balanceOf(env, pool.solidarityVault),
      treasury:    await balanceOf(env, treasury),
      mock:        await balanceOf(env, mockVault),
    };
    const pBefore = await poolState(env, pool.pool);

    await harvestYield(env, {
      pool,
      treasuryUsdc: treasury,
      goodFaithShareBps: GOOD_FAITH_SHARE_BPS,
    });

    expect(await balanceOf(env, pool.poolUsdcVault)).to.equal(before.pool);
    expect(await balanceOf(env, pool.solidarityVault)).to.equal(before.solidarity);
    expect(await balanceOf(env, treasury)).to.equal(before.treasury);
    expect(await balanceOf(env, mockVault)).to.equal(before.mock);

    const pAfter = await poolState(env, pool.pool);
    expect(bn(pAfter.guaranteeFundBalance))
      .to.equal(bn(pBefore.guaranteeFundBalance));
    expect(bn(pAfter.yieldAccrued))
      .to.equal(bn(pBefore.yieldAccrued));
    expect(bn(pAfter.totalProtocolFeeAccrued))
      .to.equal(bn(pBefore.totalProtocolFeeAccrued));
  });

  // ─── Scenario B: first harvest — GF room = 0 ───────────────────────

  it("first harvest flows to Fee → GoodFaith → Participants when GF cap is 0 (B)", async function () {
    // Pre-conditions: feesAccrued==0 → gfCap==0 → gfRoom==0.
    // Prefund 100 USDC into the mock vault above its tracked principal.
    // The mock will sweep exactly that amount into pool_usdc_vault on harvest.
    await prefundMockYield(env, pool.pool, usdcMint, YIELD_B_BASE);

    const before = {
      pool:       await balanceOf(env, pool.poolUsdcVault),
      solidarity: await balanceOf(env, pool.solidarityVault),
      treasury:   await balanceOf(env, treasury),
      mock:       await balanceOf(env, mockVault),
    };

    // Expected: gf=0, fee=100*20%=20, gf_bonus=(100-20)*50%=40, participants=40.
    const exp = expectedSplit(YIELD_B_BASE, 0n);
    expect(exp).to.deep.equal({
      gf:           0n,
      fee:          usdc(20n),
      goodFaith:    usdc(40n),
      participants: usdc(40n),
    });

    await harvestYield(env, {
      pool,
      treasuryUsdc: treasury,
      goodFaithShareBps: GOOD_FAITH_SHARE_BPS,
    });

    // Pool vault = before + realized - fee_out - good_faith_out
    // (GF is a logical earmark that STAYS inside pool_usdc_vault.)
    expect(await balanceOf(env, pool.poolUsdcVault))
      .to.equal(before.pool + YIELD_B_BASE - exp.fee - exp.goodFaith);
    expect(await balanceOf(env, pool.solidarityVault))
      .to.equal(before.solidarity + exp.goodFaith);
    expect(await balanceOf(env, treasury))
      .to.equal(before.treasury + exp.fee);
    expect(await balanceOf(env, mockVault))
      .to.equal(before.mock - YIELD_B_BASE);

    const p = await poolState(env, pool.pool);
    expect(bn(p.guaranteeFundBalance)).to.equal(exp.gf);
    expect(bn(p.totalProtocolFeeAccrued)).to.equal(exp.fee);
    expect(bn(p.yieldAccrued)).to.equal(YIELD_B_BASE);

    // Bookkeep for the next scenarios.
    gfBalance    = exp.gf;
    feesAccrued  = exp.fee;
    yieldAccrued = YIELD_B_BASE;
  });

  // ─── Scenario C: second harvest — GF now has room ──────────────────

  it("second harvest partially fills the GF up to its cap (C)", async function () {
    // feesAccrued=20 → gfCap = 20 * 1.5 = 30. gfBalance=0 → gfRoom=30.
    // Prefund 200 → yield=200. Expected:
    //   gf=min(200, 30)=30; after_gf=170
    //   fee=170*20%=34; after_fee=136
    //   gf_bonus=136*50%=68; participants=68
    await prefundMockYield(env, pool.pool, usdcMint, YIELD_C_BASE);

    const before = {
      pool:       await balanceOf(env, pool.poolUsdcVault),
      solidarity: await balanceOf(env, pool.solidarityVault),
      treasury:   await balanceOf(env, treasury),
    };

    const cap = gfCap(feesAccrued);
    const room = cap - gfBalance;
    expect(room).to.equal(usdc(30n));
    const exp = expectedSplit(YIELD_C_BASE, room);
    expect(exp).to.deep.equal({
      gf:           usdc(30n),
      fee:          usdc(34n),
      goodFaith:    usdc(68n),
      participants: usdc(68n),
    });

    await harvestYield(env, {
      pool,
      treasuryUsdc: treasury,
      goodFaithShareBps: GOOD_FAITH_SHARE_BPS,
    });

    expect(await balanceOf(env, pool.poolUsdcVault))
      .to.equal(before.pool + YIELD_C_BASE - exp.fee - exp.goodFaith);
    expect(await balanceOf(env, pool.solidarityVault))
      .to.equal(before.solidarity + exp.goodFaith);
    expect(await balanceOf(env, treasury))
      .to.equal(before.treasury + exp.fee);

    const p = await poolState(env, pool.pool);
    gfBalance   = gfBalance   + exp.gf;
    feesAccrued = feesAccrued + exp.fee;
    yieldAccrued = yieldAccrued + YIELD_C_BASE;

    expect(bn(p.guaranteeFundBalance)).to.equal(gfBalance);
    expect(bn(p.totalProtocolFeeAccrued)).to.equal(feesAccrued);
    expect(bn(p.yieldAccrued)).to.equal(yieldAccrued);
  });

  // ─── Scenario D: small harvest entirely absorbed by GF ─────────────

  it("small harvest entirely absorbed by GF when within remaining room (D)", async function () {
    // feesAccrued=54 → gfCap=81. gfBalance=30 → gfRoom=51.
    // Prefund 20 → yield=20 ≤ 51 → GF absorbs all; everything else=0.
    await prefundMockYield(env, pool.pool, usdcMint, YIELD_D_BASE);

    const before = {
      pool:       await balanceOf(env, pool.poolUsdcVault),
      solidarity: await balanceOf(env, pool.solidarityVault),
      treasury:   await balanceOf(env, treasury),
    };

    const room = gfCap(feesAccrued) - gfBalance;
    expect(room).to.equal(usdc(51n));
    const exp = expectedSplit(YIELD_D_BASE, room);
    expect(exp).to.deep.equal({
      gf:           YIELD_D_BASE,
      fee:          0n,
      goodFaith:    0n,
      participants: 0n,
    });

    await harvestYield(env, {
      pool,
      treasuryUsdc: treasury,
      goodFaithShareBps: GOOD_FAITH_SHARE_BPS,
    });

    // Everything is a logical earmark inside pool_vault — no outbound transfers.
    expect(await balanceOf(env, pool.poolUsdcVault))
      .to.equal(before.pool + YIELD_D_BASE);
    expect(await balanceOf(env, pool.solidarityVault)).to.equal(before.solidarity);
    expect(await balanceOf(env, treasury)).to.equal(before.treasury);

    const p = await poolState(env, pool.pool);
    gfBalance    = gfBalance + exp.gf;
    yieldAccrued = yieldAccrued + YIELD_D_BASE;
    expect(bn(p.guaranteeFundBalance)).to.equal(gfBalance);
    expect(bn(p.totalProtocolFeeAccrued)).to.equal(feesAccrued);
    expect(bn(p.yieldAccrued)).to.equal(yieldAccrued);
  });

  // ─── Scenario F: deposit guard protects GF earmark ─────────────────

  it("rejects deposit amount that would push vault below GF earmark (F)", async function () {
    // The GF is a logical earmark inside pool_usdc_vault — the deposit
    // guard in `deposit_idle_to_yield` enforces that this earmark
    // never leaks out to the adapter.
    //
    //   spendable_idle = pool_vault.amount - pool.guarantee_fund_balance
    //   args.amount    > spendable_idle          → InsufficientStake
    const vaultBefore = await balanceOf(env, pool.poolUsdcVault);
    const p           = await poolState(env, pool.pool);
    const earmark     = bn(p.guaranteeFundBalance);
    expect(earmark > 0n).to.equal(true);       // else this test is trivially vacuous
    const spendable   = vaultBefore - earmark;
    const overshoot   = spendable + 1n;

    const msg = await expectRejected(() =>
      depositIdleToYield(env, { pool, amount: overshoot }),
    );
    expect(msg).to.match(/InsufficientStake/);

    // Control: depositing the exact spendable amount still succeeds and
    // leaves vault == earmark. Not strictly required by the spec, but
    // verifies the boundary is tight, not conservative.
    await depositIdleToYield(env, { pool, amount: spendable });
    expect(await balanceOf(env, pool.poolUsdcVault)).to.equal(earmark);
  });

  // ─── Closing sanity: claim cycle 0 to prove pool is still healthy ───

  it("claims cycle 0 payout normally after all yield ops", async function () {
    // After draining the pool_vault to == GF earmark, the slot-0 claimer
    // now needs the pool to have ≥ credit_amount spendable. Mint the
    // exact shortfall directly into pool_usdc_vault — this is a smoke
    // test for "did we break the pool?" not a yield assertion.
    const p = await poolState(env, pool.pool);
    const vault = await balanceOf(env, pool.poolUsdcVault);
    const spendable = vault - bn(p.guaranteeFundBalance);
    if (spendable < CREDIT_BASE) {
      await mintToAta(env, usdcMint, pool.poolUsdcVault, CREDIT_BASE - spendable);
    }

    const slot0 = handles.find((h) => h.slotIndex === 0)!;
    await claimPayout(env, { pool, member: slot0, cycle: 0 });

    const p2 = await poolState(env, pool.pool);
    expect(p2.currentCycle).to.equal(1);
  });
});

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
 *      → yield flows Fee → GF (skipped) → LP → Participants
 *   C. second harvest with fees now accrued
 *      → fee runs first; GF absorbs up to its 150%-of-fees cap; rest
 *        continues to LP and Participants
 *   D. small harvest — fee runs first, GF takes the remainder
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
const FEE_BPS_YIELD      = 2_000;   // 20 % protocol fee on gross
const GUARANTEE_FUND_BPS = 15_000;  // 150 % of fees
const LP_SHARE_BPS       = 6_500;   // 65 % LPs / Anjos de Liquidez

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

function bn(x: unknown): bigint {
  // Loose `unknown` because Anchor's `account.fetch()` returns
  // Record<string, unknown> when the IDL isn't typed end-to-end.
  // Every Anchor-deserialized field has a `.toString()` (Pubkey, BN,
  // u64, primitives, …), so we trust that and cast at runtime.
  return BigInt((x as { toString(): string }).toString());
}

/** Apply `bps` to `amount` with floor rounding — mirrors math::apply_bps. */
function applyBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / 10_000n;
}

/** Guarantee-fund cap: floor(fees_accrued * gf_bps / 10_000). */
function gfCap(feesAccrued: bigint): bigint {
  return (feesAccrued * BigInt(GUARANTEE_FUND_BPS)) / 10_000n;
}

/** Waterfall expected split — pure TS mirror of math::waterfall (v1.1
 *  PDF-canonical order: fee → GF → LP → participants). */
function expectedSplit(
  yieldAmount: bigint,
  gfRoom: bigint,
): { fee: bigint; gf: bigint; lpShare: bigint; participants: bigint } {
  const fee = applyBps(yieldAmount, FEE_BPS_YIELD);
  const afterFee = yieldAmount - fee;
  const gf = afterFee < gfRoom ? afterFee : gfRoom;
  const afterGf = afterFee - gf;
  const lpShare = applyBps(afterGf, LP_SHARE_BPS);
  const participants = afterGf - lpShare;
  return { fee, gf, lpShare, participants };
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
  let lpDistribution = 0n;
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
      lpShareBps: LP_SHARE_BPS,
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

  it("first harvest flows Fee → GF → LP → Participants when GF cap is 0 (B)", async function () {
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

    // PDF-canonical (v1.1): fee 20% of 100 = 20; afterFee=80;
    // gf=min(80, 0)=0; afterGf=80; lp 65% of 80 = 52; participants = 28.
    const exp = expectedSplit(YIELD_B_BASE, 0n);
    expect(exp).to.deep.equal({
      fee:          usdc(20n),
      gf:           0n,
      lpShare:      usdc(52n),
      participants: usdc(28n),
    });

    await harvestYield(env, {
      pool,
      treasuryUsdc: treasury,
      lpShareBps: LP_SHARE_BPS,
    });

    // Pool vault = before + realized − fee_out
    // (Only fee is transferred OUT. GF and LP slices are logical
    //  earmarks that STAY inside pool_usdc_vault.)
    expect(await balanceOf(env, pool.poolUsdcVault))
      .to.equal(before.pool + YIELD_B_BASE - exp.fee);
    // Solidarity vault is no longer credited from yield (v1.1 — Cofre
    // Solidário is funded only from the 1% das parcelas).
    expect(await balanceOf(env, pool.solidarityVault))
      .to.equal(before.solidarity);
    expect(await balanceOf(env, treasury))
      .to.equal(before.treasury + exp.fee);
    expect(await balanceOf(env, mockVault))
      .to.equal(before.mock - YIELD_B_BASE);

    const p = await poolState(env, pool.pool);
    expect(bn(p.guaranteeFundBalance)).to.equal(exp.gf);
    expect(bn(p.lpDistributionBalance)).to.equal(exp.lpShare);
    expect(bn(p.totalProtocolFeeAccrued)).to.equal(exp.fee);
    expect(bn(p.yieldAccrued)).to.equal(YIELD_B_BASE);

    // Bookkeep for the next scenarios.
    gfBalance      = exp.gf;
    feesAccrued    = exp.fee;
    lpDistribution = exp.lpShare;
    yieldAccrued   = YIELD_B_BASE;
  });

  // ─── Scenario C: second harvest — GF now has room ──────────────────

  it("second harvest takes fee, fills GF to cap, then routes LP / participants (C)", async function () {
    // After Scenario B: feesAccrued=20 → gfCap = 20 * 1.5 = 30.
    // gfBalance=0 → gfRoom=30. Prefund 200 → yield=200.
    // PDF-canonical:
    //   fee = 200 * 20% = 40; afterFee = 160
    //   gf  = min(160, 30) = 30; afterGf = 130
    //   lp  = 130 * 65% = 84.5 USDC; participants = 45.5 USDC
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
      fee:          usdc(40n),
      gf:           usdc(30n),
      lpShare:      84_500_000n,    // 84.5 USDC in base units
      participants: 45_500_000n,    // 45.5 USDC in base units
    });

    await harvestYield(env, {
      pool,
      treasuryUsdc: treasury,
      lpShareBps: LP_SHARE_BPS,
    });

    // Only fee is transferred out. GF + LP slices stay earmarked
    // inside pool_usdc_vault (logical bookkeeping).
    expect(await balanceOf(env, pool.poolUsdcVault))
      .to.equal(before.pool + YIELD_C_BASE - exp.fee);
    expect(await balanceOf(env, pool.solidarityVault))
      .to.equal(before.solidarity); // no longer credited from yield
    expect(await balanceOf(env, treasury))
      .to.equal(before.treasury + exp.fee);

    const p = await poolState(env, pool.pool);
    gfBalance       = gfBalance       + exp.gf;
    feesAccrued     = feesAccrued     + exp.fee;
    lpDistribution  = lpDistribution  + exp.lpShare;
    yieldAccrued    = yieldAccrued    + YIELD_C_BASE;

    expect(bn(p.guaranteeFundBalance)).to.equal(gfBalance);
    expect(bn(p.lpDistributionBalance)).to.equal(lpDistribution);
    expect(bn(p.totalProtocolFeeAccrued)).to.equal(feesAccrued);
    expect(bn(p.yieldAccrued)).to.equal(yieldAccrued);
  });

  // ─── Scenario D: small harvest — fee first, GF takes the rest ─────

  it("small harvest still pays fee first; GF takes the remainder (D)", async function () {
    // After Scenarios B + C: feesAccrued = 20 + 40 = 60.
    // gfCap = 60 * 1.5 = 90. gfBalance = 30 → gfRoom = 60.
    // Prefund 20 → yield=20.
    // PDF-canonical:
    //   fee = 20 * 20% = 4; afterFee = 16
    //   gf  = min(16, 60) = 16; afterGf = 0
    //   lp  = 0; participants = 0
    // Old (GF-first) test expected GF to swallow the entire 20 with
    // zero fee — the v1.1 reorder makes the fee step fire first even
    // for small yields.
    await prefundMockYield(env, pool.pool, usdcMint, YIELD_D_BASE);

    const before = {
      pool:       await balanceOf(env, pool.poolUsdcVault),
      solidarity: await balanceOf(env, pool.solidarityVault),
      treasury:   await balanceOf(env, treasury),
    };

    const room = gfCap(feesAccrued) - gfBalance;
    expect(room).to.equal(usdc(60n));
    const exp = expectedSplit(YIELD_D_BASE, room);
    expect(exp).to.deep.equal({
      fee:          usdc(4n),
      gf:           usdc(16n),
      lpShare:      0n,
      participants: 0n,
    });

    await harvestYield(env, {
      pool,
      treasuryUsdc: treasury,
      lpShareBps: LP_SHARE_BPS,
    });

    // Fee is transferred out (4 USDC); GF stays earmarked inside vault.
    expect(await balanceOf(env, pool.poolUsdcVault))
      .to.equal(before.pool + YIELD_D_BASE - exp.fee);
    expect(await balanceOf(env, pool.solidarityVault))
      .to.equal(before.solidarity);
    expect(await balanceOf(env, treasury))
      .to.equal(before.treasury + exp.fee);

    const p = await poolState(env, pool.pool);
    gfBalance      = gfBalance      + exp.gf;
    feesAccrued    = feesAccrued    + exp.fee;
    lpDistribution = lpDistribution + exp.lpShare;
    yieldAccrued   = yieldAccrued   + YIELD_D_BASE;
    expect(bn(p.guaranteeFundBalance)).to.equal(gfBalance);
    expect(bn(p.lpDistributionBalance)).to.equal(lpDistribution);
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

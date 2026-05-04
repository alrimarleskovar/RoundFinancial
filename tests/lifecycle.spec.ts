/**
 * Happy-path lifecycle integration test (Step 5c).
 *
 * Walks a single pool through its entire life:
 *
 *   initializeProtocol
 *     → createPool (4 members, 4 cycles, 60s duration)
 *     → joinPool × 4 (Level-2 members, 30% stake)
 *         pool auto-activates when the 4th member joins
 *     → For each cycle c ∈ [0, 3]:
 *         contribute × 4
 *         claimPayout by slot == c
 *     → Around cycle 1: deposit_idle_to_yield + prefund + harvest_yield
 *       (exercises the full Fee→GF→LP→Participants waterfall, v1.1)
 *     → release_escrow × 4  (checkpoint = cycles_total)
 *     → close_pool
 *
 * Assertions at every step:
 *   • Pool vault / escrow vault / solidarity vault / treasury / mock
 *     vault / member USDC deltas match hand-computed values.
 *   • Pool state fields (current_cycle, total_contributed, total_paid_out,
 *     guarantee_fund_balance, yield_accrued, status, etc.) step
 *     monotonically in the expected way.
 *   • Seed-draw invariant holds at cycle 0 (implicit — claim_payout
 *     would revert with SeedDrawShortfall otherwise, and we assert the
 *     successful claim).
 *   • Reputation attestations (Payment × cycles*members, CycleComplete
 *     × cycles) actually get created.
 *   • NFT↔state link: member.nft_asset == the NFT keypair generated at
 *     join.
 *   • Global conservation: sum of every touched token account at end
 *     equals the total USDC minted at setup.
 *
 * Pool parameters deliberately chosen so that:
 *   pool_float_per_cycle = 4 × 925 USDC = 3700 USDC  ≥  credit 3500 USDC
 * so that claim_payout clears `spendable >= credit_amount` every cycle
 * without any external pre-funding.
 *
 * Uses deterministic keypairs from `memberKeypairs()` so addresses are
 * stable across runs — makes debugging failed assertions much easier.
 * `cycle_duration = 60` is the MIN_CYCLE_DURATION; the test never
 * waits between cycles because contribute/claim both succeed
 * immediately within the grace window and claim_payout is what
 * advances `pool.current_cycle`.
 */

import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";

import { ATTESTATION_SCHEMA, FEES } from "@roundfi/sdk";

import {
  SCHEMA,
  attestationFor,
  attestationNonce,
  balanceOf,
  claimPayout,
  closePool,
  contribute,
  createPool,
  createUsdcMint,
  depositIdleToYield,
  ensureAta,
  fetchMember,
  fetchPool,
  fetchMockVaultState,
  fundUsdc,
  harvestYield,
  initMockVault,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  memberKeypairs,
  prefundMockYield,
  releaseEscrow,
  setupEnv,
  usdc,
  yieldMockVault,
  type Env,
  type MemberHandle,
  type PoolHandle,
} from "./_harness/index.js";

// ─── Pool parameters (small + fast) ───────────────────────────────────

const MEMBERS_TARGET      = 4;
const CYCLES_TOTAL        = 4;
const CYCLE_DURATION_SEC  = 60;       // MIN_CYCLE_DURATION
const INSTALLMENT_USDC    = 1_250n;   // whole USDC
const CREDIT_USDC         = 3_500n;

const LEVEL: 1 | 2 | 3    = 2;        // 30% stake → 1_050 USDC per member
const LEVEL_STAKE_BPS     = 3_000;

const INSTALLMENT_BASE    = usdc(INSTALLMENT_USDC);  // 1_250_000_000
const CREDIT_BASE         = usdc(CREDIT_USDC);       // 3_500_000_000
const STAKE_BASE          = (CREDIT_BASE * BigInt(LEVEL_STAKE_BPS)) / 10_000n; // 1_050_000_000

// Installment split with solidarity_bps=100, escrow_release_bps=2500:
const SOLIDARITY_PER_INST = (INSTALLMENT_BASE * 100n) / 10_000n;     //    12_500_000
const ESCROW_PER_INST     = (INSTALLMENT_BASE * 2_500n) / 10_000n;   //   312_500_000
const POOL_FLOAT_PER_INST = INSTALLMENT_BASE - SOLIDARITY_PER_INST - ESCROW_PER_INST; // 925_000_000

// Yield scenario during cycle 1:
const YIELD_DEPOSIT_BASE  = usdc(200n);   // moved from pool_vault → mock_vault
const YIELD_PREFUND_BASE  = usdc(100n);   // bonus minted directly into mock_vault

// ─── Helpers ──────────────────────────────────────────────────────────

async function poolState(env: Env, pool: PublicKey) {
  return fetchPool(env, pool) as Promise<Record<string, unknown> & {
    currentCycle: number;
    status: number;
    totalContributed: { toString(): string };
    totalPaidOut: { toString(): string };
    solidarityBalance: { toString(): string };
    escrowBalance: { toString(): string };
    guaranteeFundBalance: { toString(): string };
    yieldAccrued: { toString(): string };
    totalProtocolFeeAccrued: { toString(): string };
    yieldPrincipalDeposited: { toString(): string };
    membersJoined: number;
    membersTarget: number;
  }>;
}

async function memberState(env: Env, member: PublicKey) {
  return fetchMember(env, member) as Promise<Record<string, unknown> & {
    slotIndex: number;
    contributionsPaid: number;
    onTimeCount: number;
    escrowBalance: { toString(): string };
    stakeDeposited: { toString(): string };
    lastReleasedCheckpoint: number;
    paidOut: boolean;
    nftAsset: PublicKey;
    defaulted: boolean;
  }>;
}

function bn(x: unknown): bigint {
  // Loose `unknown` because Anchor's `account.fetch()` returns
  // Record<string, unknown> when the IDL isn't typed end-to-end.
  return BigInt((x as { toString(): string }).toString());
}

// ─── The test ─────────────────────────────────────────────────────────

describe("lifecycle — full happy path", function () {
  // Pool lifecycle (+ yield CPIs + Metaplex init) is not fast on localnet.
  // 60s is comfortable; individual ix calls are <5s.
  this.timeout(120_000);

  let env: Env;
  let usdcMint: PublicKey;
  let treasury: PublicKey;

  const authority = Keypair.generate();
  const members: Keypair[] = memberKeypairs(MEMBERS_TARGET, "lifecycle");

  let pool: PoolHandle;
  let handles: MemberHandle[];

  // Track USDC conservation: cumulative minted during setup.
  let totalMinted = 0n;

  before(async function () {
    env = await setupEnv();
    usdcMint = await createUsdcMint(env);

    // Protocol singleton. Treasury = env.payer ATA (per harness default).
    const proto = await initializeProtocol(env, { usdcMint });
    treasury = proto.treasury;

    // Reputation singleton: required for the attestation CPI inside
    // contribute / claim_payout.
    await initializeReputation(env, { coreProgram: env.ids.core });
  });

  it("creates a 4-member / 4-cycle pool (status=Forming)", async function () {
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

    const p = await poolState(env, pool.pool);
    expect(p.status).to.equal(0);           // Forming
    expect(p.membersJoined).to.equal(0);
    expect(p.membersTarget).to.equal(MEMBERS_TARGET);

    // Vaults are all empty at create.
    expect(await balanceOf(env, pool.poolUsdcVault)).to.equal(0n);
    expect(await balanceOf(env, pool.escrowVault)).to.equal(0n);
    expect(await balanceOf(env, pool.solidarityVault)).to.equal(0n);
  });

  it("joins 4 members and auto-activates", async function () {
    handles = await joinMembers(
      env,
      pool,
      members.map((m) => ({ member: m, reputationLevel: LEVEL })),
    );

    // Stake funding + join-stake transfers go through fundUsdc → freshly
    // minted. Count it into conservation tally.
    totalMinted += BigInt(MEMBERS_TARGET) * STAKE_BASE;

    // Now top each member up to enough for every contribution. They
    // already paid STAKE_BASE at join (locked in escrow), so their
    // wallet USDC = 0; fund CYCLES_TOTAL × INSTALLMENT fresh.
    for (const m of members) {
      await fundUsdc(env, usdcMint, m.publicKey, BigInt(CYCLES_TOTAL) * INSTALLMENT_BASE);
    }
    totalMinted += BigInt(MEMBERS_TARGET) * BigInt(CYCLES_TOTAL) * INSTALLMENT_BASE;

    const p = await poolState(env, pool.pool);
    expect(p.membersJoined).to.equal(MEMBERS_TARGET);
    expect(p.status).to.equal(1);           // Active
    expect(p.currentCycle).to.equal(0);

    // Escrow vault holds every stake.
    expect(await balanceOf(env, pool.escrowVault)).to.equal(
      BigInt(MEMBERS_TARGET) * STAKE_BASE,
    );

    // Every member's NFT is linked to their state record.
    for (const h of handles) {
      const ms = await memberState(env, h.member);
      expect(ms.nftAsset.toBase58()).to.equal(h.nftAsset.publicKey.toBase58());
      expect(ms.slotIndex).to.equal(h.slotIndex);
      expect(bn(ms.stakeDeposited)).to.equal(STAKE_BASE);
      expect(ms.contributionsPaid).to.equal(0);
      expect(ms.paidOut).to.equal(false);
      expect(ms.defaulted).to.equal(false);
    }
  });

  // Walk cycles 0..CYCLES_TOTAL-1. Yield ops are spliced in right after
  // the cycle-1 claim, so the pool is Active for both deposit + harvest.
  for (let cycle = 0; cycle < CYCLES_TOTAL; cycle++) {
    it(`cycle ${cycle}: all 4 members contribute on-time`, async function () {
      const poolBefore  = await balanceOf(env, pool.poolUsdcVault);
      const solBefore   = await balanceOf(env, pool.solidarityVault);
      const escBefore   = await balanceOf(env, pool.escrowVault);

      for (const h of handles) {
        const sig = await contribute(env, {
          pool,
          member: h,
          cycle,
          schemaId: SCHEMA.Payment,
        });
        expect(sig).to.be.a("string");

        // Attestation PDA must now be funded (reputation::attest initialized it).
        const attPda = attestationFor(
          env,
          pool.pool,
          h.wallet.publicKey,
          ATTESTATION_SCHEMA.Payment,
          attestationNonce(cycle, h.slotIndex),
        );
        const attInfo = await env.connection.getAccountInfo(attPda, "confirmed");
        expect(attInfo, `attestation missing cycle=${cycle} slot=${h.slotIndex}`).to.not.be.null;
      }

      // Vault deltas match exact math.
      const poolAfter  = await balanceOf(env, pool.poolUsdcVault);
      const solAfter   = await balanceOf(env, pool.solidarityVault);
      const escAfter   = await balanceOf(env, pool.escrowVault);

      expect(poolAfter - poolBefore).to.equal(
        BigInt(MEMBERS_TARGET) * POOL_FLOAT_PER_INST,
      );
      expect(solAfter - solBefore).to.equal(
        BigInt(MEMBERS_TARGET) * SOLIDARITY_PER_INST,
      );
      expect(escAfter - escBefore).to.equal(
        BigInt(MEMBERS_TARGET) * ESCROW_PER_INST,
      );

      // Per-member state.
      for (const h of handles) {
        const ms = await memberState(env, h.member);
        expect(ms.contributionsPaid).to.equal(cycle + 1);
        expect(ms.onTimeCount).to.equal(cycle + 1);
      }
    });

    it(`cycle ${cycle}: slot ${cycle} claims payout`, async function () {
      const recipient = handles[cycle]!;
      const recipientBefore = await balanceOf(env, recipient.memberUsdc);
      const poolBefore      = await balanceOf(env, pool.poolUsdcVault);

      await claimPayout(env, { pool, member: recipient, cycle });

      const recipientAfter = await balanceOf(env, recipient.memberUsdc);
      const poolAfter      = await balanceOf(env, pool.poolUsdcVault);

      expect(recipientAfter - recipientBefore).to.equal(CREDIT_BASE);
      expect(poolBefore - poolAfter).to.equal(CREDIT_BASE);

      // CycleComplete attestation lives at its own PDA.
      const attPda = attestationFor(
        env,
        pool.pool,
        recipient.wallet.publicKey,
        ATTESTATION_SCHEMA.CycleComplete,
        attestationNonce(cycle, recipient.slotIndex),
      );
      const attInfo = await env.connection.getAccountInfo(attPda, "confirmed");
      expect(attInfo, `CycleComplete attestation missing cycle=${cycle}`).to.not.be.null;

      const ms = await memberState(env, recipient.member);
      expect(ms.paidOut).to.equal(true);

      // pool.current_cycle advances unless this was the final cycle.
      const p = await poolState(env, pool.pool);
      if (cycle + 1 < CYCLES_TOTAL) {
        expect(p.currentCycle).to.equal(cycle + 1);
        expect(p.status).to.equal(1);       // Active
      } else {
        expect(p.status).to.equal(2);       // Completed
      }
    });

    // Splice yield flow between cycle 1 and cycle 2. Pool is still
    // Active, and pool_vault has enough idle to deposit without
    // breaking the GF solvency guard.
    if (cycle === 1) {
      it("yield flow: deposit_idle → prefund → harvest (waterfall)", async function () {
        // 1. Init the mock vault (idempotent).
        const { vault: mockVault } = await initMockVault(
          env,
          pool.pool,
          usdcMint,
        );

        // 2. deposit_idle_to_yield moves USDC from pool → mock_vault.
        const poolBeforeDep = await balanceOf(env, pool.poolUsdcVault);
        const mockBeforeDep = await balanceOf(env, mockVault);
        await depositIdleToYield(env, { pool, amount: YIELD_DEPOSIT_BASE });
        const poolAfterDep = await balanceOf(env, pool.poolUsdcVault);
        const mockAfterDep = await balanceOf(env, mockVault);
        expect(poolBeforeDep - poolAfterDep).to.equal(YIELD_DEPOSIT_BASE);
        expect(mockAfterDep - mockBeforeDep).to.equal(YIELD_DEPOSIT_BASE);

        const mockState = await fetchMockVaultState(env, pool.pool);
        expect(mockState.trackedPrincipal).to.equal(YIELD_DEPOSIT_BASE);

        // 3. Prefund the mock vault with surplus — simulates accrued yield.
        await prefundMockYield(env, pool.pool, usdcMint, YIELD_PREFUND_BASE);
        totalMinted += YIELD_PREFUND_BASE;
        expect(await balanceOf(env, mockVault)).to.equal(
          YIELD_DEPOSIT_BASE + YIELD_PREFUND_BASE,
        );

        // 4. harvest_yield — mock returns surplus, core splits per waterfall.
        const poolBeforeHar = await balanceOf(env, pool.poolUsdcVault);
        const treasuryBefore = await balanceOf(env, treasury);
        const solBeforeHar = await balanceOf(env, pool.solidarityVault);

        await harvestYield(env, {
          pool,
          treasuryUsdc: treasury,
          lpShareBps: 6_500,
        });

        const poolAfterHar = await balanceOf(env, pool.poolUsdcVault);
        const treasuryAfter = await balanceOf(env, treasury);
        const solAfterHar = await balanceOf(env, pool.solidarityVault);
        const mockAfterHar = await balanceOf(env, mockVault);

        // Realized yield = prefund (mock returns exactly the surplus).
        // PDF-canonical waterfall (v1.1) with gf_room = 0:
        //   fee = 100 * 20% = 20; afterFee = 80
        //   gf  = min(80, 0) = 0; afterGf = 80
        //   lp  = 80 * 65% = 52; participants = 28
        const expectedRealized = YIELD_PREFUND_BASE;
        const expectedFee      = (expectedRealized * BigInt(FEES.yieldFeeBps)) / 10_000n;
        const afterFee         = expectedRealized - expectedFee;
        const expectedLpShare  = (afterFee * 6_500n) / 10_000n;
        const expectedParts    = afterFee - expectedLpShare;

        // Pool gains realized − fee_out (LP slice and participants both
        // stay logically inside pool_usdc_vault).
        expect(poolAfterHar - poolBeforeHar).to.equal(expectedRealized - expectedFee);
        expect(treasuryAfter - treasuryBefore).to.equal(expectedFee);
        // Solidarity vault is no longer credited from yield (v1.1).
        expect(solAfterHar).to.equal(solBeforeHar);
        // Mock vault drops by realized; tracked principal unchanged.
        expect(mockAfterHar).to.equal(YIELD_DEPOSIT_BASE);

        const p = await poolState(env, pool.pool);
        expect(bn(p.yieldAccrued)).to.equal(expectedRealized);
        expect(bn(p.totalProtocolFeeAccrued)).to.equal(expectedFee);
        // GF room was 0 so GF balance stays 0.
        expect(bn(p.guaranteeFundBalance)).to.equal(0n);
        // LP slice tracked on the new lp_distribution_balance earmark.
        expect(bn(p.lpDistributionBalance)).to.equal(expectedLpShare);
        // yield_principal_deposited: deposit increased by YIELD_DEPOSIT_BASE
        // and harvest only reduces it if yield_vault dropped *more* than
        // realized (it didn't — it dropped by exactly realized), so it
        // stays at YIELD_DEPOSIT_BASE.
        expect(bn(p.yieldPrincipalDeposited)).to.equal(YIELD_DEPOSIT_BASE);
      });
    }
  }

  it("pool completed after cycle 3", async function () {
    const p = await poolState(env, pool.pool);
    expect(p.status).to.equal(2);           // Completed
    expect(bn(p.totalPaidOut)).to.equal(BigInt(CYCLES_TOTAL) * CREDIT_BASE);
    expect(bn(p.totalContributed)).to.equal(
      BigInt(CYCLES_TOTAL) * BigInt(MEMBERS_TARGET) * INSTALLMENT_BASE,
    );

    // Every member is paid_out.
    for (const h of handles) {
      const ms = await memberState(env, h.member);
      expect(ms.paidOut).to.equal(true);
      expect(ms.contributionsPaid).to.equal(CYCLES_TOTAL);
      expect(ms.onTimeCount).to.equal(CYCLES_TOTAL);
    }
  });

  it("releases each member's stake at the final checkpoint", async function () {
    // checkpoint = cycles_total returns the entire stake_deposited (no
    // rounding dust, per escrow_vesting::cumulative_vested final-case).
    for (const h of handles) {
      const memberBefore = await balanceOf(env, h.memberUsdc);
      const escrowBefore = await balanceOf(env, pool.escrowVault);

      await releaseEscrow(env, { pool, member: h, checkpoint: CYCLES_TOTAL });

      const memberAfter = await balanceOf(env, h.memberUsdc);
      const escrowAfter = await balanceOf(env, pool.escrowVault);

      expect(memberAfter - memberBefore).to.equal(STAKE_BASE);
      expect(escrowBefore - escrowAfter).to.equal(STAKE_BASE);

      const ms = await memberState(env, h.member);
      expect(ms.lastReleasedCheckpoint).to.equal(CYCLES_TOTAL);
      // member.escrow_balance was initial stake + cycle escrow portions
      // (CYCLES × ESCROW_PER_INST); release drained stake only.
      expect(bn(ms.escrowBalance)).to.equal(
        BigInt(CYCLES_TOTAL) * ESCROW_PER_INST,
      );
    }
  });

  it("closes the pool", async function () {
    await closePool(env, { pool });
    const p = await poolState(env, pool.pool);
    expect(p.status).to.equal(2);           // Completed (terminal)
  });

  it("global conservation: every USDC base unit is accounted for", async function () {
    // Sum every token account the flow touched. Must equal totalMinted.
    const poolVault  = await balanceOf(env, pool.poolUsdcVault);
    const escrow     = await balanceOf(env, pool.escrowVault);
    const solidarity = await balanceOf(env, pool.solidarityVault);
    const treasuryB  = await balanceOf(env, treasury);

    const mockVault = await balanceOf(env, yieldMockVault(env, pool.pool, usdcMint));

    let memberSum = 0n;
    for (const m of members) {
      const ata = await ensureAta(env, usdcMint, m.publicKey);
      memberSum += await balanceOf(env, ata);
    }

    const total = poolVault + escrow + solidarity + treasuryB + mockVault + memberSum;
    expect(total).to.equal(totalMinted);

    // Close-pool sanity: the expected per-bucket ending numbers (hand-
    // computed from the math in the comments). Keeping this as a strict
    // check flags unexpected bucket-routing changes quickly.
    //
    // Cycle-level flows:
    //   pool_vault:   +4 × 925 per cycle, -3500 per cycle → +200 per cycle
    //   escrow_vault: +4 × 312.5 per cycle
    //   solidarity:   +4 × 12.5 per cycle
    //
    // Plus the cycle-1 yield splice (v1.1 PDF order: fee → GF → LP → parts):
    //   pool_vault   -= YIELD_DEPOSIT_BASE, then += (lp_share + participants).
    //                  GF=0 here (gf_room=0 cold-start), LP slice stays
    //                  earmarked inside pool_vault, participants too.
    //   treasury     += fee.
    //   solidarity   UNCHANGED (no longer credited from yield in v1.1).
    //
    // Plus the final escrow release (×4 × STAKE_BASE → members).
    const perCyclePool =
      BigInt(MEMBERS_TARGET) * POOL_FLOAT_PER_INST - CREDIT_BASE;
    const expectedFee      = (YIELD_PREFUND_BASE * BigInt(FEES.yieldFeeBps)) / 10_000n;
    const expectedLpShare =
      ((YIELD_PREFUND_BASE - expectedFee) * 6_500n) / 10_000n;
    const expectedParts    = YIELD_PREFUND_BASE - expectedFee - expectedLpShare;

    // LP slice + participants both stay logically inside pool_usdc_vault
    // (LP via pool.lp_distribution_balance earmark, parts via residual).
    const expectedPoolVault =
      BigInt(CYCLES_TOTAL) * perCyclePool - YIELD_DEPOSIT_BASE
        + expectedLpShare + expectedParts;
    const expectedEscrow =
      BigInt(CYCLES_TOTAL) * BigInt(MEMBERS_TARGET) * ESCROW_PER_INST;
      // stakes all released → removed from escrow above.
    // Solidarity vault is NOT credited from yield (v1.1) — only from
    // the 1% das parcelas in `contribute()`.
    const expectedSolidarity =
      BigInt(CYCLES_TOTAL) * BigInt(MEMBERS_TARGET) * SOLIDARITY_PER_INST;
    const expectedTreasury = expectedFee;
    const expectedMockVault = YIELD_DEPOSIT_BASE;   // tracked principal, stays

    expect(poolVault,  "pool vault")       .to.equal(expectedPoolVault);
    expect(escrow,     "escrow vault")     .to.equal(expectedEscrow);
    expect(solidarity, "solidarity vault") .to.equal(expectedSolidarity);
    expect(treasuryB,  "treasury")         .to.equal(expectedTreasury);
    expect(mockVault,  "mock vault")       .to.equal(expectedMockVault);
  });
});

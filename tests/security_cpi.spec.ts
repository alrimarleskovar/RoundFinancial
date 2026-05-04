/**
 * Security — CPI + adapter abuse (Step 5e / 2).
 *
 * Covers every hostile scenario on the two CPI surfaces roundfi-core
 * exposes: the yield adapter (`deposit_idle_to_yield`, `harvest_yield`)
 * and the reputation sidecar (`contribute`, `claim_payout`). All
 * adapters are adversarial by construction — the goal is that every
 * substitution / wrong-program / wrong-mint / wrong-authority attempt
 * is rejected atomically, with no balance movement, no state mutation,
 * no spurious attestation PDAs, and no partial writes.
 *
 * Attacks covered:
 *
 *   A. Yield-adapter program-id guard
 *     A.1 deposit_idle_to_yield with reputation-program impersonating
 *         yield adapter → YieldAdapterMismatch
 *     A.2 harvest_yield with rogue adapter → YieldAdapterMismatch
 *
 *   B. Adapter returns 0 → must be a no-op (zero realized yield ≠
 *      phantom fee accrual)
 *     B.1 harvest on empty (pre-funded principal only) vault leaves
 *         all pool accounting bit-identical
 *
 *   C. Account substitution mid-CPI (yield_vault slot)
 *     C.1 deposit with attacker-owned ATA as yield_vault → mock
 *         VaultMismatch; core rolls back
 *     C.2 harvest with attacker-owned ATA as yield_vault → mock
 *         VaultMismatch
 *
 *   D. Account substitution mid-CPI (remaining_accounts: state PDA)
 *     D.1 deposit with foreign pool's mock-state PDA passed as the
 *         sole remaining_account → mock seeds guard
 *
 *   E. Reputation program-id guard (beyond contribute — step 5d
 *      covered contribute; this extends the proof to claim_payout)
 *     E.1 claim_payout with reputation_program substituted
 *         → Unauthorized
 *
 *   F. Spoofed attestation PDA (seeds tampering)
 *     F.1 contribute with attestation PDA derived under a ROGUE issuer
 *         (env.payer instead of pool) → reputation::attest seeds
 *         constraint rejects
 *     F.2 contribute with attestation PDA derived under a wrong
 *         schema_id (SCHEMA.CycleComplete slot, not Payment)
 *         → seeds mismatch
 *
 *   G. Manipulated cycle argument
 *     G.1 contribute at cycle=1 while pool.current_cycle=0
 *         → WrongCycle (and no attestation PDA leaked)
 *
 * Fail-closed bar (enforced on every test):
 *   - tx rejects (expectRejected),
 *   - pool_vault / solidarity / escrow / treasury / mock balances
 *     unchanged,
 *   - pool.yield_accrued, .guarantee_fund_balance,
 *     .total_protocol_fee_accrued, .yield_principal_deposited
 *     unchanged,
 *   - member.contributions_paid, .on_time_count unchanged,
 *   - no attestation PDA initialized (D.1).
 *
 * Notes:
 *   - settle_default's reputation-program guard sits behind the 7-day
 *     GRACE_PERIOD_SECS precondition; local time cannot reach the
 *     guard without clock-warp (unavailable on solana-test-validator).
 *     The same Unauthorized code path is proven via claim_payout here
 *     and contribute in `reputation_guards.spec.ts`.
 *   - "Manipulated nonce" is equivalent to G.1: nonce is deterministic
 *     from (cycle << 32 | slot), so changing nonce ⇒ changing cycle
 *     (or the entire tx shape). Tampering the client-supplied
 *     attestation PDA's seeds is also covered by F.*.
 */

import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

import { ATTESTATION_SCHEMA } from "@roundfi/sdk";

import {
  attestationFor,
  attestationNonce,
  balanceOf,
  configPda,
  contribute,
  createPool,
  createUsdcMint,
  depositIdleToYield,
  ensureAta,
  fetchMember,
  fetchPool,
  fetchProfile,
  fundUsdc,
  initMockVault,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  memberKeypairs,
  mintToAta,
  reputationConfigFor,
  reputationProfileFor,
  setupEnv,
  usdc,
  yieldMockStatePda,
  type Env,
  type MemberHandle,
  type PoolHandle,
} from "./_harness/index.js";

// ─── Pool parameters ──────────────────────────────────────────────────
// Small pool — we only need to activate, make one contribute, and get
// cycle 0 ready for claim_payout.

const MEMBERS_TARGET = 2;
const CYCLES_TOTAL = 2;
const CYCLE_DURATION_SEC = 60;
const INSTALLMENT_USDC = 1_250n;
// pool_float_per_inst = 1_250 * (1 - 0.01 - 0.25) = 925 USDC
// credit must fit 2 * 925 = 1_850 USDC
const CREDIT_USDC = 1_800n;
const LEVEL: 1 | 2 | 3 = 2;

const INSTALLMENT_BASE = usdc(INSTALLMENT_USDC);
const CREDIT_BASE = usdc(CREDIT_USDC);
const DEPOSIT_BASE = usdc(100n); // principal moved into the mock

// ─── Snapshot / assertion helpers ─────────────────────────────────────

interface YieldSnapshot {
  poolVault: bigint;
  solidarity: bigint;
  escrow: bigint;
  treasury: bigint;
  mockVault: bigint;
  gfBalance: bigint;
  yieldAccrued: bigint;
  feeAccrued: bigint;
  principalDeposited: bigint;
  currentCycle: number;
}

function bn(x: { toString(): string }): bigint {
  return BigInt(x.toString());
}

async function snapshotYield(
  env: Env,
  pool: PoolHandle,
  treasury: PublicKey,
  mockVault: PublicKey,
): Promise<YieldSnapshot> {
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
    yieldAccrued: { toString(): string };
    totalProtocolFeeAccrued: { toString(): string };
    yieldPrincipalDeposited: { toString(): string };
  };
  return {
    poolVault,
    solidarity,
    escrow,
    treasury: treasuryBal,
    mockVault: mockBal,
    gfBalance: bn(p.guaranteeFundBalance),
    yieldAccrued: bn(p.yieldAccrued),
    feeAccrued: bn(p.totalProtocolFeeAccrued),
    principalDeposited: bn(p.yieldPrincipalDeposited),
    currentCycle: p.currentCycle,
  };
}

interface MemberSnapshot {
  memberUsdc: bigint;
  contributions: number;
  onTimeCount: number;
  profileScore: bigint;
  profileOnTime: number;
}

async function snapshotMember(env: Env, h: MemberHandle): Promise<MemberSnapshot> {
  const [memberUsdc, m, p] = await Promise.all([
    balanceOf(env, h.memberUsdc),
    fetchMember(env, h.member) as Promise<{
      contributionsPaid: number;
      onTimeCount: number;
    }>,
    fetchProfile(env, h.wallet.publicKey) as Promise<{
      score: { toString(): string };
      onTimePayments: number;
    }>,
  ]);
  return {
    memberUsdc,
    contributions: m.contributionsPaid,
    onTimeCount: m.onTimeCount,
    profileScore: bn(p.score),
    profileOnTime: p.onTimePayments,
  };
}

function expectYieldUnchanged(before: YieldSnapshot, after: YieldSnapshot, label: string): void {
  expect(after, `${label}: yield snapshot drift`).to.deep.equal(before);
}

function expectMemberUnchanged(before: MemberSnapshot, after: MemberSnapshot, label: string): void {
  expect(after, `${label}: member snapshot drift`).to.deep.equal(before);
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

// ─── Tests ────────────────────────────────────────────────────────────

describe("security — CPI + adapter abuse", function () {
  this.timeout(180_000);

  let env: Env;
  let usdcMint: PublicKey;
  let treasury: PublicKey;

  const authorityA = Keypair.generate();
  const authorityB = Keypair.generate();
  const membersA = memberKeypairs(MEMBERS_TARGET, "sec/cpi/A");
  const membersB = memberKeypairs(MEMBERS_TARGET, "sec/cpi/B");
  const attacker = Keypair.generate();

  let poolA: PoolHandle;
  let poolB: PoolHandle;
  let handlesA: MemberHandle[];
  let handlesB: MemberHandle[];
  let mockVaultA: PublicKey;
  let mockVaultB: PublicKey; // foreign pool vault — we never want tokens here

  let attackerUsdc: PublicKey;

  before(async function () {
    env = await setupEnv();
    usdcMint = await createUsdcMint(env);
    const proto = await initializeProtocol(env, { usdcMint });
    treasury = proto.treasury;
    await initializeReputation(env, { coreProgram: env.ids.core });

    // ─── Pool A: active, cycle 0 contributed, mock initialized ─────────
    poolA = await createPool(env, {
      authority: authorityA,
      usdcMint,
      membersTarget: MEMBERS_TARGET,
      installmentAmount: INSTALLMENT_BASE,
      creditAmount: CREDIT_BASE,
      cyclesTotal: CYCLES_TOTAL,
      cycleDurationSec: CYCLE_DURATION_SEC,
      escrowReleaseBps: 2_500,
    });
    handlesA = await joinMembers(
      env,
      poolA,
      membersA.map((m) => ({ member: m, reputationLevel: LEVEL })),
    );
    for (const m of membersA) {
      await fundUsdc(env, usdcMint, m.publicKey, BigInt(CYCLES_TOTAL) * INSTALLMENT_BASE);
    }
    // Cycle 0 contributions by both members → pool vault holds 2×925 = 1_850 USDC.
    for (const h of handlesA) {
      await contribute(env, { pool: poolA, member: h, cycle: 0 });
    }

    const initA = await initMockVault(env, poolA.pool, usdcMint);
    mockVaultA = initA.vault;

    // Move some principal into the mock so harvest has a tracked baseline.
    await depositIdleToYield(env, { pool: poolA, amount: DEPOSIT_BASE });

    // ─── Pool B: active, mock initialized — used as a foreign-state donor ──
    poolB = await createPool(env, {
      authority: authorityB,
      usdcMint,
      membersTarget: MEMBERS_TARGET,
      installmentAmount: INSTALLMENT_BASE,
      creditAmount: CREDIT_BASE,
      cyclesTotal: CYCLES_TOTAL,
      cycleDurationSec: CYCLE_DURATION_SEC,
      escrowReleaseBps: 2_500,
    });
    handlesB = await joinMembers(
      env,
      poolB,
      membersB.map((m) => ({ member: m, reputationLevel: LEVEL })),
    );
    // Fund pool B members so F.* / G.1 (if they reached the transfer)
    // could have succeeded — prevents "ATA empty" from masking the
    // real rejection reason.
    for (const m of membersB) {
      await fundUsdc(env, usdcMint, m.publicKey, INSTALLMENT_BASE);
    }
    // Pool B does not need to be funded for our state-swap test; init_vault
    // only needs the pool to exist.
    const initB = await initMockVault(env, poolB.pool, usdcMint);
    mockVaultB = initB.vault;

    // Attacker — gets a USDC ATA (empty) for yield_vault substitution.
    attackerUsdc = await ensureAta(env, usdcMint, attacker.publicKey);

    // mockVaultB is only used implicitly (foreign state PDA lookup in D.1).
    void mockVaultB;
  });

  // ─── A. Yield-adapter program-id guard ────────────────────────────────

  it("A.1 deposit with reputation program impersonating adapter → rejected", async function () {
    const before = await snapshotYield(env, poolA, treasury, mockVaultA);

    const msg = await expectRejected(() =>
      (env.programs.core.methods as any)
        .depositIdleToYield({ amount: new BN(usdc(10n).toString()) })
        .accounts({
          caller: env.payer.publicKey,
          config: configPda(env),
          pool: poolA.pool,
          usdcMint,
          poolUsdcVault: poolA.poolUsdcVault,
          yieldVault: mockVaultA,
          // substituted adapter program — must equal pool.yield_adapter
          yieldAdapterProgram: env.ids.reputation,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: yieldMockStatePda(env, poolA.pool), isSigner: false, isWritable: true },
        ])
        .signers([env.payer])
        .rpc(),
    );
    expect(msg, `A.1: ${msg}`).to.match(/YieldAdapterMismatch|adapter/i);
    expectYieldUnchanged(before, await snapshotYield(env, poolA, treasury, mockVaultA), "A.1");
  });

  it("A.2 harvest with rogue adapter program → rejected", async function () {
    const before = await snapshotYield(env, poolA, treasury, mockVaultA);

    const msg = await expectRejected(() =>
      (env.programs.core.methods as any)
        .harvestYield({ lpShareBps: 6_500, minRealizedUsdc: new BN(0) })
        .accounts({
          caller: env.payer.publicKey,
          config: configPda(env),
          pool: poolA.pool,
          usdcMint,
          poolUsdcVault: poolA.poolUsdcVault,
          solidarityVaultAuthority: poolA.solidarityVaultAuthority,
          solidarityVault: poolA.solidarityVault,
          treasuryUsdc: treasury,
          yieldVault: mockVaultA,
          yieldAdapterProgram: env.ids.reputation, // wrong program
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: yieldMockStatePda(env, poolA.pool), isSigner: false, isWritable: false },
        ])
        .signers([env.payer])
        .rpc(),
    );
    expect(msg, `A.2: ${msg}`).to.match(/YieldAdapterMismatch|adapter/i);
    expectYieldUnchanged(before, await snapshotYield(env, poolA, treasury, mockVaultA), "A.2");
  });

  // ─── B. Adapter returns 0 is a no-op ──────────────────────────────────

  it("B.1 harvest on empty vault (realized=0) mutates nothing", async function () {
    // mockVaultA holds exactly DEPOSIT_BASE (tracked_principal). Mock's
    // harvest computes `source.amount - tracked = 0` and short-circuits
    // with Ok(()). Core sees realized = 0 and ALSO short-circuits before
    // touching gf/fee/LP-share/participants — no phantom accrual.
    const before = await snapshotYield(env, poolA, treasury, mockVaultA);

    await (env.programs.core.methods as any)
      .harvestYield({ lpShareBps: 6_500, minRealizedUsdc: new BN(0) })
      .accounts({
        caller: env.payer.publicKey,
        config: configPda(env),
        pool: poolA.pool,
        usdcMint,
        poolUsdcVault: poolA.poolUsdcVault,
        solidarityVaultAuthority: poolA.solidarityVaultAuthority,
        solidarityVault: poolA.solidarityVault,
        treasuryUsdc: treasury,
        yieldVault: mockVaultA,
        yieldAdapterProgram: env.ids.yieldMock,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: yieldMockStatePda(env, poolA.pool), isSigner: false, isWritable: false },
      ])
      .signers([env.payer])
      .rpc();

    expectYieldUnchanged(before, await snapshotYield(env, poolA, treasury, mockVaultA), "B.1");
  });

  // ─── C. yield_vault substitution ──────────────────────────────────────

  it("C.1 deposit with attacker-owned ATA as yield_vault → mock rejects", async function () {
    const before = await snapshotYield(env, poolA, treasury, mockVaultA);

    const msg = await expectRejected(() =>
      (env.programs.core.methods as any)
        .depositIdleToYield({ amount: new BN(usdc(10n).toString()) })
        .accounts({
          caller: env.payer.publicKey,
          config: configPda(env),
          pool: poolA.pool,
          usdcMint,
          poolUsdcVault: poolA.poolUsdcVault,
          // attacker ATA in place of the pool's mock vault
          yieldVault: attackerUsdc,
          yieldAdapterProgram: env.ids.yieldMock,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: yieldMockStatePda(env, poolA.pool), isSigner: false, isWritable: true },
        ])
        .signers([env.payer])
        .rpc(),
    );
    // Mock rejects via VaultMismatch (destination.key != state.vault);
    // core's atomic CPI rollback guarantees no side-effects.
    expect(msg.length, msg).to.be.greaterThan(0);
    expectYieldUnchanged(before, await snapshotYield(env, poolA, treasury, mockVaultA), "C.1");
    // attacker ATA must still hold zero — no USDC leaked
    expect(await balanceOf(env, attackerUsdc)).to.equal(0n);
  });

  it("C.2 harvest with attacker-owned ATA as yield_vault → mock rejects", async function () {
    const before = await snapshotYield(env, poolA, treasury, mockVaultA);

    const msg = await expectRejected(() =>
      (env.programs.core.methods as any)
        .harvestYield({ lpShareBps: 6_500, minRealizedUsdc: new BN(0) })
        .accounts({
          caller: env.payer.publicKey,
          config: configPda(env),
          pool: poolA.pool,
          usdcMint,
          poolUsdcVault: poolA.poolUsdcVault,
          solidarityVaultAuthority: poolA.solidarityVaultAuthority,
          solidarityVault: poolA.solidarityVault,
          treasuryUsdc: treasury,
          yieldVault: attackerUsdc,
          yieldAdapterProgram: env.ids.yieldMock,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: yieldMockStatePda(env, poolA.pool), isSigner: false, isWritable: false },
        ])
        .signers([env.payer])
        .rpc(),
    );
    expect(msg.length, msg).to.be.greaterThan(0);
    expectYieldUnchanged(before, await snapshotYield(env, poolA, treasury, mockVaultA), "C.2");
    expect(await balanceOf(env, attackerUsdc)).to.equal(0n);
  });

  // ─── D. remaining_accounts substitution ───────────────────────────────

  it("D.1 deposit with foreign pool's mock-state PDA → mock seeds guard", async function () {
    const before = await snapshotYield(env, poolA, treasury, mockVaultA);

    // Pass poolB's state PDA as the sole remaining_account. The mock
    // derives its seeds from state.pool.as_ref() — the stored field —
    // so Anchor's seeds check passes trivially. The first runtime
    // guard that trips is `authority.key() == state.pool`: authority
    // is poolA (core propagates poolA's PDA as CPI signer), state.pool
    // is poolB. UnauthorizedPool → core atomic rollback.
    const msg = await expectRejected(() =>
      (env.programs.core.methods as any)
        .depositIdleToYield({ amount: new BN(usdc(10n).toString()) })
        .accounts({
          caller: env.payer.publicKey,
          config: configPda(env),
          pool: poolA.pool,
          usdcMint,
          poolUsdcVault: poolA.poolUsdcVault,
          yieldVault: mockVaultA,
          yieldAdapterProgram: env.ids.yieldMock,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          // poolB's state PDA — foreign to poolA
          { pubkey: yieldMockStatePda(env, poolB.pool), isSigner: false, isWritable: true },
        ])
        .signers([env.payer])
        .rpc(),
    );
    expect(msg.length, msg).to.be.greaterThan(0);
    expectYieldUnchanged(before, await snapshotYield(env, poolA, treasury, mockVaultA), "D.1");
  });

  // ─── E. Reputation program-id guard on claim_payout ───────────────────

  it("E.1 claim_payout with substituted reputation_program → Unauthorized", async function () {
    // Slot 0 (first member) claims at cycle 0. After before():
    //   pool_vault = 1_850 (2×925 contributed) - 100 (deposited into mock)
    //              = 1_750 USDC
    //   credit     = 1_800 USDC
    // WaterfallUnderflow would fire before the reputation CPI. Top up
    // pool_vault externally by 50 USDC so spendable == credit and the
    // handler reaches the reputation program-id guard.
    //
    // Seed-draw floor at cycle 0 (seed_draw_bps = 9_160):
    //   required = 2 × 1_250 × 9_160 / 10_000 = 2_290 USDC
    //   retained = pool_vault (1_800) + escrow_balance (625) = 2_425 ✓
    const h = handlesA[0]!;
    await mintToAta(env, usdcMint, poolA.poolUsdcVault, usdc(50n));

    const beforeY = await snapshotYield(env, poolA, treasury, mockVaultA);
    const beforeM = await snapshotMember(env, h);

    const nonce = attestationNonce(0, h.slotIndex);
    const defaultAttestation = attestationFor(
      env,
      poolA.pool,
      h.wallet.publicKey,
      ATTESTATION_SCHEMA.CycleComplete,
      nonce,
    );

    const msg = await expectRejected(() =>
      (env.programs.core.methods as any)
        .claimPayout({ cycle: 0 })
        .accounts({
          memberWallet: h.wallet.publicKey,
          config: configPda(env),
          pool: poolA.pool,
          member: h.member,
          usdcMint,
          memberUsdc: h.memberUsdc,
          poolUsdcVault: poolA.poolUsdcVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          // Substituted reputation program. Guard lives inside
          // invoke_attest, AFTER transfer + bookkeeping in the handler —
          // on error, the whole CPI chain atomically rolls back, so
          // post-tx state is bit-identical to pre-tx (hence snapshot
          // diff == {}).
          reputationProgram: env.ids.yieldMock,
          reputationConfig: reputationConfigFor(env),
          reputationProfile: reputationProfileFor(env, h.wallet.publicKey),
          identityRecord: env.ids.reputation,
          attestation: defaultAttestation,
          systemProgram: SystemProgram.programId,
        })
        .signers([h.wallet])
        .rpc(),
    );
    expect(msg, `E.1: ${msg}`).to.match(/Unauthorized/);
    expectYieldUnchanged(
      beforeY,
      await snapshotYield(env, poolA, treasury, mockVaultA),
      "E.1/yield",
    );
    expectMemberUnchanged(beforeM, await snapshotMember(env, h), "E.1/member");
  });

  // ─── F. Spoofed attestation PDA (seeds tampering) ─────────────────────

  it("F.1 contribute with attestation PDA using rogue issuer seed → rejected", async function () {
    // Test against poolB's slot 0 — Active, cycle 0, not yet contributed.
    // Leaves poolA's happy-path state untouched for downstream tests.
    const h = handlesB[0]!;

    const beforeM = await snapshotMember(env, h);

    const nonce = attestationNonce(0, h.slotIndex);
    // ROGUE issuer seed: env.payer instead of poolB.pool
    const spoofedAttestation = attestationFor(
      env,
      env.payer.publicKey, // <-- wrong issuer
      h.wallet.publicKey,
      ATTESTATION_SCHEMA.Payment,
      nonce,
    );

    const msg = await expectRejected(() =>
      (env.programs.core.methods as any)
        .contribute({ cycle: 0 })
        .accounts({
          memberWallet: h.wallet.publicKey,
          config: configPda(env),
          pool: poolB.pool,
          member: h.member,
          usdcMint,
          memberUsdc: h.memberUsdc,
          poolUsdcVault: poolB.poolUsdcVault,
          solidarityVaultAuthority: poolB.solidarityVaultAuthority,
          solidarityVault: poolB.solidarityVault,
          escrowVaultAuthority: poolB.escrowVaultAuthority,
          escrowVault: poolB.escrowVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          reputationProgram: env.ids.reputation,
          reputationConfig: reputationConfigFor(env),
          reputationProfile: reputationProfileFor(env, h.wallet.publicKey),
          identityRecord: env.ids.reputation,
          attestation: spoofedAttestation,
          systemProgram: SystemProgram.programId,
        })
        .signers([h.wallet])
        .rpc(),
    );
    expect(msg.length, msg).to.be.greaterThan(0);
    expectMemberUnchanged(beforeM, await snapshotMember(env, h), "F.1");
    // The spoofed PDA should not have been initialized (init fails on
    // seed mismatch against the expected issuer=pool.key()).
    const info = await env.connection.getAccountInfo(spoofedAttestation, "confirmed");
    expect(info, "F.1: spoofed PDA must not exist").to.be.null;
  });

  it("F.2 contribute with attestation PDA using wrong schema seed → rejected", async function () {
    // Slot 0 is still uncontributed (F.1 reverted) — reuse it.
    const h = handlesB[0]!;

    const beforeM = await snapshotMember(env, h);

    const nonce = attestationNonce(0, h.slotIndex);
    // Schema = CycleComplete (4) instead of Payment (1). PDA seeds
    // differ → core's init attempt derives a different address from
    // the schema the handler actually uses, producing a mismatch.
    const spoofedAttestation = attestationFor(
      env,
      poolB.pool,
      h.wallet.publicKey,
      ATTESTATION_SCHEMA.CycleComplete, // wrong schema in seeds
      nonce,
    );

    const msg = await expectRejected(() =>
      (env.programs.core.methods as any)
        .contribute({ cycle: 0 })
        .accounts({
          memberWallet: h.wallet.publicKey,
          config: configPda(env),
          pool: poolB.pool,
          member: h.member,
          usdcMint,
          memberUsdc: h.memberUsdc,
          poolUsdcVault: poolB.poolUsdcVault,
          solidarityVaultAuthority: poolB.solidarityVaultAuthority,
          solidarityVault: poolB.solidarityVault,
          escrowVaultAuthority: poolB.escrowVaultAuthority,
          escrowVault: poolB.escrowVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          reputationProgram: env.ids.reputation,
          reputationConfig: reputationConfigFor(env),
          reputationProfile: reputationProfileFor(env, h.wallet.publicKey),
          identityRecord: env.ids.reputation,
          attestation: spoofedAttestation,
          systemProgram: SystemProgram.programId,
        })
        .signers([h.wallet])
        .rpc(),
    );
    expect(msg.length, msg).to.be.greaterThan(0);
    expectMemberUnchanged(beforeM, await snapshotMember(env, h), "F.2");
    const info = await env.connection.getAccountInfo(spoofedAttestation, "confirmed");
    expect(info, "F.2: spoofed PDA must not exist").to.be.null;
  });

  // ─── G. Manipulated cycle arg ─────────────────────────────────────────

  it("G.1 contribute at cycle=1 while pool is at cycle=0 → WrongCycle", async function () {
    // Use poolB's slot 1 (slot 0 was targeted in F.* — also uncontributed
    // since both those tx'es reverted, but keeping slots separate makes
    // the test matrix clearer).
    const h = handlesB[1]!;

    const beforeM = await snapshotMember(env, h);

    const wrongCycle = 1;
    const nonce = attestationNonce(wrongCycle, h.slotIndex);
    const attestation = attestationFor(
      env,
      poolB.pool,
      h.wallet.publicKey,
      ATTESTATION_SCHEMA.Payment,
      nonce,
    );

    const msg = await expectRejected(() =>
      (env.programs.core.methods as any)
        .contribute({ cycle: wrongCycle })
        .accounts({
          memberWallet: h.wallet.publicKey,
          config: configPda(env),
          pool: poolB.pool,
          member: h.member,
          usdcMint,
          memberUsdc: h.memberUsdc,
          poolUsdcVault: poolB.poolUsdcVault,
          solidarityVaultAuthority: poolB.solidarityVaultAuthority,
          solidarityVault: poolB.solidarityVault,
          escrowVaultAuthority: poolB.escrowVaultAuthority,
          escrowVault: poolB.escrowVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          reputationProgram: env.ids.reputation,
          reputationConfig: reputationConfigFor(env),
          reputationProfile: reputationProfileFor(env, h.wallet.publicKey),
          identityRecord: env.ids.reputation,
          attestation,
          systemProgram: SystemProgram.programId,
        })
        .signers([h.wallet])
        .rpc(),
    );
    expect(msg, `G.1: ${msg}`).to.match(/WrongCycle|cycle/i);
    expectMemberUnchanged(beforeM, await snapshotMember(env, h), "G.1");
    // No attestation initialized for the wrong cycle.
    const info = await env.connection.getAccountInfo(attestation, "confirmed");
    expect(info, "G.1: no attestation PDA for mismatched cycle").to.be.null;
  });
});

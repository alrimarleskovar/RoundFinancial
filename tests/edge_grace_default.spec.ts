/**
 * Edge — grace-period default (Step 5f / 2).
 *
 * `roundfi-core::settle_default` protects late members with a
 * hard-coded 7-day grace window (`GRACE_PERIOD_SECS = 604_800`,
 * constants.rs:20). The handler rejects with `GracePeriodNotElapsed`
 * when `clock.unix_timestamp < pool.next_cycle_at + GRACE_PERIOD_SECS`
 * and proceeds with the seizure waterfall otherwise. Localnet's
 * test-validator can't advance its clock by 7 days, so we exercise
 * the post-grace leg via `solana-bankrun`'s `setClock` primitive —
 * the *only* place bankrun is used in the whole suite.
 *
 * Guardrails (see feedback/step4c_economic_security.md):
 *   - NO on-chain code changes. The core program is unchanged.
 *   - NO feature flags. Bankrun only affects the test harness.
 *   - The scenario state is seeded via `setAccount` (see
 *     `_harness/bankrun.ts`) so we don't have to run `join_pool`
 *     — that handler CPIs into Metaplex Core, which isn't loaded
 *     in the bankrun workspace. `config.reputation_program =
 *     Pubkey::default()` makes settle_default skip its reputation
 *     CPI, avoiding a second cross-program dependency.
 *
 * Assertions:
 *   A. Pre-grace (`clock < next_cycle_at + GRACE_PERIOD_SECS`)
 *      → rejects with `GracePeriodNotElapsed`.
 *
 *   B. Post-grace (`clock >= next_cycle_at + GRACE_PERIOD_SECS`)
 *      → succeeds and:
 *        - `member.defaulted = true`
 *        - `pool.defaulted_members = 1`
 *        - `pool_usdc_vault` balance increased by the seized total
 *        - solidarity + escrow vaults drained by the seized legs
 *        - D/C invariant `D_rem * C_init <= C_rem * D_init` still
 *          holds on the post-seizure member state.
 *
 *   C. Re-calling `settle_default` on the already-defaulted member
 *      rejects with `DefaultedMember` (one-way state transition).
 */

import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  AccountLayout,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import {
  escrowVaultAuthorityPda,
  memberPda,
  poolPda,
  protocolConfigPda,
  solidarityVaultAuthorityPda,
  yieldVaultAuthorityPda,
} from "@roundfi/sdk";

import {
  setBankrunUnixTs,
  setupBankrunEnv,
  writeAnchorAccount,
  writeMintAccount,
  writeTokenAccount,
  type BankrunEnv,
} from "./_harness/bankrun.js";

// ─── Scenario parameters ──────────────────────────────────────────────
// Small, concrete numbers chosen so seizure is non-trivially > 0 while
// the D/C invariant still holds at start. See the seizure walkthrough
// comment near test (B) for the exact math.

const GRACE_PERIOD_SECS = 604_800n;

const MEMBERS_TARGET      = 3;
const CYCLES_TOTAL        = 3;
const CYCLE_DURATION_SEC  = 60n;
const INSTALLMENT         = 1_000_000_000n; // 1_000 USDC
const CREDIT              = 3_000_000_000n; // 3_000 USDC == 3 × installment
const STAKE_INITIAL       = 1_500_000_000n; // 50% of credit (Level-1)
const ESCROW_DEPOSITED    =   250_000_000n; // one installment × 25%

const SOLIDARITY_BALANCE  =    50_000_000n; // 50 USDC pre-seed
const ESCROW_VAULT_BAL    = STAKE_INITIAL + ESCROW_DEPOSITED; // 1_750 USDC
const POOL_VAULT_INITIAL  =             0n;

// Fixed simulated unix time representing pool.next_cycle_at.
// ~ 2027-01-15 UTC — safely in the future even for slow CI clocks.
const NEXT_CYCLE_AT       = 1_800_000_000n;

const POOL_SEED_ID        = 999n;

// Defaulter state on the chain before settle_default:
//   contributions_paid = 1  (paid cycle 0 only)
//   pool.current_cycle = 2  (cycle has advanced — defaulter is behind
//                            by missing cycle 1's installment)
// Caller passes args.cycle = 2 per the `cycle == current_cycle` guard.
const CONTRIBUTIONS_PAID  = 1;
const CURRENT_CYCLE       = 2;
const DEFAULT_CYCLE_ARG   = 2;

// ─── Helpers ──────────────────────────────────────────────────────────

async function readTokenBalance(
  env: BankrunEnv,
  ata: PublicKey,
): Promise<bigint> {
  const info = await env.context.banksClient.getAccount(ata);
  if (!info) {
    throw new Error(`token account not found: ${ata.toBase58()}`);
  }
  const raw = AccountLayout.decode(Buffer.from(info.data));
  return raw.amount;
}

// ─── Spec ─────────────────────────────────────────────────────────────

describe("edge — grace-period default (bankrun setClock)", function () {
  this.timeout(60_000);

  let env: BankrunEnv;

  // Fabricated identities. None of these wallets need to sign — the
  // only signer is the bankrun payer (acting as `caller`).
  const poolAuthority    = Keypair.generate();
  const defaulterWallet  = Keypair.generate();
  const nftAsset         = Keypair.generate();
  const treasury         = Keypair.generate();
  const metaplexCore     = new PublicKey(
    "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
  );

  // The USDC mint we fabricate — any fresh pubkey.
  const usdcMint = Keypair.generate().publicKey;

  // Derived addresses (filled in before()).
  let configPk: PublicKey;             let configBump: number;
  let poolPk: PublicKey;               let poolBump: number;
  let memberPk: PublicKey;             let memberBump: number;
  let escrowVaultAuth: PublicKey;      let escrowBump: number;
  let solidarityVaultAuth: PublicKey;  let solidarityBump: number;
  let yieldVaultAuth: PublicKey;       let yieldBump: number;
  let poolUsdcVault: PublicKey;
  let escrowVault: PublicKey;
  let solidarityVault: PublicKey;

  before(async function () {
    env = await setupBankrunEnv();

    // ─── Derive PDAs + ATAs ──────────────────────────────────────────
    [configPk, configBump]           = protocolConfigPda(env.ids.core);
    [poolPk,   poolBump]             = poolPda(env.ids.core, poolAuthority.publicKey, POOL_SEED_ID);
    [memberPk, memberBump]           = memberPda(env.ids.core, poolPk, defaulterWallet.publicKey);
    [escrowVaultAuth, escrowBump]    = escrowVaultAuthorityPda(env.ids.core, poolPk);
    [solidarityVaultAuth, solidarityBump] = solidarityVaultAuthorityPda(env.ids.core, poolPk);
    [yieldVaultAuth, yieldBump]      = yieldVaultAuthorityPda(env.ids.core, poolPk);

    poolUsdcVault   = getAssociatedTokenAddressSync(usdcMint, poolPk, true);
    escrowVault     = getAssociatedTokenAddressSync(usdcMint, escrowVaultAuth, true);
    solidarityVault = getAssociatedTokenAddressSync(usdcMint, solidarityVaultAuth, true);

    // ─── Seed the USDC mint ──────────────────────────────────────────
    writeMintAccount(env.context, usdcMint, {
      mintAuthority: env.payer.publicKey,
      decimals: 6,
    });

    // ─── Seed the three pool token vaults ────────────────────────────
    writeTokenAccount(env.context, poolUsdcVault, {
      mint: usdcMint, owner: poolPk, amount: POOL_VAULT_INITIAL,
    });
    writeTokenAccount(env.context, escrowVault, {
      mint: usdcMint, owner: escrowVaultAuth, amount: ESCROW_VAULT_BAL,
    });
    writeTokenAccount(env.context, solidarityVault, {
      mint: usdcMint, owner: solidarityVaultAuth, amount: SOLIDARITY_BALANCE,
    });

    // ─── Seed ProtocolConfig ─────────────────────────────────────────
    // `reputation_program = PublicKey.default` makes settle_default
    // skip its reputation CPI — exactly the branch we want for an
    // isolated grace-period test.
    await writeAnchorAccount(env.context, env.programs.core, "protocolConfig", configPk, {
      authority:           env.payer.publicKey,
      treasury:            treasury.publicKey,
      usdcMint,
      metaplexCore,
      defaultYieldAdapter: env.ids.yieldMock,
      reputationProgram:   PublicKey.default,
      feeBpsYield:         2_000,
      feeBpsCycleL1:       200,
      feeBpsCycleL2:       100,
      feeBpsCycleL3:       0,
      guaranteeFundBps:    15_000,
      paused:              false,
      bump:                configBump,
    });

    // ─── Seed Pool (Active, current_cycle=2, next_cycle_at=T0) ───────
    await writeAnchorAccount(env.context, env.programs.core, "pool", poolPk, {
      authority:                poolAuthority.publicKey,
      seedId:                   new BN(POOL_SEED_ID.toString()),
      usdcMint,
      yieldAdapter:             env.ids.yieldMock,
      membersTarget:            MEMBERS_TARGET,
      installmentAmount:        new BN(INSTALLMENT.toString()),
      creditAmount:             new BN(CREDIT.toString()),
      cyclesTotal:              CYCLES_TOTAL,
      cycleDuration:            new BN(CYCLE_DURATION_SEC.toString()),
      seedDrawBps:              9_160,
      solidarityBps:            100,
      escrowReleaseBps:         2_500,
      membersJoined:            MEMBERS_TARGET,
      status:                   1, // Active
      startedAt:                new BN((NEXT_CYCLE_AT - CYCLE_DURATION_SEC * BigInt(CURRENT_CYCLE + 1)).toString()),
      currentCycle:             CURRENT_CYCLE,
      nextCycleAt:              new BN(NEXT_CYCLE_AT.toString()),
      totalContributed:         new BN(0),
      totalPaidOut:             new BN(0),
      solidarityBalance:        new BN(SOLIDARITY_BALANCE.toString()),
      escrowBalance:            new BN(ESCROW_VAULT_BAL.toString()),
      yieldAccrued:             new BN(0),
      guaranteeFundBalance:     new BN(0),
      totalProtocolFeeAccrued:  new BN(0),
      yieldPrincipalDeposited:  new BN(0),
      defaultedMembers:         0,
      slotsBitmap:              Buffer.from([0x07, 0, 0, 0, 0, 0, 0, 0]),
      bump:                     poolBump,
      escrowVaultBump:          escrowBump,
      solidarityVaultBump:      solidarityBump,
      yieldVaultBump:           yieldBump,
    });

    // ─── Seed the defaulter's Member record ──────────────────────────
    await writeAnchorAccount(env.context, env.programs.core, "member", memberPk, {
      pool:                      poolPk,
      wallet:                    defaulterWallet.publicKey,
      nftAsset:                  nftAsset.publicKey,
      slotIndex:                 2,
      reputationLevel:           1,
      stakeBps:                  5_000,
      stakeDeposited:            new BN(STAKE_INITIAL.toString()),
      contributionsPaid:         CONTRIBUTIONS_PAID,
      totalContributed:          new BN(INSTALLMENT.toString()),
      totalReceived:             new BN(0),
      escrowBalance:             new BN(ESCROW_DEPOSITED.toString()),
      onTimeCount:               1,
      lateCount:                 0,
      defaulted:                 false,
      paidOut:                   false,
      lastReleasedCheckpoint:    0,
      joinedAt:                  new BN((NEXT_CYCLE_AT - 120n).toString()),
      stakeDepositedInitial:     new BN(STAKE_INITIAL.toString()),
      totalEscrowDeposited:      new BN(ESCROW_DEPOSITED.toString()),
      lastTransferredAt:         new BN(0),
      bump:                      memberBump,
    });
  });

  // ─── Shared call builder ────────────────────────────────────────────
  // Reputation accounts are UncheckedAccount on the core side — fresh
  // non-existent pubkeys are acceptable because the CPI is skipped
  // when `config.reputation_program == Pubkey::default()`. Passing
  // `identity_record == reputation_program` is the "None" sentinel
  // used everywhere in the harness.
  function settleAccounts() {
    return {
      caller:                 env.payer.publicKey,
      config:                 configPk,
      pool:                   poolPk,
      member:                 memberPk,
      defaultedMemberWallet:  defaulterWallet.publicKey,
      usdcMint,
      poolUsdcVault,
      solidarityVaultAuthority: solidarityVaultAuth,
      solidarityVault,
      escrowVaultAuthority:   escrowVaultAuth,
      escrowVault,
      tokenProgram:           TOKEN_PROGRAM_ID,
      reputationProgram:      env.ids.reputation,
      reputationConfig:       env.ids.reputation,
      reputationProfile:      env.ids.reputation,
      identityRecord:         env.ids.reputation,
      attestation:            env.ids.reputation,
      systemProgram:          SystemProgram.programId,
    };
  }

  it("A. pre-grace: rejects with GracePeriodNotElapsed", async function () {
    // Clock positioned safely inside the grace window — 1s before the
    // cycle deadline itself. Any negative offset works; we pick -1 to
    // prove even the boundary-1s case is inside the window.
    await setBankrunUnixTs(env.context, NEXT_CYCLE_AT - 1n);

    let threw = false;
    try {
      await (env.programs.core.methods as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .settleDefault({ cycle: DEFAULT_CYCLE_ARG } as any)
        .accounts(settleAccounts())
        .rpc();
    } catch (e) {
      threw = true;
      const err = e as { logs?: string[]; message?: string };
      const haystack = [
        ...(err.logs ?? []),
        err.message ?? "",
        String(e),
      ].join("\n");
      expect(haystack).to.match(
        /GracePeriodNotElapsed/,
        `expected GracePeriodNotElapsed, got:\n${haystack}`,
      );
    }
    expect(threw, "pre-grace settle_default must reject").to.equal(true);
  });

  it("B. post-grace: seizes collateral in waterfall order, flips member.defaulted", async function () {
    // Bump the clock well past the grace deadline. Using +10s past the
    // deadline to leave no ambiguity. The specific value beyond the
    // threshold is irrelevant — only `clock >= deadline` matters.
    await setBankrunUnixTs(
      env.context,
      NEXT_CYCLE_AT + GRACE_PERIOD_SECS + 10n,
    );

    const poolVaultBefore       = await readTokenBalance(env, poolUsdcVault);
    const solidarityVaultBefore = await readTokenBalance(env, solidarityVault);
    const escrowVaultBefore     = await readTokenBalance(env, escrowVault);

    await (env.programs.core.methods as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .settleDefault({ cycle: DEFAULT_CYCLE_ARG } as any)
      .accounts(settleAccounts())
      .rpc();

    // ─── Seizure walkthrough (settle_default.rs:182-272) ──────────────
    // D_init = credit = 3_000, D_rem = (3 − 1) × 1_000 = 2_000
    // C_init = stake_initial + total_escrow_deposited = 1_500 + 250 = 1_750
    // missed = min(installment=1_000, d_rem=2_000) = 1_000
    //
    // 1) from_solidarity = min(missed=1_000, avail=50) = 50
    // 2) shortfall = 950. max_seizure_respecting_dc(D=2000, C=1750, 3000)
    //    = C_before − ceil(D_rem × C_init / D_init)
    //    = 1_750 − ceil(2_000 × 1_750 / 3_000) = 1_750 − 1_167 = 583
    //    cap_escrow = min(escrow_balance=250, vault=1_750) = 250
    //    → from_escrow = min(950, 250, 583) = 250
    // 3) shortfall = 700. c_after_escrow = 1_500.
    //    max_seizure = 1_500 − 1_167 = 333
    //    cap_stake = min(stake=1_500, vault_remaining=1_500) = 1_500
    //    → from_stake = min(700, 1_500, 333) = 333
    //
    // Total seized = 50 + 250 + 333 = 633
    const EXPECTED_SEIZED = 633_000_000n;

    // Token flows — pool_usdc_vault absorbs the full seizure.
    const poolVaultAfter       = await readTokenBalance(env, poolUsdcVault);
    const solidarityVaultAfter = await readTokenBalance(env, solidarityVault);
    const escrowVaultAfter     = await readTokenBalance(env, escrowVault);

    expect(poolVaultAfter - poolVaultBefore)
      .to.equal(EXPECTED_SEIZED, "pool vault must receive the full seized total");
    expect(solidarityVaultBefore - solidarityVaultAfter)
      .to.equal(50_000_000n, "solidarity vault drained by full balance");
    expect(escrowVaultBefore - escrowVaultAfter)
      .to.equal(583_000_000n, "escrow vault drained by escrow+stake legs (250 + 333)");

    // Member bookkeeping — defaulted flips, escrow drains to 0,
    // stake shrinks by the D/C-capped amount.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (await (env.programs.core.account as any).member.fetch(memberPk)) as {
      defaulted: boolean;
      stakeDeposited: BN;
      escrowBalance: BN;
      stakeDepositedInitial: BN;
      totalEscrowDeposited: BN;
      contributionsPaid: number;
    };
    expect(m.defaulted).to.equal(true);
    expect(m.escrowBalance.toString()).to.equal("0");
    expect(m.stakeDeposited.toString()).to.equal("1167000000"); // 1500 − 333
    // Initials must be untouched — they anchor the D/C invariant.
    expect(m.stakeDepositedInitial.toString()).to.equal(STAKE_INITIAL.toString());
    expect(m.totalEscrowDeposited.toString()).to.equal(ESCROW_DEPOSITED.toString());

    // Pool bookkeeping — defaulted_members increments, balances decrement.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await (env.programs.core.account as any).pool.fetch(poolPk)) as {
      defaultedMembers: number;
      solidarityBalance: BN;
      escrowBalance: BN;
    };
    expect(p.defaultedMembers).to.equal(1);
    expect(p.solidarityBalance.toString()).to.equal("0");
    expect(p.escrowBalance.toString())
      .to.equal((ESCROW_VAULT_BAL - 583_000_000n).toString());

    // D/C invariant on the post-seizure member state — recomputed
    // from raw member fields, identical formula to math/dc.rs:9.
    const D_init = CREDIT;
    const D_rem  = (BigInt(CYCLES_TOTAL) - BigInt(m.contributionsPaid)) * INSTALLMENT;
    const C_init = BigInt(m.stakeDepositedInitial.toString()) +
                   BigInt(m.totalEscrowDeposited.toString());
    const C_rem  = BigInt(m.stakeDeposited.toString()) +
                   BigInt(m.escrowBalance.toString());
    expect(D_rem * C_init <= C_rem * D_init, "D/C invariant must hold post-seizure")
      .to.equal(true);
  });

  it("C. second settle_default on defaulted member → DefaultedMember", async function () {
    // Clock is still past grace from test (B). The only reason to
    // reject here is `constraint = !member.defaulted` — verifies
    // the default state transition is one-directional.
    let threw = false;
    try {
      await (env.programs.core.methods as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .settleDefault({ cycle: DEFAULT_CYCLE_ARG } as any)
        .accounts(settleAccounts())
        .rpc();
    } catch (e) {
      threw = true;
      const err = e as { logs?: string[]; message?: string };
      const haystack = [
        ...(err.logs ?? []),
        err.message ?? "",
        String(e),
      ].join("\n");
      expect(haystack).to.match(
        /DefaultedMember/,
        `expected DefaultedMember, got:\n${haystack}`,
      );
    }
    expect(threw, "second settle_default must reject").to.equal(true);
  });
});

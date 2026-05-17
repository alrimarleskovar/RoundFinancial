/**
 * Edge — grace-period default · **shield-1-only quadrant**.
 *
 * The companion to `edge_grace_default.spec.ts`. The original spec
 * exercises the "all three shields fire" quadrant of the Triple Shield
 * D/C × Saldo matrix: solidarity drains, escrow seizes part of its
 * balance, stake covers the remainder (633 USDC total). This spec
 * locks the **shield-1-only** quadrant — the same flow that fired on
 * Pool 3 / devnet (`settle_default` tx
 * `34UyAtEPH5iWXrzhMGLRJVYzt2Z314f4S9DbwmfXA8bfS3SKahgEYkTgFz6KGuX441ktPVVnEvLk19fuVAkNeJeG`)
 * where `seized_total = $0.20`, all from solidarity, escrow + stake
 * intact.
 *
 * The quadrant is reachable when the D/C invariant is **already at
 * equality** at seizure time:
 *
 *   D_rem == D_init     ← member never paid an installment
 *   C_rem == C_init     ← collateral untouched (no prior seizure)
 *
 * In that case, `max_seizure_respecting_dc(D_rem, C_rem, D_init)` returns
 *   C_rem − ceil(D_rem × C_init / D_init)
 *     = C_rem − ceil(D_init × C_init / D_init)
 *     = C_rem − C_init
 *     = 0
 *
 * → shield 2 (escrow) and shield 3 (stake) are both capped at zero,
 * leaving solidarity as the only source of seized USDC. The seizure
 * still satisfies the invariant trivially and `member.defaulted` flips.
 *
 * Pool 3's run captures this quadrant as the **first time on real funds**.
 * This spec proves the bankrun parity: same params, same seizure split,
 * same member end-state.
 */

import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { AccountLayout, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

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

// ─── Scenario parameters — mirrors Pool 3 devnet shape ──────────────
//
// The on-chain run used credit=$30 / installment=$10 / cycles=3 /
// stake=$15 / escrow_deposited=$15 (initial join). We scale 100×
// here so the math reads in whole-thousands instead of cents.
//
// The key invariant is `STAKE_INITIAL + ESCROW_DEPOSITED == CREDIT` so
// that C_init == D_init. Then by contributing zero (CONTRIBUTIONS_PAID=0)
// the defaulter sits at D_rem == D_init too, and the D/C invariant is
// at equality at settle_default time → shields 2+3 capped at zero.

const GRACE_PERIOD_SECS = 604_800n;

const MEMBERS_TARGET = 3;
const CYCLES_TOTAL = 3;
const CYCLE_DURATION_SEC = 86_400n;
const INSTALLMENT = 1_000_000_000n; // 1_000 USDC
const CREDIT = 3_000_000_000n; // 3_000 USDC (= 3 × installment)
const STAKE_INITIAL = 1_500_000_000n; // 50% of credit (Level-1)
const ESCROW_DEPOSITED = 1_500_000_000n; // matches stake → C_init = 3_000 = D_init
const SOLIDARITY_BALANCE = 50_000_000n; // 50 USDC pre-seeded
const ESCROW_VAULT_BAL = ESCROW_DEPOSITED; // single member, full vault is theirs
const POOL_VAULT_INITIAL = 0n;

// Same future timestamp anchor as the companion spec.
const NEXT_CYCLE_AT = 1_800_000_000n;

const POOL_SEED_ID = 998n;

// Defaulter has paid zero installments; pool has advanced one cycle.
// Caller passes args.cycle = pool.current_cycle = 1.
const CONTRIBUTIONS_PAID = 0;
const CURRENT_CYCLE = 1;
const DEFAULT_CYCLE_ARG = 1;

async function readTokenBalance(env: BankrunEnv, ata: PublicKey): Promise<bigint> {
  const info = await env.context.banksClient.getAccount(ata);
  if (!info) {
    throw new Error(`token account not found: ${ata.toBase58()}`);
  }
  const raw = AccountLayout.decode(Buffer.from(info.data));
  return raw.amount;
}

describe("edge — grace-period default · shield-1-only quadrant (Pool 3 devnet parity)", function () {
  this.timeout(60_000);

  let env: BankrunEnv;

  const poolAuthority = Keypair.generate();
  const defaulterWallet = Keypair.generate();
  const nftAsset = Keypair.generate();
  const treasury = Keypair.generate();
  const metaplexCore = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

  const usdcMint = Keypair.generate().publicKey;

  let configPk: PublicKey;
  let configBump: number;
  let poolPk: PublicKey;
  let poolBump: number;
  let memberPk: PublicKey;
  let memberBump: number;
  let escrowVaultAuth: PublicKey;
  let escrowBump: number;
  let solidarityVaultAuth: PublicKey;
  let solidarityBump: number;
  let yieldVaultAuth: PublicKey;
  let yieldBump: number;
  let poolUsdcVault: PublicKey;
  let escrowVault: PublicKey;
  let solidarityVault: PublicKey;

  before(async function () {
    env = await setupBankrunEnv();

    [configPk, configBump] = protocolConfigPda(env.ids.core);
    [poolPk, poolBump] = poolPda(env.ids.core, poolAuthority.publicKey, POOL_SEED_ID);
    [memberPk, memberBump] = memberPda(env.ids.core, poolPk, defaulterWallet.publicKey);
    [escrowVaultAuth, escrowBump] = escrowVaultAuthorityPda(env.ids.core, poolPk);
    [solidarityVaultAuth, solidarityBump] = solidarityVaultAuthorityPda(env.ids.core, poolPk);
    [yieldVaultAuth, yieldBump] = yieldVaultAuthorityPda(env.ids.core, poolPk);

    poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, poolPk, true);
    escrowVault = getAssociatedTokenAddressSync(usdcMint, escrowVaultAuth, true);
    solidarityVault = getAssociatedTokenAddressSync(usdcMint, solidarityVaultAuth, true);

    writeMintAccount(env.context, usdcMint, {
      mintAuthority: env.payer.publicKey,
      decimals: 6,
    });

    writeTokenAccount(env.context, poolUsdcVault, {
      mint: usdcMint,
      owner: poolPk,
      amount: POOL_VAULT_INITIAL,
    });
    writeTokenAccount(env.context, escrowVault, {
      mint: usdcMint,
      owner: escrowVaultAuth,
      amount: ESCROW_VAULT_BAL,
    });
    writeTokenAccount(env.context, solidarityVault, {
      mint: usdcMint,
      owner: solidarityVaultAuth,
      amount: SOLIDARITY_BALANCE,
    });

    await writeAnchorAccount(env.context, env.programs.core, "protocolConfig", configPk, {
      authority: env.payer.publicKey,
      treasury: treasury.publicKey,
      usdcMint,
      metaplexCore,
      defaultYieldAdapter: env.ids.yieldMock,
      reputationProgram: PublicKey.default,
      feeBpsYield: 2_000,
      feeBpsCycleL1: 200,
      feeBpsCycleL2: 100,
      feeBpsCycleL3: 0,
      guaranteeFundBps: 15_000,
      paused: false,
      bump: configBump,
    });

    await writeAnchorAccount(env.context, env.programs.core, "pool", poolPk, {
      authority: poolAuthority.publicKey,
      seedId: new BN(POOL_SEED_ID.toString()),
      usdcMint,
      yieldAdapter: env.ids.yieldMock,
      membersTarget: MEMBERS_TARGET,
      installmentAmount: new BN(INSTALLMENT.toString()),
      creditAmount: new BN(CREDIT.toString()),
      cyclesTotal: CYCLES_TOTAL,
      cycleDuration: new BN(CYCLE_DURATION_SEC.toString()),
      seedDrawBps: 9_160,
      solidarityBps: 100,
      escrowReleaseBps: 2_500,
      membersJoined: MEMBERS_TARGET,
      status: 1, // Active
      startedAt: new BN(
        (NEXT_CYCLE_AT - CYCLE_DURATION_SEC * BigInt(CURRENT_CYCLE + 1)).toString(),
      ),
      currentCycle: CURRENT_CYCLE,
      nextCycleAt: new BN(NEXT_CYCLE_AT.toString()),
      totalContributed: new BN(0),
      totalPaidOut: new BN(0),
      solidarityBalance: new BN(SOLIDARITY_BALANCE.toString()),
      escrowBalance: new BN(ESCROW_VAULT_BAL.toString()),
      yieldAccrued: new BN(0),
      guaranteeFundBalance: new BN(0),
      totalProtocolFeeAccrued: new BN(0),
      yieldPrincipalDeposited: new BN(0),
      defaultedMembers: 0,
      slotsBitmap: Buffer.from([0x07, 0, 0, 0, 0, 0, 0, 0]),
      bump: poolBump,
      escrowVaultBump: escrowBump,
      solidarityVaultBump: solidarityBump,
      yieldVaultBump: yieldBump,
    });

    await writeAnchorAccount(env.context, env.programs.core, "member", memberPk, {
      pool: poolPk,
      wallet: defaulterWallet.publicKey,
      nftAsset: nftAsset.publicKey,
      slotIndex: 2,
      reputationLevel: 1,
      stakeBps: 5_000,
      stakeDeposited: new BN(STAKE_INITIAL.toString()),
      contributionsPaid: CONTRIBUTIONS_PAID,
      totalContributed: new BN(0),
      totalReceived: new BN(0),
      escrowBalance: new BN(ESCROW_DEPOSITED.toString()),
      onTimeCount: 0,
      lateCount: 0,
      defaulted: false,
      paidOut: false,
      lastReleasedCheckpoint: 0,
      joinedAt: new BN((NEXT_CYCLE_AT - 120n).toString()),
      stakeDepositedInitial: new BN(STAKE_INITIAL.toString()),
      totalEscrowDeposited: new BN(ESCROW_DEPOSITED.toString()),
      lastTransferredAt: new BN(0),
      bump: memberBump,
    });
  });

  function settleAccounts() {
    return {
      caller: env.payer.publicKey,
      config: configPk,
      pool: poolPk,
      member: memberPk,
      defaultedMemberWallet: defaulterWallet.publicKey,
      usdcMint,
      poolUsdcVault,
      solidarityVaultAuthority: solidarityVaultAuth,
      solidarityVault,
      escrowVaultAuthority: escrowVaultAuth,
      escrowVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      reputationProgram: env.ids.reputation,
      reputationConfig: env.ids.reputation,
      reputationProfile: env.ids.reputation,
      identityRecord: env.ids.reputation,
      attestation: env.ids.reputation,
      systemProgram: SystemProgram.programId,
    };
  }

  it("post-grace · shield-1-only · solidarity drains, escrow + stake intact", async function () {
    await setBankrunUnixTs(env.context, NEXT_CYCLE_AT + GRACE_PERIOD_SECS + 10n);

    const poolVaultBefore = await readTokenBalance(env, poolUsdcVault);
    const solidarityVaultBefore = await readTokenBalance(env, solidarityVault);
    const escrowVaultBefore = await readTokenBalance(env, escrowVault);

    await (env.programs.core.methods as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .settleDefault({ cycle: DEFAULT_CYCLE_ARG } as any)
      .accounts(settleAccounts())
      .rpc();

    // ─── Seizure walkthrough (settle_default.rs:182-272) ──────────────
    // D_init = credit = 3_000
    // D_rem  = (3 − 0) × 1_000 = 3_000   ← member never paid
    // C_init = stake_initial + total_escrow_deposited = 1_500 + 1_500 = 3_000
    // C_rem  = stake + escrow_balance     = 1_500 + 1_500 = 3_000
    // missed = min(installment=1_000, d_rem=3_000) = 1_000
    //
    // 1) from_solidarity = min(missed=1_000, avail=50) = 50
    // 2) shortfall = 950. max_seizure_dc(D=3000, C=3000, 3000)
    //    = C_before − ceil(D_rem × C_init / D_init)
    //    = 3_000 − ceil(3_000 × 3_000 / 3_000) = 3_000 − 3_000 = 0
    //    cap_escrow = min(escrow_balance=1_500, vault=1_500) = 1_500
    //    → from_escrow = min(950, 1_500, 0) = 0
    // 3) shortfall = 950. c_after_escrow = 3_000 (escrow untouched).
    //    max_seizure = 3_000 − 3_000 = 0
    //    cap_stake = min(stake=1_500, vault_remaining=1_500) = 1_500
    //    → from_stake = min(950, 1_500, 0) = 0
    //
    // Total seized = 50 + 0 + 0 = 50.
    const EXPECTED_SEIZED = 50_000_000n;
    const EXPECTED_SOLIDARITY_DRAINED = 50_000_000n;

    const poolVaultAfter = await readTokenBalance(env, poolUsdcVault);
    const solidarityVaultAfter = await readTokenBalance(env, solidarityVault);
    const escrowVaultAfter = await readTokenBalance(env, escrowVault);

    expect(poolVaultAfter - poolVaultBefore).to.equal(
      EXPECTED_SEIZED,
      "pool vault must receive only the solidarity drain",
    );
    expect(solidarityVaultBefore - solidarityVaultAfter).to.equal(
      EXPECTED_SOLIDARITY_DRAINED,
      "solidarity vault drained by full balance",
    );
    expect(escrowVaultAfter).to.equal(
      escrowVaultBefore,
      "escrow vault must be untouched (D/C cap = 0)",
    );

    // Member bookkeeping — defaulted flips, escrow + stake unchanged.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (await (env.programs.core.account as any).member.fetch(memberPk)) as {
      defaulted: boolean;
      stakeDeposited: BN;
      escrowBalance: BN;
      stakeDepositedInitial: BN;
      totalEscrowDeposited: BN;
      contributionsPaid: number;
    };
    expect(m.defaulted).to.equal(true, "defaulted flag must flip");
    expect(m.escrowBalance.toString()).to.equal(
      ESCROW_DEPOSITED.toString(),
      "escrow_balance must be unchanged (shield 2 capped at 0)",
    );
    expect(m.stakeDeposited.toString()).to.equal(
      STAKE_INITIAL.toString(),
      "stake_deposited must be unchanged (shield 3 capped at 0)",
    );
    // Initials anchor the D/C invariant — never mutated.
    expect(m.stakeDepositedInitial.toString()).to.equal(STAKE_INITIAL.toString());
    expect(m.totalEscrowDeposited.toString()).to.equal(ESCROW_DEPOSITED.toString());

    // Pool bookkeeping — defaulted_members increments, only solidarity
    // balance drops (escrow_balance unchanged).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await (env.programs.core.account as any).pool.fetch(poolPk)) as {
      defaultedMembers: number;
      solidarityBalance: BN;
      escrowBalance: BN;
    };
    expect(p.defaultedMembers).to.equal(1);
    expect(p.solidarityBalance.toString()).to.equal("0", "pool solidarity_balance drained");
    expect(p.escrowBalance.toString()).to.equal(
      ESCROW_VAULT_BAL.toString(),
      "pool escrow_balance must be unchanged",
    );

    // D/C invariant on the post-seizure member state — same identity
    // formula as math/dc.rs:9. With shield-1-only seizure the invariant
    // remains at equality (the seizure didn't touch collateral, and
    // defaulted=true means future installments aren't expected from
    // this member, so the protocol's accounting of "what's still owed
    // vs what's still posted" is unchanged from the member's side).
    const D_init = CREDIT;
    const D_rem = (BigInt(CYCLES_TOTAL) - BigInt(m.contributionsPaid)) * INSTALLMENT;
    const C_init =
      BigInt(m.stakeDepositedInitial.toString()) + BigInt(m.totalEscrowDeposited.toString());
    const C_rem = BigInt(m.stakeDeposited.toString()) + BigInt(m.escrowBalance.toString());
    expect(D_rem * C_init <= C_rem * D_init, "D/C invariant must hold post-seizure").to.equal(true);
    expect(D_rem * C_init === C_rem * D_init, "shield-1-only quadrant: D/C at equality").to.equal(
      true,
    );
  });
});

/**
 * edge — settle_default grace boundary + payable-XOR-settleable (LEAD-001, Phase B).
 *
 * LEAD-001 (Caio audit) confirmed the v1 Triple Shield order is
 * Cofre Solidário → member Escrow → Stake (the Guarantee Fund is a systemic
 * reserve, never an individual-default absorber). The existing
 * `edge_grace_default.spec.ts` covers the seizure order + amounts, but two
 * properties the triage flagged were unpinned:
 *
 *   1. The grace gate is `clock >= next_cycle_at + GRACE` — but the existing
 *      tests probe it far from the boundary (`next_cycle_at - 1` and
 *      `+GRACE+10`), so the exact `>=` threshold is unasserted. Here we pin
 *      `deadline - 1` (reject) and `deadline` exactly (accept).
 *   2. "Payable XOR settleable": a member is either PAYABLE
 *      (`contributions_paid == current_cycle`, `contribute`'s precondition) or
 *      SETTLEABLE (`contributions_paid < current_cycle`, `settle_default`'s
 *      precondition) — never both, and there is no catch-up path. So a late
 *      payment can never race settlement for the same cycle. This invariant is
 *      emergent from two `require!`s in two files (`contribute.rs:135`,
 *      `settle_default.rs:164`) with no single test pinning it. Case C pins the
 *      settle side: a paid-up (current) member is rejected with `MemberNotBehind`
 *      — and, because that check runs BEFORE the grace gate, it is rejected even
 *      when the grace window HAS elapsed.
 *
 * Seeding mirrors `edge_grace_default.spec.ts` (settle_default needs the three
 * pool vaults + the D/C-invariant anchors). `reputation_program = default`
 * makes settle_default skip its reputation CPI.
 */

import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

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

const GRACE_PERIOD_SECS = 604_800n;

const MEMBERS_TARGET = 3;
const CYCLES_TOTAL = 3;
const CYCLE_DURATION_SEC = 86_400n;
const INSTALLMENT = 1_000_000_000n; // 1_000 USDC
const CREDIT = 3_000_000_000n; // 3_000 USDC
const STAKE_INITIAL = 1_500_000_000n; // 50% of credit (Level-1)
const ESCROW_DEPOSITED = 250_000_000n; // one installment × 25%

const SOLIDARITY_BALANCE = 50_000_000n;
const ESCROW_VAULT_BAL = STAKE_INITIAL + ESCROW_DEPOSITED; // 1_750 USDC

const NEXT_CYCLE_AT = 1_800_000_000n;
const DEADLINE = NEXT_CYCLE_AT + GRACE_PERIOD_SECS; // the exact `>=` threshold

const POOL_SEED_ID = 5151n;

// Defaulter is behind: paid cycle 0 only, pool advanced to cycle 2.
const CONTRIBUTIONS_PAID_BEHIND = 1;
const CURRENT_CYCLE = 2;
const DEFAULT_CYCLE_ARG = 2;

describe("edge — settle_default grace boundary + payable-XOR-settleable (LEAD-001, bankrun)", function () {
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

  async function seedMember(contributionsPaid: number, defaulted: boolean) {
    await writeAnchorAccount(env.context, env.programs.core, "member", memberPk, {
      pool: poolPk,
      wallet: defaulterWallet.publicKey,
      nftAsset: nftAsset.publicKey,
      slotIndex: 2,
      reputationLevel: 1,
      stakeBps: 5_000,
      stakeDeposited: new BN(STAKE_INITIAL.toString()),
      contributionsPaid,
      totalContributed: new BN((INSTALLMENT * BigInt(contributionsPaid)).toString()),
      totalReceived: new BN(0),
      escrowBalance: new BN(ESCROW_DEPOSITED.toString()),
      onTimeCount: contributionsPaid,
      lateCount: 0,
      defaulted,
      paidOut: false,
      lastReleasedCheckpoint: 0,
      joinedAt: new BN((NEXT_CYCLE_AT - 120n).toString()),
      stakeDepositedInitial: new BN(STAKE_INITIAL.toString()),
      totalEscrowDeposited: new BN(ESCROW_DEPOSITED.toString()),
      lastTransferredAt: new BN(0),
      bump: memberBump,
    });
  }

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

    writeMintAccount(env.context, usdcMint, { mintAuthority: env.payer.publicKey, decimals: 6 });

    writeTokenAccount(env.context, poolUsdcVault, { mint: usdcMint, owner: poolPk, amount: 0n });
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
      lpDistributionBalance: new BN(0),
      slotsBitmap: Buffer.from([0x07, 0, 0, 0, 0, 0, 0, 0]),
      bump: poolBump,
      escrowVaultBump: escrowBump,
      solidarityVaultBump: solidarityBump,
      yieldVaultBump: yieldBump,
    });

    await seedMember(CONTRIBUTIONS_PAID_BEHIND, false); // behind, not yet defaulted
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

  const settle = () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env.programs.core.methods as any)
      .settleDefault({ cycle: DEFAULT_CYCLE_ARG })
      .accounts(settleAccounts());

  it("A. exactly one second BEFORE the deadline: rejects GracePeriodNotElapsed", async function () {
    await setBankrunUnixTs(env.context, DEADLINE - 1n);
    let threw = false;
    try {
      await settle().rpc();
    } catch (e) {
      threw = true;
      const err = e as { logs?: string[]; message?: string };
      const haystack = [...(err.logs ?? []), err.message ?? "", String(e)].join("\n");
      expect(haystack).to.match(
        /GracePeriodNotElapsed/,
        `expected GracePeriodNotElapsed at deadline-1, got:\n${haystack}`,
      );
    }
    expect(threw, "settle at deadline-1 must reject").to.equal(true);
  });

  it("B. exactly AT the deadline (clock == next_cycle_at + GRACE): accepts", async function () {
    await setBankrunUnixTs(env.context, DEADLINE);
    await settle().rpc();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (await (env.programs.core.account as any).member.fetch(memberPk)) as {
      defaulted: boolean;
    };
    expect(m.defaulted, "settle at exactly the deadline must succeed (the >= boundary)").to.equal(
      true,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await (env.programs.core.account as any).pool.fetch(poolPk)) as {
      defaultedMembers: number;
    };
    expect(p.defaultedMembers, "defaulted_members incremented").to.equal(1);
  });

  it("C. a paid-up (current) member is NOT settleable — MemberNotBehind, even past grace", async function () {
    // Re-seed the member as CURRENT: contributions_paid == current_cycle. This
    // is the PAYABLE state (contribute's precondition), which is mutually
    // exclusive with settle's `contributions_paid < current_cycle`. Clock is
    // still past the deadline, so grace is NOT the reason — MemberNotBehind is
    // checked first (settle_default.rs:164, before the grace gate at :172).
    await seedMember(CURRENT_CYCLE, false); // contributions_paid = 2 = current_cycle
    await setBankrunUnixTs(env.context, DEADLINE + 100n);

    let threw = false;
    try {
      await settle().rpc();
    } catch (e) {
      threw = true;
      const err = e as { logs?: string[]; message?: string };
      const haystack = [...(err.logs ?? []), err.message ?? "", String(e)].join("\n");
      expect(haystack).to.match(
        /MemberNotBehind/,
        `expected MemberNotBehind for a paid-up member, got:\n${haystack}`,
      );
    }
    expect(threw, "settling a current (payable) member must reject").to.equal(true);
  });
});

/**
 * edge — permissionless `skip_defaulted_payout` liveness regression (SEV-049).
 *
 * A member who defaults BEFORE their own contemplation slot is settled
 * (`defaulted = true`) by `settle_default`. When their slot then arrives, NO ONE
 * can claim it: `claim_payout` needs `!member.defaulted`, `crank_payout` needs
 * `!member.defaulted`, and `settle_default` needs `contributions_paid <
 * current_cycle` — unsatisfiable at their own slot. Without a fix the pool locks
 * forever and never reaches `Completed` / `close_pool`. `skip_defaulted_payout`
 * is the permissionless crank that advances such a cycle WITHOUT disbursing (the
 * forfeited pot stays in the pool float).
 *
 * This is the dedicated, NON-artifact-gated regression the litesvm parity lane
 * only covered indirectly (it `this.skip()`s without mpl_core.so, and asserts
 * economic parity, not the cycle advance). Here we seed the exact stuck state
 * and assert the liveness property directly: the cycle ADVANCES.
 *
 * Cases:
 *   A. defaulted contemplated slot, mid-pool → current_cycle advances by 1,
 *      no tokens move, pool stays Active.
 *   B. defaulted contemplated slot, FINAL slot → pool flips Completed.
 *   C. NON-defaulted member → SlotNotDefaulted (a live member must claim).
 */

import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";

import { memberPda, poolPda, protocolConfigPda } from "@roundfi/sdk";

import {
  setupBankrunEnv,
  writeAnchorAccount,
  writeMintAccount,
  type BankrunEnv,
} from "./_harness/bankrun.js";

const MEMBERS_TARGET = 3;
const CYCLES_TOTAL = 3;
const CYCLE_DURATION_SEC = 86_400n;
const INSTALLMENT = 1_000_000_000n; // 1_000 USDC
const CREDIT = 3_000_000_000n; // 3_000 USDC
const NEXT_CYCLE_AT = 1_800_000_000n; // ~2027
const POOL_SEED_ID = 4949n;

describe("edge — skip_defaulted_payout liveness (SEV-049, bankrun)", function () {
  this.timeout(60_000);

  let env: BankrunEnv;

  const poolAuthority = Keypair.generate();
  const memberWallet = Keypair.generate();
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

  async function seedPool(currentCycle: number, status: number) {
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
      status, // 1 = Active
      startedAt: new BN((NEXT_CYCLE_AT - CYCLE_DURATION_SEC * 2n).toString()),
      currentCycle,
      nextCycleAt: new BN(NEXT_CYCLE_AT.toString()),
      totalContributed: new BN(0),
      totalPaidOut: new BN(0),
      solidarityBalance: new BN(0),
      escrowBalance: new BN(0),
      yieldAccrued: new BN(0),
      guaranteeFundBalance: new BN(0),
      totalProtocolFeeAccrued: new BN(0),
      yieldPrincipalDeposited: new BN(0),
      defaultedMembers: 1,
      lpDistributionBalance: new BN(0),
      slotsBitmap: Buffer.from([0x07, 0, 0, 0, 0, 0, 0, 0]),
      bump: poolBump,
      escrowVaultBump: 255,
      solidarityVaultBump: 255,
      yieldVaultBump: 255,
    });
  }

  async function seedMember(slotIndex: number, defaulted: boolean) {
    await writeAnchorAccount(env.context, env.programs.core, "member", memberPk, {
      pool: poolPk,
      wallet: memberWallet.publicKey,
      nftAsset: nftAsset.publicKey,
      slotIndex,
      reputationLevel: 1,
      stakeBps: 5_000,
      stakeDeposited: new BN(0), // stake was seized on default
      contributionsPaid: slotIndex, // behind — was defaulted before their slot
      totalContributed: new BN((INSTALLMENT * BigInt(slotIndex)).toString()),
      totalReceived: new BN(0),
      escrowBalance: new BN(0),
      onTimeCount: slotIndex,
      lateCount: 0,
      defaulted,
      paidOut: false,
      lastReleasedCheckpoint: 0,
      joinedAt: new BN((NEXT_CYCLE_AT - 240n).toString()),
      stakeDepositedInitial: new BN(1_500_000_000),
      totalEscrowDeposited: new BN(0),
      lastTransferredAt: new BN(0),
      bump: memberBump,
    });
  }

  before(async function () {
    env = await setupBankrunEnv();

    [configPk, configBump] = protocolConfigPda(env.ids.core);
    [poolPk, poolBump] = poolPda(env.ids.core, poolAuthority.publicKey, POOL_SEED_ID);
    [memberPk, memberBump] = memberPda(env.ids.core, poolPk, memberWallet.publicKey);

    writeMintAccount(env.context, usdcMint, { mintAuthority: env.payer.publicKey, decimals: 6 });

    // reputation_program = default → the crank family skips its reputation CPI.
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
  });

  function skipAccounts() {
    return {
      caller: env.payer.publicKey, // permissionless — NOT the defaulted member
      config: configPk,
      pool: poolPk,
      member: memberPk,
      defaultedMemberWallet: memberWallet.publicKey,
    };
  }

  const skip = (cycle: number) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env.programs.core.methods as any).skipDefaultedPayout({ cycle }).accounts(skipAccounts());

  it("A. mid-pool defaulted slot: advances current_cycle by 1, moves no funds", async function () {
    await seedPool(1, 1); // Active, contemplation cycle 1
    await seedMember(1, true); // slot 1, defaulted

    await skip(1).rpc();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await (env.programs.core.account as any).pool.fetch(poolPk)) as {
      currentCycle: number;
      status: number;
      totalPaidOut: BN;
    };
    expect(p.currentCycle, "cycle advanced 1 → 2").to.equal(2);
    expect(p.status, "pool stays Active (not final slot)").to.equal(1);
    expect(BigInt(p.totalPaidOut.toString()), "no payout — pot forfeited to float").to.equal(0n);
  });

  it("B. final defaulted slot: flips pool to Completed", async function () {
    await seedPool(CYCLES_TOTAL - 1, 1); // Active, contemplation cycle = last slot (2)
    await seedMember(CYCLES_TOTAL - 1, true); // slot 2, defaulted

    await skip(CYCLES_TOTAL - 1).rpc();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await (env.programs.core.account as any).pool.fetch(poolPk)) as {
      status: number;
      totalPaidOut: BN;
    };
    expect(p.status, "final defaulted slot → pool Completed (2)").to.equal(2);
    expect(BigInt(p.totalPaidOut.toString()), "still no payout").to.equal(0n);
  });

  it("C. non-defaulted member: rejects with SlotNotDefaulted", async function () {
    await seedPool(1, 1);
    await seedMember(1, false); // NOT defaulted — a live member must claim

    let threw = false;
    try {
      await skip(1).rpc();
    } catch (e) {
      threw = true;
      const err = e as { logs?: string[]; message?: string };
      const haystack = [...(err.logs ?? []), err.message ?? "", String(e)].join("\n");
      expect(haystack).to.match(/SlotNotDefaulted/, `expected SlotNotDefaulted, got:\n${haystack}`);
    }
    expect(threw, "skipping a live (non-defaulted) slot must reject").to.equal(true);
  });
});

/**
 * edge — permissionless `crank_payout` liveness fix (SEV-051, bankrun setClock).
 *
 * A LIVE (non-defaulted) contemplated member who never claims would lock the
 * pool forever: `claim_payout` needs their signature, `skip_defaulted_payout`
 * needs `member.defaulted`, and `settle_default` needs
 * `contributions_paid < current_cycle` — unsatisfiable at their own slot. The
 * new permissionless `crank_payout` delivers the credit to the member's OWN ATA
 * and advances the cycle, gated behind the same `next_cycle_at + GRACE` window
 * `settle_default` uses (the member gets first dibs to self-claim).
 *
 * We seed an Active pool at a NON-zero cycle so the cycle-0 seed-draw branch is
 * out of scope; the point here is the grace gate + delivery + cycle advance.
 * Cases:
 *   A. Pre-grace  → PayoutGraceActive (only the member's own claim may run).
 *   B. Post-grace → credit lands in the member ATA, cycle advances, paid_out set.
 *   C. Defaulted member → DefaultedMember (that slot is for skip_defaulted_payout).
 */

import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { AccountLayout, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { memberPda, poolPda, protocolConfigPda } from "@roundfi/sdk";

import {
  setBankrunUnixTs,
  setupBankrunEnv,
  writeAnchorAccount,
  writeMintAccount,
  writeTokenAccount,
  type BankrunEnv,
} from "./_harness/bankrun.js";

const GRACE_PERIOD_SECS = 604_800n; // vanilla build (no devnet-canary feature)

const MEMBERS_TARGET = 3;
const CYCLES_TOTAL = 3;
const CYCLE_DURATION_SEC = 86_400n;
const INSTALLMENT = 1_000_000_000n; // 1_000 USDC
const CREDIT = 3_000_000_000n; // 3_000 USDC
const POOL_VAULT_BAL = 3_500_000_000n; // > credit, earmark 0 → spendable covers it
const NEXT_CYCLE_AT = 1_800_000_000n; // ~2027, safely future
const POOL_SEED_ID = 4242n;

// Contemplated member is slot 1 at current_cycle=1 (non-zero → no seed-draw),
// fully paid up and NOT defaulted — the exact state that can't be settled and
// would otherwise lock the pool if they never claim.
const CURRENT_CYCLE = 1;
const CYCLE_ARG = 1;

async function readTokenBalance(env: BankrunEnv, ata: PublicKey): Promise<bigint> {
  const info = await env.context.banksClient.getAccount(ata);
  if (!info) throw new Error(`token account not found: ${ata.toBase58()}`);
  return AccountLayout.decode(Buffer.from(info.data)).amount;
}

describe("edge — crank_payout permissionless liveness (bankrun setClock)", function () {
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
  let poolUsdcVault: PublicKey;
  let memberUsdc: PublicKey;

  async function seedMember(defaulted: boolean, paidOut: boolean) {
    await writeAnchorAccount(env.context, env.programs.core, "member", memberPk, {
      pool: poolPk,
      wallet: memberWallet.publicKey,
      nftAsset: nftAsset.publicKey,
      slotIndex: 1,
      reputationLevel: 1,
      stakeBps: 5_000,
      stakeDeposited: new BN(1_500_000_000),
      contributionsPaid: 2, // paid cycles 0 + 1 → NOT behind (unsettleable)
      totalContributed: new BN((INSTALLMENT * 2n).toString()),
      totalReceived: new BN(0),
      escrowBalance: new BN(0),
      onTimeCount: 2,
      lateCount: 0,
      defaulted,
      paidOut,
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
    poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, poolPk, true);
    memberUsdc = getAssociatedTokenAddressSync(usdcMint, memberWallet.publicKey);

    writeMintAccount(env.context, usdcMint, { mintAuthority: env.payer.publicKey, decimals: 6 });
    writeTokenAccount(env.context, poolUsdcVault, {
      mint: usdcMint,
      owner: poolPk,
      amount: POOL_VAULT_BAL,
    });
    // The member's own USDC ATA — the payout destination, starts empty.
    writeTokenAccount(env.context, memberUsdc, {
      mint: usdcMint,
      owner: memberWallet.publicKey,
      amount: 0n,
    });

    // reputation_program = default → crank_payout skips its reputation CPI.
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
      startedAt: new BN((NEXT_CYCLE_AT - CYCLE_DURATION_SEC * 2n).toString()),
      currentCycle: CURRENT_CYCLE,
      nextCycleAt: new BN(NEXT_CYCLE_AT.toString()),
      totalContributed: new BN(0),
      totalPaidOut: new BN(0),
      solidarityBalance: new BN(0),
      escrowBalance: new BN(0),
      yieldAccrued: new BN(0),
      guaranteeFundBalance: new BN(0),
      totalProtocolFeeAccrued: new BN(0),
      yieldPrincipalDeposited: new BN(0),
      defaultedMembers: 0,
      lpDistributionBalance: new BN(0),
      slotsBitmap: Buffer.from([0x07, 0, 0, 0, 0, 0, 0, 0]),
      bump: poolBump,
      escrowVaultBump: 255,
      solidarityVaultBump: 255,
      yieldVaultBump: 255,
    });

    await seedMember(false, false);
  });

  function crankAccounts() {
    return {
      caller: env.payer.publicKey, // permissionless — the bankrun payer, NOT the member
      config: configPk,
      pool: poolPk,
      member: memberPk,
      memberWallet: memberWallet.publicKey,
      usdcMint,
      memberUsdc,
      poolUsdcVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      reputationProgram: env.ids.reputation,
      reputationConfig: env.ids.reputation,
      reputationProfile: env.ids.reputation,
      identityRecord: env.ids.reputation,
      attestation: env.ids.reputation,
      neglectAttestation: env.ids.reputation, // SEV-053; CPI skipped (rep unset)
      systemProgram: SystemProgram.programId,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const crank = () =>
    (env.programs.core.methods as any).crankPayout({ cycle: CYCLE_ARG }).accounts(crankAccounts());

  it("A. pre-grace: rejects with PayoutGraceActive (member can still self-claim)", async function () {
    await setBankrunUnixTs(env.context, NEXT_CYCLE_AT + GRACE_PERIOD_SECS - 1n);
    let threw = false;
    try {
      await crank().rpc();
    } catch (e) {
      threw = true;
      const err = e as { logs?: string[]; message?: string };
      const haystack = [...(err.logs ?? []), err.message ?? "", String(e)].join("\n");
      expect(haystack).to.match(
        /PayoutGraceActive/,
        `expected PayoutGraceActive, got:\n${haystack}`,
      );
    }
    expect(threw, "pre-grace crank must reject").to.equal(true);
  });

  it("C. defaulted member: rejects with DefaultedMember (that's skip_defaulted_payout's job)", async function () {
    await seedMember(true, false); // flip defaulted = true
    await setBankrunUnixTs(env.context, NEXT_CYCLE_AT + GRACE_PERIOD_SECS + 10n);
    let threw = false;
    try {
      await crank().rpc();
    } catch (e) {
      threw = true;
      const err = e as { logs?: string[]; message?: string };
      const haystack = [...(err.logs ?? []), err.message ?? "", String(e)].join("\n");
      expect(haystack).to.match(/DefaultedMember/, `expected DefaultedMember, got:\n${haystack}`);
    }
    expect(threw, "crank on a defaulted slot must reject").to.equal(true);
    await seedMember(false, false); // restore for case B
  });

  it("B. post-grace: delivers credit to the member ATA, advances the cycle, sets paid_out", async function () {
    await setBankrunUnixTs(env.context, NEXT_CYCLE_AT + GRACE_PERIOD_SECS + 10n);

    const memberBefore = await readTokenBalance(env, memberUsdc);
    const vaultBefore = await readTokenBalance(env, poolUsdcVault);

    await crank().rpc();

    const memberAfter = await readTokenBalance(env, memberUsdc);
    const vaultAfter = await readTokenBalance(env, poolUsdcVault);
    expect(memberAfter - memberBefore, "member ATA credited by credit_amount").to.equal(CREDIT);
    expect(vaultBefore - vaultAfter, "pool vault debited by credit_amount").to.equal(CREDIT);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (await (env.programs.core.account as any).member.fetch(memberPk)) as {
      paidOut: boolean;
      totalReceived: BN;
    };
    expect(m.paidOut, "member.paid_out set").to.equal(true);
    expect(BigInt(m.totalReceived.toString()), "total_received += credit").to.equal(CREDIT);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await (env.programs.core.account as any).pool.fetch(poolPk)) as {
      currentCycle: number;
      totalPaidOut: BN;
    };
    expect(p.currentCycle, "cycle advanced 1 → 2").to.equal(CURRENT_CYCLE + 1);
    expect(BigInt(p.totalPaidOut.toString()), "pool.total_paid_out += credit").to.equal(CREDIT);
  });

  it("D. second crank on the now-paid slot: rejects (paid_out guard)", async function () {
    await setBankrunUnixTs(env.context, NEXT_CYCLE_AT + GRACE_PERIOD_SECS + 20n);
    let threw = false;
    try {
      await crank().rpc(); // cycle is now 2, member still slot 1 + paid_out → WrongCycle/NotYourPayoutSlot
    } catch {
      threw = true;
    }
    expect(threw, "re-cranking a paid/advanced slot must reject").to.equal(true);
  });
});

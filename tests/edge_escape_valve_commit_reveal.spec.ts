/**
 * edge — escape-valve commit-reveal + cancel (LEAD-005, Phase E, bankrun).
 *
 * LEAD-005 (Caio audit) found the #232 commit-reveal MEV mitigation and the
 * SEV-015 cancel_pending_listing path had ZERO test coverage — the actual
 * anti-snipe mitigation was unexercised. This pins the whole Pending lifecycle
 * (commit → reveal / cancel), which needs no mpl-core (the NFT transfer only
 * happens in `escape_valve_buy`, out of scope for this lane).
 *
 * commit_hash = SHA-256(price_usdc.to_le_bytes() ‖ salt.to_le_bytes()) — the
 * reveal recomputes it byte-for-byte, so we match that layout in JS.
 *
 * Sequence (single seller/slot; the listing PDA is [b"listing", pool, slot]):
 *   A. commit → listing Pending, price hidden (0).
 *   B. reveal with a wrong (price,salt) → InvalidCommitHash (price can't change).
 *   C. reveal with salt = 0 → SaltMustBeNonZero (SEV-013 entropy floor).
 *   D. cancel the Pending listing → account closed (SEV-015 escape hatch).
 *   E. re-commit → Pending again.
 *   F. reveal with the correct (price,salt) → Active, price written (hash match).
 *   G. reveal again on the now-Active listing → ListingNotPending.
 */

import { expect } from "chai";
import { createHash } from "node:crypto";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import { listingPda, memberPda, poolPda, protocolConfigPda } from "@roundfi/sdk";

import {
  setupBankrunEnv,
  writeAnchorAccount,
  writeMintAccount,
  type BankrunEnv,
} from "./_harness/bankrun.js";

const MEMBERS_TARGET = 3;
const CYCLES_TOTAL = 3;
const CYCLE_DURATION_SEC = 86_400n;
const INSTALLMENT = 1_000_000_000n;
const CREDIT = 3_000_000_000n;
const NEXT_CYCLE_AT = 1_800_000_000n;
const POOL_SEED_ID = 5252n;

const SLOT_INDEX = 1;
const CURRENT_CYCLE = 1;
const PRICE = 5_000_000n; // 5 USDC
const SALT = 0x1234_5678_9abc_def0n;

// commit_hash = SHA-256(price_le(8) || salt_le(8))
function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}
function commitHashOf(price: bigint, salt: bigint): number[] {
  const digest = createHash("sha256")
    .update(Buffer.concat([u64le(price), u64le(salt)]))
    .digest();
  return Array.from(digest);
}

describe("edge — escape-valve commit-reveal + cancel (LEAD-005, bankrun)", function () {
  this.timeout(60_000);

  let env: BankrunEnv;

  const poolAuthority = Keypair.generate();
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
  let listingPk: PublicKey;

  async function seedSellerMember() {
    await writeAnchorAccount(env.context, env.programs.core, "member", memberPk, {
      pool: poolPk,
      wallet: env.payer.publicKey, // seller signs with the bankrun payer
      nftAsset: nftAsset.publicKey,
      slotIndex: SLOT_INDEX,
      reputationLevel: 1,
      stakeBps: 5_000,
      stakeDeposited: new BN(1_500_000_000),
      contributionsPaid: CURRENT_CYCLE, // >= current_cycle → eligible to list
      totalContributed: new BN(INSTALLMENT.toString()),
      totalReceived: new BN(0),
      escrowBalance: new BN(0),
      onTimeCount: 1,
      lateCount: 0,
      defaulted: false,
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
    [memberPk, memberBump] = memberPda(env.ids.core, poolPk, env.payer.publicKey);
    [listingPk] = listingPda(env.ids.core, poolPk, SLOT_INDEX);

    writeMintAccount(env.context, usdcMint, { mintAuthority: env.payer.publicKey, decimals: 6 });

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

    await seedSellerMember();
  });

  const commit = (hash: number[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env.programs.core.methods as any).escapeValveListCommit({ commitHash: hash }).accounts({
      sellerWallet: env.payer.publicKey,
      config: configPk,
      pool: poolPk,
      member: memberPk,
      listing: listingPk,
      systemProgram: SystemProgram.programId,
    });

  const reveal = (price: bigint, salt: bigint) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env.programs.core.methods as any)
      .escapeValveListReveal({ priceUsdc: new BN(price.toString()), salt: new BN(salt.toString()) })
      .accounts({
        sellerWallet: env.payer.publicKey,
        config: configPk,
        pool: poolPk,
        listing: listingPk,
      });

  const cancel = () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env.programs.core.methods as any).cancelPendingListing().accounts({
      sellerWallet: env.payer.publicKey,
      config: configPk,
      pool: poolPk,
      listing: listingPk,
    });

  async function fetchListing() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (env.programs.core.account as any).escapeValveListing.fetch(listingPk)) as {
      status: number;
      slotIndex: number;
      priceUsdc: BN;
    };
  }

  async function expectReject(fn: () => Promise<unknown>, pattern: RegExp) {
    let threw = false;
    try {
      await fn();
    } catch (e) {
      threw = true;
      const err = e as { logs?: string[]; message?: string };
      const haystack = [...(err.logs ?? []), err.message ?? "", String(e)].join("\n");
      expect(haystack).to.match(pattern, `expected ${pattern}, got:\n${haystack}`);
    }
    expect(threw, `expected a reject matching ${pattern}`).to.equal(true);
  }

  it("A. commit → listing Pending, price hidden", async function () {
    await commit(commitHashOf(PRICE, SALT)).rpc();
    const l = await fetchListing();
    expect(l.status, "listing is Pending (3)").to.equal(3);
    expect(l.slotIndex, "slot bound to the seller's slot").to.equal(SLOT_INDEX);
    expect(BigInt(l.priceUsdc.toString()), "price hidden at commit (0)").to.equal(0n);
  });

  it("B. reveal with a wrong (price,salt) → InvalidCommitHash", async function () {
    await expectReject(() => reveal(PRICE, SALT + 1n).rpc(), /InvalidCommitHash/);
  });

  it("C. reveal with salt = 0 → SaltMustBeNonZero", async function () {
    await expectReject(() => reveal(PRICE, 0n).rpc(), /SaltMustBeNonZero/);
  });

  it("D. cancel the Pending listing → account closed (SEV-015)", async function () {
    await cancel().rpc();
    const info = await env.context.banksClient.getAccount(listingPk);
    expect(info, "listing account closed on cancel").to.equal(null);
  });

  it("E. re-commit → Pending again", async function () {
    await commit(commitHashOf(PRICE, SALT)).rpc();
    const l = await fetchListing();
    expect(l.status, "re-committed listing is Pending").to.equal(3);
  });

  it("F. reveal with the correct (price,salt) → Active, price written", async function () {
    await reveal(PRICE, SALT).rpc();
    const l = await fetchListing();
    expect(l.status, "listing → Active (0) after a valid reveal").to.equal(0);
    expect(BigInt(l.priceUsdc.toString()), "revealed price written").to.equal(PRICE);
  });

  it("G. reveal again on the now-Active listing → ListingNotPending", async function () {
    await expectReject(() => reveal(PRICE, SALT).rpc(), /ListingNotPending/);
  });
});

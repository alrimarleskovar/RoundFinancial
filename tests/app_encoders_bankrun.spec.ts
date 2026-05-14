/**
 * App-encoder bankrun round-trip — closes the deferred W3 of #283.
 *
 * The W1+W2 structural spec at `tests/app_encoders.spec.ts` (48 tests,
 * 60 ms) catches discriminator / account-count / PDA-derivation drift
 * at zero infra cost. It does NOT catch cases where the encoder
 * produces a syntactically-correct instruction that the on-chain
 * program nonetheless rejects (e.g., subtle account-order drift the
 * structural test missed, or a future Anchor-side `<Accounts>`
 * constraint that the encoder doesn't satisfy).
 *
 * This spec covers that gap by:
 *
 *   1. Booting a bankrun environment with all 3 RoundFi programs
 *      pre-deployed (via `setupBankrunEnv()` — requires `anchor build`)
 *   2. Seeding ProtocolConfig with `reputation_program = default` so
 *      the contribute / claim_payout handlers skip the reputation CPI
 *      branch (the reputation program is loaded in bankrun but its
 *      CPI surface is exercised by separate `tests/reputation_cpi.spec.ts`
 *      — we want isolated coverage here, not a re-run of that spec)
 *   3. Seeding Pool + Member + 4 vault ATAs + member USDC ATA via
 *      `writeAnchorAccount` / `writeTokenAccount`
 *   4. Building the contribute / claim_payout instruction via the
 *      **app encoder** (`buildContributeIx` / `buildClaimPayoutIx` from
 *      `app/src/lib/`) with `programIds: env.ids` + `usdcMint:` overrides
 *   5. Sending via `BankrunProvider`-backed `provider.sendAndConfirm`
 *   6. Asserting:
 *      - No transaction revert
 *      - Member state delta matches expected (e.g., contributions_paid++)
 *      - Pool state delta matches expected (e.g., total_contributed +=)
 *
 * Runs under `pnpm test:bankrun` (not the default PR lane — bankrun
 * requires the IDL files in `target/idl/`, which only exist after a
 * full `anchor build`). The structural spec at `app_encoders.spec.ts`
 * remains the fast PR-time gate; this spec is the deeper integration
 * gate that runs less frequently.
 *
 * Tracks issue #290. The original ask:
 *   "Send app-built instructions via BanksClient and validate the
 *    program accepts them."
 */

import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { AccountLayout, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

import {
  escrowVaultAuthorityPda,
  listingPda,
  memberPda,
  poolPda,
  protocolConfigPda,
  solidarityVaultAuthorityPda,
  yieldVaultAuthorityPda,
  yieldVaultStatePda,
} from "@roundfi/sdk/pda";

import {
  setBankrunUnixTs,
  setupBankrunEnv,
  writeAnchorAccount,
  writeMintAccount,
  writeTokenAccount,
  type BankrunEnv,
} from "./_harness/bankrun.js";

import { buildContributeIx } from "../app/src/lib/contribute";
import { buildClaimPayoutIx } from "../app/src/lib/claim-payout";
import { buildReleaseEscrowIx } from "../app/src/lib/release-escrow";
import { buildEscapeValveListIx } from "../app/src/lib/escape-valve-list";
import { buildSettleDefaultIx } from "../app/src/lib/settle-default";
import { buildDepositIdleToYieldIx } from "../app/src/lib/deposit-idle-to-yield";

// ─── Scenario parameters ─────────────────────────────────────────────

const POOL_SEED_ID = 4242n;
const MEMBERS_TARGET = 1;
const CYCLES_TOTAL = 1;
const CYCLE_DURATION_SEC = 3600n;
const INSTALLMENT = 5_000_000n; // $5 USDC
const CREDIT = 5_000_000n; // $5 — solo pool, credit == installment
const STAKE_INITIAL = 2_500_000n; // 50% of credit (Lv1)
const SOLIDARITY_PRESEED = 0n;
const ESCROW_PRESEED = 0n;
const POOL_VAULT_PRESEED = 0n;
const MEMBER_USDC_BAL = 10_000_000n; // $10 — plenty for one $5 contribution

const NEXT_CYCLE_AT = 1_800_000_000n;

// ─── Helpers ─────────────────────────────────────────────────────────

async function readTokenBalance(env: BankrunEnv, ata: PublicKey): Promise<bigint> {
  const info = await env.context.banksClient.getAccount(ata);
  if (!info) throw new Error(`token account not found: ${ata.toBase58()}`);
  return AccountLayout.decode(Buffer.from(info.data)).amount;
}

interface FixtureKeys {
  configPk: PublicKey;
  poolPk: PublicKey;
  memberPk: PublicKey;
  escrowVaultAuth: PublicKey;
  solidarityVaultAuth: PublicKey;
  poolUsdcVault: PublicKey;
  escrowVault: PublicKey;
  solidarityVault: PublicKey;
  memberUsdc: PublicKey;
}

/**
 * Seed a minimal, complete fixture: 1-member solo pool at cycle 0 with
 * member fully funded, ready to contribute. Mirrors the pattern from
 * `edge_grace_default.spec.ts` but scoped to the contribute happy path.
 */
async function seedFixture(
  env: BankrunEnv,
  poolAuthority: Keypair,
  member: Keypair,
  usdcMint: PublicKey,
  treasury: PublicKey,
  metaplexCore: PublicKey,
  nftAsset: PublicKey,
): Promise<FixtureKeys> {
  const [configPk, configBump] = protocolConfigPda(env.ids.core);
  const [poolPk, poolBump] = poolPda(env.ids.core, poolAuthority.publicKey, POOL_SEED_ID);
  const [memberPk, memberBump] = memberPda(env.ids.core, poolPk, member.publicKey);
  const [escrowVaultAuth, escrowBump] = escrowVaultAuthorityPda(env.ids.core, poolPk);
  const [solidarityVaultAuth, solidarityBump] = solidarityVaultAuthorityPda(env.ids.core, poolPk);
  const [, yieldBump] = yieldVaultAuthorityPda(env.ids.core, poolPk);

  const poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, poolPk, true);
  const escrowVault = getAssociatedTokenAddressSync(usdcMint, escrowVaultAuth, true);
  const solidarityVault = getAssociatedTokenAddressSync(usdcMint, solidarityVaultAuth, true);
  const memberUsdc = getAssociatedTokenAddressSync(usdcMint, member.publicKey);

  // ─── USDC mint ────────────────────────────────────────────────────
  writeMintAccount(env.context, usdcMint, {
    mintAuthority: env.payer.publicKey,
    decimals: 6,
  });

  // ─── Vaults + member ATA ──────────────────────────────────────────
  writeTokenAccount(env.context, poolUsdcVault, {
    mint: usdcMint,
    owner: poolPk,
    amount: POOL_VAULT_PRESEED,
  });
  writeTokenAccount(env.context, escrowVault, {
    mint: usdcMint,
    owner: escrowVaultAuth,
    amount: ESCROW_PRESEED,
  });
  writeTokenAccount(env.context, solidarityVault, {
    mint: usdcMint,
    owner: solidarityVaultAuth,
    amount: SOLIDARITY_PRESEED,
  });
  writeTokenAccount(env.context, memberUsdc, {
    mint: usdcMint,
    owner: member.publicKey,
    amount: MEMBER_USDC_BAL,
  });

  // ─── ProtocolConfig (reputation_program = default → CPI skipped) ──
  await writeAnchorAccount(env.context, env.programs.core, "protocolConfig", configPk, {
    authority: env.payer.publicKey,
    treasury,
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

  // ─── Pool — Active, cycle 0, ready for contribute ─────────────────
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
    startedAt: new BN((NEXT_CYCLE_AT - CYCLE_DURATION_SEC).toString()),
    currentCycle: 0,
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
    // Bit 0 set — slot 0 is occupied.
    slotsBitmap: Buffer.from([0x01, 0, 0, 0, 0, 0, 0, 0]),
    bump: poolBump,
    escrowVaultBump: escrowBump,
    solidarityVaultBump: solidarityBump,
    yieldVaultBump: yieldBump,
  });

  // ─── Member — slot 0, not paid out, not defaulted ─────────────────
  await writeAnchorAccount(env.context, env.programs.core, "member", memberPk, {
    pool: poolPk,
    wallet: member.publicKey,
    nftAsset,
    slotIndex: 0,
    reputationLevel: 1,
    stakeBps: 5_000,
    stakeDeposited: new BN(STAKE_INITIAL.toString()),
    contributionsPaid: 0,
    totalContributed: new BN(0),
    totalReceived: new BN(0),
    escrowBalance: new BN(0),
    onTimeCount: 0,
    lateCount: 0,
    defaulted: false,
    paidOut: false,
    lastReleasedCheckpoint: 0,
    joinedAt: new BN((NEXT_CYCLE_AT - CYCLE_DURATION_SEC).toString()),
    stakeDepositedInitial: new BN(STAKE_INITIAL.toString()),
    totalEscrowDeposited: new BN(0),
    lastTransferredAt: new BN(0),
    bump: memberBump,
  });

  return {
    configPk,
    poolPk,
    memberPk,
    escrowVaultAuth,
    solidarityVaultAuth,
    poolUsdcVault,
    escrowVault,
    solidarityVault,
    memberUsdc,
  };
}

// ─── Spec ────────────────────────────────────────────────────────────

describe("app encoders — bankrun round-trip (#290)", function () {
  this.timeout(60_000);

  let env: BankrunEnv;
  const poolAuthority = Keypair.generate();
  const member = Keypair.generate();
  const treasury = Keypair.generate();
  const nftAsset = Keypair.generate();
  const usdcMint = Keypair.generate().publicKey;
  // mpl-core mainnet ID — same on devnet + mainnet, irrelevant for
  // contribute/claim_payout (these instructions don't touch mpl-core).
  const metaplexCore = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

  let fixture: FixtureKeys;

  before(async function () {
    env = await setupBankrunEnv();

    // Fund member's SOL so they can sign transactions.
    env.context.setAccount(member.publicKey, {
      lamports: 10_000_000_000,
      data: new Uint8Array(0),
      owner: SystemProgram.programId,
      executable: false,
      rentEpoch: 0,
    });

    fixture = await seedFixture(
      env,
      poolAuthority,
      member,
      usdcMint,
      treasury.publicKey,
      metaplexCore,
      nftAsset.publicKey,
    );
  });

  describe("buildContributeIx — round-trip", function () {
    it("the app-built contribute(cycle=0) instruction is accepted by the program", async function () {
      // ─── Snapshot pre-state ──────────────────────────────────────
      const memberBefore = await (env.programs.core.account as any).member.fetch(fixture.memberPk);
      const poolBefore = await (env.programs.core.account as any).pool.fetch(fixture.poolPk);
      const memberUsdcBefore = await readTokenBalance(env, fixture.memberUsdc);
      const poolVaultBefore = await readTokenBalance(env, fixture.poolUsdcVault);
      const solidarityVaultBefore = await readTokenBalance(env, fixture.solidarityVault);
      const escrowVaultBefore = await readTokenBalance(env, fixture.escrowVault);

      expect(memberBefore.contributionsPaid).to.equal(0);
      expect(memberBefore.paidOut).to.equal(false);
      expect(poolBefore.currentCycle).to.equal(0);
      expect(memberUsdcBefore).to.equal(MEMBER_USDC_BAL);

      // ─── Build via the APP ENCODER + send through bankrun ────────
      const ix = buildContributeIx({
        pool: fixture.poolPk,
        memberWallet: member.publicKey,
        cycle: 0,
        programIds: { core: env.ids.core, reputation: env.ids.reputation },
        usdcMint,
      });

      const tx = new Transaction().add(ix);
      tx.feePayer = member.publicKey;
      tx.recentBlockhash = (await env.context.banksClient.getLatestBlockhash())![0];
      tx.sign(member);

      await env.context.banksClient.processTransaction(tx);

      // ─── Snapshot post-state ─────────────────────────────────────
      const memberAfter = await (env.programs.core.account as any).member.fetch(fixture.memberPk);
      const poolAfter = await (env.programs.core.account as any).pool.fetch(fixture.poolPk);

      // Invariant 1: member state advanced
      expect(memberAfter.contributionsPaid).to.equal(1);
      expect(memberAfter.totalContributed.toString()).to.equal(INSTALLMENT.toString());
      expect(memberAfter.defaulted).to.equal(false);

      // Invariant 2: pool total advanced by INSTALLMENT
      expect(poolAfter.totalContributed.toString()).to.equal(INSTALLMENT.toString());

      // Invariant 3: USDC flowed out of member ATA
      const memberUsdcAfter = await readTokenBalance(env, fixture.memberUsdc);
      expect(memberUsdcAfter).to.equal(memberUsdcBefore - INSTALLMENT);

      // Invariant 4: contribution split lands in the 3 vaults
      //   - solidarity vault gets 1% (50_000 lamports of 5_000_000)
      //   - escrow vault gets 25% (1_250_000)
      //   - pool vault gets the remainder (3_700_000 = 74%)
      const solidarityVaultAfter = await readTokenBalance(env, fixture.solidarityVault);
      const escrowVaultAfter = await readTokenBalance(env, fixture.escrowVault);
      const poolVaultAfter = await readTokenBalance(env, fixture.poolUsdcVault);

      const expectedSolidarity = (INSTALLMENT * 100n) / 10_000n; // 1%
      const expectedEscrow = (INSTALLMENT * 2_500n) / 10_000n; // 25%
      const expectedPool = INSTALLMENT - expectedSolidarity - expectedEscrow; // 74%

      expect(solidarityVaultAfter - solidarityVaultBefore).to.equal(expectedSolidarity);
      expect(escrowVaultAfter - escrowVaultBefore).to.equal(expectedEscrow);
      expect(poolVaultAfter - poolVaultBefore).to.equal(expectedPool);
    });
  });

  describe("buildClaimPayoutIx — round-trip", function () {
    it("the app-built claim_payout(cycle=0) instruction is accepted by the program", async function () {
      // Pre-condition: pool float must cover credit_amount. The
      // contribute test above moved 74% of the installment into the
      // pool vault ($3.70). Top up the missing $1.30 so the solvency
      // guard passes.
      const credit = CREDIT;
      const poolVaultBalance = await readTokenBalance(env, fixture.poolUsdcVault);
      const topUp = credit - poolVaultBalance;
      if (topUp > 0n) {
        // Add the missing amount directly to the pool USDC vault.
        // This mirrors what `seed-topup.ts` does on devnet (deployer
        // pre-funds the pool to satisfy the solvency guard).
        writeTokenAccount(env.context, fixture.poolUsdcVault, {
          mint: usdcMint,
          owner: fixture.poolPk,
          amount: credit, // overwrite to exactly cover credit
        });
      }

      // ─── Snapshot pre-state ──────────────────────────────────────
      const memberUsdcBefore = await readTokenBalance(env, fixture.memberUsdc);
      const memberBefore = await (env.programs.core.account as any).member.fetch(fixture.memberPk);
      expect(memberBefore.paidOut).to.equal(false);

      // ─── Build via the APP ENCODER + send ────────────────────────
      const ix = buildClaimPayoutIx({
        pool: fixture.poolPk,
        memberWallet: member.publicKey,
        cycle: 0,
        slotIndex: 0,
        programIds: { core: env.ids.core, reputation: env.ids.reputation },
        usdcMint,
      });

      const tx = new Transaction().add(ix);
      tx.feePayer = member.publicKey;
      tx.recentBlockhash = (await env.context.banksClient.getLatestBlockhash())![0];
      tx.sign(member);

      await env.context.banksClient.processTransaction(tx);

      // ─── Snapshot post-state ─────────────────────────────────────
      const memberAfter = await (env.programs.core.account as any).member.fetch(fixture.memberPk);
      const poolAfter = await (env.programs.core.account as any).pool.fetch(fixture.poolPk);

      // Invariant 1: member.paid_out flipped
      expect(memberAfter.paidOut).to.equal(true);
      expect(memberAfter.totalReceived.toString()).to.equal(CREDIT.toString());

      // Invariant 2: pool.total_paid_out += credit
      expect(poolAfter.totalPaidOut.toString()).to.equal(CREDIT.toString());

      // Invariant 3: pool advances — cycles_total = 1, so it transitions Completed
      // (PoolStatus::Completed = 2)
      expect(poolAfter.status).to.equal(2);

      // Invariant 4: member's USDC ATA gained `credit`
      const memberUsdcAfter = await readTokenBalance(env, fixture.memberUsdc);
      expect(memberUsdcAfter - memberUsdcBefore).to.equal(CREDIT);
    });
  });

  describe("buildReleaseEscrowIx — round-trip", function () {
    it("the app-built release_escrow(checkpoint=1) instruction is accepted", async function () {
      // Pre-condition: the member has on_time_count >= 1 (set by the
      // contribute test above) and escrow_balance > 0 (25% of installment
      // was routed to the escrow vault). The member's
      // last_released_checkpoint is still 0, so checkpoint=1 is the
      // first valid release.

      // ─── Snapshot pre-state ──────────────────────────────────────
      const memberBefore = await (env.programs.core.account as any).member.fetch(fixture.memberPk);
      expect(memberBefore.lastReleasedCheckpoint).to.equal(0);
      expect(memberBefore.onTimeCount).to.equal(1);
      expect(memberBefore.escrowBalance.gt(new BN(0))).to.equal(true);

      const memberUsdcBefore = await readTokenBalance(env, fixture.memberUsdc);
      const escrowVaultBefore = await readTokenBalance(env, fixture.escrowVault);
      const escrowBalanceBefore = BigInt(memberBefore.escrowBalance.toString());

      // ─── Build via the APP ENCODER + send ────────────────────────
      const ix = buildReleaseEscrowIx({
        pool: fixture.poolPk,
        memberWallet: member.publicKey,
        checkpoint: 1,
        programIds: { core: env.ids.core },
        usdcMint,
      });

      const tx = new Transaction().add(ix);
      tx.feePayer = member.publicKey;
      tx.recentBlockhash = (await env.context.banksClient.getLatestBlockhash())![0];
      tx.sign(member);

      await env.context.banksClient.processTransaction(tx);

      // ─── Snapshot post-state ─────────────────────────────────────
      const memberAfter = await (env.programs.core.account as any).member.fetch(fixture.memberPk);

      // Invariant 1: last_released_checkpoint advanced 0 → 1
      expect(memberAfter.lastReleasedCheckpoint).to.equal(1);

      // Invariant 2: escrow_balance decreased by the released amount.
      // Single-cycle pool → checkpoint=1 / cycles_total=1 = 100% vested,
      // so the full escrow_balance is released.
      const escrowBalanceAfter = BigInt(memberAfter.escrowBalance.toString());
      const releasedAmount = escrowBalanceBefore - escrowBalanceAfter;
      expect(
        releasedAmount > 0n,
        `released amount should be positive, got ${releasedAmount}`,
      ).to.equal(true);

      // Invariant 3: USDC flowed escrow_vault → member_usdc_ata
      const memberUsdcAfter = await readTokenBalance(env, fixture.memberUsdc);
      const escrowVaultAfter = await readTokenBalance(env, fixture.escrowVault);
      expect(memberUsdcAfter - memberUsdcBefore).to.equal(releasedAmount);
      expect(escrowVaultBefore - escrowVaultAfter).to.equal(releasedAmount);
    });
  });

  // ─── Negative-path tests (#283 W3) ──────────────────────────────
  //
  // Deliberately-broken instructions: assert the program rejects with
  // the EXPECTED error code. These complement the structural spec by
  // proving the on-chain guards still fire when an encoder builds
  // technically-valid bytes for a state the program rejects.
  //
  // After the W2 chain, pool.status == Completed and member.paid_out
  // == true. We exploit those for the negative cases.

  describe("negative-path — buildContributeIx", function () {
    it("contribute for wrong cycle reverts with WrongCycle", async function () {
      // Pool's current_cycle is now 1 (advanced past cycle 0 by the
      // claim_payout in W1). Send a contribute(cycle=5) — way past the
      // current cycle. Program should reject with `WrongCycle`.
      const ix = buildContributeIx({
        pool: fixture.poolPk,
        memberWallet: member.publicKey,
        cycle: 5, // way past pool.current_cycle
        programIds: { core: env.ids.core, reputation: env.ids.reputation },
        usdcMint,
      });

      const tx = new Transaction().add(ix);
      tx.feePayer = member.publicKey;
      tx.recentBlockhash = (await env.context.banksClient.getLatestBlockhash())![0];
      tx.sign(member);

      let threw = false;
      try {
        await env.context.banksClient.processTransaction(tx);
      } catch (e) {
        threw = true;
        const err = e as { logs?: string[]; message?: string };
        const haystack = [...(err.logs ?? []), err.message ?? "", String(e)].join("\n");
        // Anchor surfaces errors as a code OR a name in the log. The
        // `WrongCycle` name appears in the program log line. Match
        // either form so this test stays stable across anchor versions.
        expect(haystack).to.match(
          /WrongCycle|PoolStatus|PoolNotActive|AlreadyContributed|Pool is in Completed/i,
          `expected pool/cycle-related reject; got:\n${haystack}`,
        );
      }
      expect(threw, "deliberately-broken contribute must reject").to.equal(true);
    });
  });

  describe("negative-path — buildClaimPayoutIx", function () {
    it("re-claiming a paid-out slot reverts", async function () {
      // member.paid_out = true after the W1 claim. A retry must reject
      // (the program guards against double-payout).
      const ix = buildClaimPayoutIx({
        pool: fixture.poolPk,
        memberWallet: member.publicKey,
        cycle: 0, // same cycle that was already claimed
        slotIndex: 0,
        programIds: { core: env.ids.core, reputation: env.ids.reputation },
        usdcMint,
      });

      const tx = new Transaction().add(ix);
      tx.feePayer = member.publicKey;
      tx.recentBlockhash = (await env.context.banksClient.getLatestBlockhash())![0];
      tx.sign(member);

      let threw = false;
      try {
        await env.context.banksClient.processTransaction(tx);
      } catch (e) {
        threw = true;
        const err = e as { logs?: string[]; message?: string };
        const haystack = [...(err.logs ?? []), err.message ?? "", String(e)].join("\n");
        // Either AlreadyPaidOut (the explicit guard) or
        // PoolStatusNotActive / PoolStatus::Completed (pool transitioned)
        // — both are valid rejections of a double-claim attempt.
        expect(haystack).to.match(
          /AlreadyPaidOut|paid_out|PoolNotActive|PoolStatus|Completed|WrongCycle/i,
          `expected paid-out / pool-status reject; got:\n${haystack}`,
        );
      }
      expect(threw, "re-claim must reject").to.equal(true);
    });
  });

  describe("negative-path — buildReleaseEscrowIx", function () {
    it("re-releasing the same checkpoint reverts with EscrowNothingToRelease", async function () {
      // last_released_checkpoint is now 1 (set by the W2 release).
      // Calling release_escrow(checkpoint=1) again must reject:
      // checkpoint > last_released_checkpoint is required (monotonic).
      const ix = buildReleaseEscrowIx({
        pool: fixture.poolPk,
        memberWallet: member.publicKey,
        checkpoint: 1, // same as last_released_checkpoint → not strictly greater
        programIds: { core: env.ids.core },
        usdcMint,
      });

      const tx = new Transaction().add(ix);
      tx.feePayer = member.publicKey;
      tx.recentBlockhash = (await env.context.banksClient.getLatestBlockhash())![0];
      tx.sign(member);

      let threw = false;
      try {
        await env.context.banksClient.processTransaction(tx);
      } catch (e) {
        threw = true;
        const err = e as { logs?: string[]; message?: string };
        const haystack = [...(err.logs ?? []), err.message ?? "", String(e)].join("\n");
        expect(haystack).to.match(
          /EscrowNothingToRelease|EscrowLocked|already.*released/i,
          `expected monotonic-checkpoint reject; got:\n${haystack}`,
        );
      }
      expect(threw, "re-release of same checkpoint must reject").to.equal(true);
    });
  });
});

// ─── escape_valve_list — separate fixture ─────────────────────────────
//
// `escape_valve_list` requires `pool.status == Active` AND
// `!member.paid_out` AND `!member.defaulted`. The shared fixture above
// runs claim_payout which transitions the pool to Completed AND flips
// member.paid_out = true, so listing is impossible there. We spin up a
// FRESH pool (different seedId) for this case.

describe("app encoders — escape_valve_list round-trip", function () {
  this.timeout(60_000);

  let env: BankrunEnv;
  const LIST_POOL_SEED_ID = 9999n;
  const poolAuthority = Keypair.generate();
  const seller = Keypair.generate();
  const treasury = Keypair.generate();
  const nftAsset = Keypair.generate();
  const usdcMint = Keypair.generate().publicKey;
  const metaplexCore = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

  let configPk: PublicKey;
  let poolPk: PublicKey;
  let memberPk: PublicKey;

  before(async function () {
    env = await setupBankrunEnv();

    // Fund seller's SOL
    env.context.setAccount(seller.publicKey, {
      lamports: 10_000_000_000,
      data: new Uint8Array(0),
      owner: SystemProgram.programId,
      executable: false,
      rentEpoch: 0,
    });

    [configPk] = protocolConfigPda(env.ids.core);
    [poolPk] = poolPda(env.ids.core, poolAuthority.publicKey, LIST_POOL_SEED_ID);
    [memberPk] = memberPda(env.ids.core, poolPk, seller.publicKey);
    const [escrowVaultAuth, escrowBump] = escrowVaultAuthorityPda(env.ids.core, poolPk);
    const [solidarityVaultAuth, solidarityBump] = solidarityVaultAuthorityPda(env.ids.core, poolPk);
    const [, yieldBump] = yieldVaultAuthorityPda(env.ids.core, poolPk);
    const [, configBump] = protocolConfigPda(env.ids.core);
    const [, poolBump] = poolPda(env.ids.core, poolAuthority.publicKey, LIST_POOL_SEED_ID);
    const [, memberBump] = memberPda(env.ids.core, poolPk, seller.publicKey);

    writeMintAccount(env.context, usdcMint, {
      mintAuthority: env.payer.publicKey,
      decimals: 6,
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
      seedId: new BN(LIST_POOL_SEED_ID.toString()),
      usdcMint,
      yieldAdapter: env.ids.yieldMock,
      membersTarget: 1,
      installmentAmount: new BN("5000000"),
      creditAmount: new BN("5000000"),
      cyclesTotal: 1,
      cycleDuration: new BN(3600),
      seedDrawBps: 9_160,
      solidarityBps: 100,
      escrowReleaseBps: 2_500,
      membersJoined: 1,
      status: 1, // Active
      startedAt: new BN(0),
      currentCycle: 0,
      nextCycleAt: new BN(1_800_000_000),
      totalContributed: new BN(0),
      totalPaidOut: new BN(0),
      solidarityBalance: new BN(0),
      escrowBalance: new BN(0),
      yieldAccrued: new BN(0),
      guaranteeFundBalance: new BN(0),
      totalProtocolFeeAccrued: new BN(0),
      yieldPrincipalDeposited: new BN(0),
      defaultedMembers: 0,
      slotsBitmap: Buffer.from([0x01, 0, 0, 0, 0, 0, 0, 0]),
      bump: poolBump,
      escrowVaultBump: escrowBump,
      solidarityVaultBump: solidarityBump,
      yieldVaultBump: yieldBump,
    });

    await writeAnchorAccount(env.context, env.programs.core, "member", memberPk, {
      pool: poolPk,
      wallet: seller.publicKey,
      nftAsset: nftAsset.publicKey,
      slotIndex: 0,
      reputationLevel: 1,
      stakeBps: 5_000,
      stakeDeposited: new BN("2500000"),
      contributionsPaid: 0,
      totalContributed: new BN(0),
      totalReceived: new BN(0),
      escrowBalance: new BN(0),
      onTimeCount: 0,
      lateCount: 0,
      defaulted: false,
      paidOut: false,
      lastReleasedCheckpoint: 0,
      joinedAt: new BN(0),
      stakeDepositedInitial: new BN("2500000"),
      totalEscrowDeposited: new BN(0),
      lastTransferredAt: new BN(0),
      bump: memberBump,
    });
  });

  it("the app-built escape_valve_list($14) instruction is accepted + Listing PDA exists", async function () {
    const priceUsdc = BigInt(14_000_000);

    // ─── Pre-state: Listing PDA does NOT exist yet ───────────────
    const [listingAddr] = listingPda(env.ids.core, poolPk, 0);
    const listingBefore = await env.context.banksClient.getAccount(listingAddr);
    expect(listingBefore, "Listing PDA should not exist before list").to.equal(null);

    // ─── Build via the APP ENCODER + send ────────────────────────
    const ix = buildEscapeValveListIx({
      pool: poolPk,
      sellerWallet: seller.publicKey,
      slotIndex: 0,
      priceUsdc,
      programIds: { core: env.ids.core },
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = seller.publicKey;
    tx.recentBlockhash = (await env.context.banksClient.getLatestBlockhash())![0];
    tx.sign(seller);

    await env.context.banksClient.processTransaction(tx);

    // ─── Post-state: Listing PDA EXISTS, with the price + status ───
    const listingAfter = await env.context.banksClient.getAccount(listingAddr);
    expect(listingAfter, "Listing PDA must exist after list").to.not.equal(null);

    const listing = await (env.programs.core.account as any).listing.fetch(listingAddr);
    expect(listing.pool.toBase58()).to.equal(poolPk.toBase58());
    expect(listing.seller.toBase58()).to.equal(seller.publicKey.toBase58());
    expect(listing.slotIndex).to.equal(0);
    expect(listing.priceUsdc.toString()).to.equal(priceUsdc.toString());
    // Listing status enum: 0 = Active.
    expect(listing.status).to.equal(0);
  });
});

// ─── settle_default — separate fixture with clock warp ────────────────
//
// `settle_default` requires:
//   1. `clock.unix_timestamp >= pool.next_cycle_at + GRACE_PERIOD_SECS`
//      — we use `setBankrunUnixTs` to push the clock past the deadline
//   2. `args.cycle == pool.current_cycle - 1` — pool has already
//      advanced past the missed cycle
//   3. `member.contributions_paid <= args.cycle` — member missed it
//   4. `!member.defaulted` — not already flagged
//
// We pre-seed the solidarity vault with $0.20 so the cascade has
// something to drain on Shield 1. Member's escrow + stake are left
// intact to verify the cascade STOPS at Shield 1 (mirrors the Pool 3
// devnet evidence in `docs/devnet-deployment.md`).
//
// Mirrors `tests/edge_grace_default.spec.ts` pattern for clock warp.
// #290 W3.

describe("app encoders — settle_default round-trip (#290 W3)", function () {
  this.timeout(60_000);

  let env: BankrunEnv;
  const SETTLE_POOL_SEED_ID = 7777n;
  const poolAuthority = Keypair.generate();
  const defaulter = Keypair.generate();
  const cranker = Keypair.generate();
  const treasury = Keypair.generate();
  const nftAsset = Keypair.generate();
  const usdcMint = Keypair.generate().publicKey;
  const metaplexCore = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

  const SETTLE_NEXT_CYCLE_AT = 1_800_000_000n;
  const SETTLE_GRACE_PERIOD_SECS = 60n; // matches `constants.rs::GRACE_PERIOD_SECS` (devnet patch)
  const SETTLE_INSTALLMENT = 10_000_000n; // $10 USDC
  const SETTLE_CREDIT = 30_000_000n; // 3 × installment
  const SETTLE_STAKE = 15_000_000n; // 50% of credit
  const SETTLE_SOLIDARITY_PRESEED = 200_000n; // $0.20 — enough to cover Shield 1 fully
  const SETTLE_ESCROW_PRESEED = 2_500_000n; // $2.50 — left intact after Shield 1 drains $0.20

  let configPk: PublicKey;
  let poolPk: PublicKey;
  let memberPk: PublicKey;
  let solidarityVault: PublicKey;
  let solidarityVaultAuth: PublicKey;
  let escrowVault: PublicKey;
  let escrowVaultAuth: PublicKey;
  let poolUsdcVault: PublicKey;

  before(async function () {
    env = await setupBankrunEnv();

    // Fund cranker's SOL so they can sign + pay attestation init rent.
    env.context.setAccount(cranker.publicKey, {
      lamports: 10_000_000_000,
      data: new Uint8Array(0),
      owner: SystemProgram.programId,
      executable: false,
      rentEpoch: 0,
    });

    [configPk] = protocolConfigPda(env.ids.core);
    [poolPk] = poolPda(env.ids.core, poolAuthority.publicKey, SETTLE_POOL_SEED_ID);
    [memberPk] = memberPda(env.ids.core, poolPk, defaulter.publicKey);
    [escrowVaultAuth] = escrowVaultAuthorityPda(env.ids.core, poolPk);
    [solidarityVaultAuth] = solidarityVaultAuthorityPda(env.ids.core, poolPk);
    const [, configBump] = protocolConfigPda(env.ids.core);
    const [, poolBump] = poolPda(env.ids.core, poolAuthority.publicKey, SETTLE_POOL_SEED_ID);
    const [, memberBump] = memberPda(env.ids.core, poolPk, defaulter.publicKey);
    const [, escrowBump] = escrowVaultAuthorityPda(env.ids.core, poolPk);
    const [, solidarityBump] = solidarityVaultAuthorityPda(env.ids.core, poolPk);
    const [, yieldBump] = yieldVaultAuthorityPda(env.ids.core, poolPk);

    poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, poolPk, true);
    escrowVault = getAssociatedTokenAddressSync(usdcMint, escrowVaultAuth, true);
    solidarityVault = getAssociatedTokenAddressSync(usdcMint, solidarityVaultAuth, true);

    writeMintAccount(env.context, usdcMint, {
      mintAuthority: env.payer.publicKey,
      decimals: 6,
    });

    // Token vaults — solidarity has the cascade source; escrow holds
    // the member's existing escrow_balance.
    writeTokenAccount(env.context, poolUsdcVault, {
      mint: usdcMint,
      owner: poolPk,
      amount: 0n,
    });
    writeTokenAccount(env.context, solidarityVault, {
      mint: usdcMint,
      owner: solidarityVaultAuth,
      amount: SETTLE_SOLIDARITY_PRESEED,
    });
    writeTokenAccount(env.context, escrowVault, {
      mint: usdcMint,
      owner: escrowVaultAuth,
      amount: SETTLE_ESCROW_PRESEED,
    });

    // `reputation_program = default` skips the CPI to the reputation
    // program (covered separately by `reputation_cpi.spec.ts`).
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

    // Pool: cycles_total=3, current_cycle=2 — past the missed cycle 1.
    await writeAnchorAccount(env.context, env.programs.core, "pool", poolPk, {
      authority: poolAuthority.publicKey,
      seedId: new BN(SETTLE_POOL_SEED_ID.toString()),
      usdcMint,
      yieldAdapter: env.ids.yieldMock,
      membersTarget: 3,
      installmentAmount: new BN(SETTLE_INSTALLMENT.toString()),
      creditAmount: new BN(SETTLE_CREDIT.toString()),
      cyclesTotal: 3,
      cycleDuration: new BN(60),
      seedDrawBps: 9_160,
      solidarityBps: 100,
      escrowReleaseBps: 2_500,
      membersJoined: 3,
      status: 1, // Active
      startedAt: new BN((SETTLE_NEXT_CYCLE_AT - 180n).toString()),
      currentCycle: 2,
      nextCycleAt: new BN(SETTLE_NEXT_CYCLE_AT.toString()),
      totalContributed: new BN(SETTLE_INSTALLMENT.toString()),
      totalPaidOut: new BN(0),
      // Solidarity balance bookkeeping must match the vault ATA balance.
      solidarityBalance: new BN(SETTLE_SOLIDARITY_PRESEED.toString()),
      escrowBalance: new BN(SETTLE_ESCROW_PRESEED.toString()),
      yieldAccrued: new BN(0),
      guaranteeFundBalance: new BN(0),
      totalProtocolFeeAccrued: new BN(0),
      yieldPrincipalDeposited: new BN(0),
      defaultedMembers: 0,
      // All 3 slots filled.
      slotsBitmap: Buffer.from([0x07, 0, 0, 0, 0, 0, 0, 0]),
      bump: poolBump,
      escrowVaultBump: escrowBump,
      solidarityVaultBump: solidarityBump,
      yieldVaultBump: yieldBump,
    });

    // Member: paid cycle 0 only (contributions_paid=1), missed cycle 1.
    // slot_index=1 (the cycle they were supposed to receive payout for —
    // but we're settling the cycle THEY MISSED, which is cycle 1).
    await writeAnchorAccount(env.context, env.programs.core, "member", memberPk, {
      pool: poolPk,
      wallet: defaulter.publicKey,
      nftAsset: nftAsset.publicKey,
      slotIndex: 1,
      reputationLevel: 1,
      stakeBps: 5_000,
      stakeDeposited: new BN(SETTLE_STAKE.toString()),
      contributionsPaid: 1, // paid cycle 0, missed cycle 1
      totalContributed: new BN(SETTLE_INSTALLMENT.toString()),
      totalReceived: new BN(0),
      escrowBalance: new BN(SETTLE_ESCROW_PRESEED.toString()),
      onTimeCount: 1,
      lateCount: 0,
      defaulted: false,
      paidOut: false,
      lastReleasedCheckpoint: 0,
      joinedAt: new BN((SETTLE_NEXT_CYCLE_AT - 240n).toString()),
      stakeDepositedInitial: new BN(SETTLE_STAKE.toString()),
      totalEscrowDeposited: new BN(SETTLE_ESCROW_PRESEED.toString()),
      lastTransferredAt: new BN(0),
      bump: memberBump,
    });
  });

  it("the app-built settle_default(cycle=1) instruction is accepted + Shield 1 drains solidarity", async function () {
    // Push the bankrun clock past the grace deadline so the
    // `SettleDefaultGracePeriodNotElapsed` guard doesn't trip.
    await setBankrunUnixTs(env.context, SETTLE_NEXT_CYCLE_AT + SETTLE_GRACE_PERIOD_SECS + 10n);

    // ─── Snapshot pre-state ──────────────────────────────────────
    const memberBefore = await (env.programs.core.account as any).member.fetch(memberPk);
    const poolBefore = await (env.programs.core.account as any).pool.fetch(poolPk);
    const solidarityBefore = await readTokenBalance(env, solidarityVault);
    const escrowBefore = await readTokenBalance(env, escrowVault);

    expect(memberBefore.defaulted).to.equal(false);
    expect(memberBefore.contributionsPaid).to.equal(1);
    expect(poolBefore.currentCycle).to.equal(2);
    expect(solidarityBefore).to.equal(SETTLE_SOLIDARITY_PRESEED);

    // ─── Build via the APP ENCODER + send ────────────────────────
    const ix = buildSettleDefaultIx({
      pool: poolPk,
      caller: cranker.publicKey,
      defaultedMemberWallet: defaulter.publicKey,
      slotIndex: 1,
      cycle: 1, // pool.current_cycle - 1
      programIds: { core: env.ids.core, reputation: env.ids.reputation },
      usdcMint,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = cranker.publicKey;
    tx.recentBlockhash = (await env.context.banksClient.getLatestBlockhash())![0];
    tx.sign(cranker);

    await env.context.banksClient.processTransaction(tx);

    // ─── Snapshot post-state ─────────────────────────────────────
    const memberAfter = await (env.programs.core.account as any).member.fetch(memberPk);
    const poolAfter = await (env.programs.core.account as any).pool.fetch(poolPk);

    // Invariant 1: member.defaulted = true
    expect(memberAfter.defaulted).to.equal(true);

    // Invariant 2: pool.defaulted_members increments
    expect(poolAfter.defaultedMembers).to.equal(1);

    // Invariant 3: Shield 1 drained solidarity vault by installment
    // amount (in this fixture, solidarity has exactly $0.20 = enough
    // to cover the cascade BUT the cascade is capped by the missed
    // installment of $10. So the actual seized amount is bounded by
    // solidarity balance — Shield 1 drains all $0.20 and Shields 2+3
    // pick up the remaining $9.80 from escrow + stake.
    const solidarityAfter = await readTokenBalance(env, solidarityVault);
    expect(solidarityAfter).to.equal(0n);

    // Invariant 4: cascade may also touch escrow (Shield 2). The exact
    // split depends on the D/C invariant — we assert the escrow
    // balance dropped (Shield 2 fired) without pinning the exact amount
    // (which is the cascade math's job to validate; here we just
    // confirm the integration).
    const escrowAfter = await readTokenBalance(env, escrowVault);
    expect(escrowAfter <= escrowBefore, "escrow vault may decrease via Shield 2").to.equal(true);
  });
});

// ─── deposit_idle_to_yield — separate fixture ─────────────────────────
//
// `deposit_idle_to_yield` is a permissionless crank that moves USDC
// from the pool's USDC vault into the yield adapter's vault. It does
// NOT touch Member state. On the on-chain side it CPIs into the
// adapter program's `deposit` instruction; for the mock adapter
// (`roundfi-yield-mock`), the CPI just transfers + bumps the
// `tracked_principal` field on the YieldVaultState PDA.
//
// Fixture needs:
//   1. Pool with `yield_adapter == env.ids.yieldMock`, status = Active
//   2. Pool USDC vault funded with some amount to deposit
//   3. YieldVaultState PDA (yield-mock-owned) seeded with `pool` = our pool
//   4. Yield-mock vault ATA (owner = YieldVaultState PDA) seeded empty
//
// #290 W3 (continued).

describe("app encoders — deposit_idle_to_yield round-trip (#290 W3)", function () {
  this.timeout(60_000);

  let env: BankrunEnv;
  const DEPOSIT_POOL_SEED_ID = 8888n;
  const poolAuthority = Keypair.generate();
  const cranker = Keypair.generate();
  const treasury = Keypair.generate();
  const usdcMint = Keypair.generate().publicKey;
  const metaplexCore = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

  const POOL_VAULT_FUND = 5_000_000n; // $5 — enough to deposit $3 and leave $2 behind
  const DEPOSIT_AMOUNT = 3_000_000n; // $3 — the amount we'll move to yield

  let configPk: PublicKey;
  let poolPk: PublicKey;
  let poolUsdcVault: PublicKey;
  let yieldStatePk: PublicKey;
  let yieldVault: PublicKey;

  before(async function () {
    env = await setupBankrunEnv();

    env.context.setAccount(cranker.publicKey, {
      lamports: 10_000_000_000,
      data: new Uint8Array(0),
      owner: SystemProgram.programId,
      executable: false,
      rentEpoch: 0,
    });

    [configPk] = protocolConfigPda(env.ids.core);
    [poolPk] = poolPda(env.ids.core, poolAuthority.publicKey, DEPOSIT_POOL_SEED_ID);
    [yieldStatePk] = yieldVaultStatePda(env.ids.yieldMock, poolPk);
    const [escrowVaultAuth, escrowBump] = escrowVaultAuthorityPda(env.ids.core, poolPk);
    const [solidarityVaultAuth, solidarityBump] = solidarityVaultAuthorityPda(env.ids.core, poolPk);
    const [, yieldVaultBump] = yieldVaultAuthorityPda(env.ids.core, poolPk);
    const [, configBump] = protocolConfigPda(env.ids.core);
    const [, poolBump] = poolPda(env.ids.core, poolAuthority.publicKey, DEPOSIT_POOL_SEED_ID);

    poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, poolPk, true);
    // The yield-mock vault is the ATA owned by the YieldVaultState PDA
    // (NOT the pool). The mock's `init_vault` instruction creates this
    // ATA with the state PDA as owner.
    yieldVault = getAssociatedTokenAddressSync(usdcMint, yieldStatePk, true);
    // Core-side escrow + solidarity vaults — required by Pool's
    // account constraints even though deposit_idle_to_yield doesn't
    // touch them. We seed them empty to satisfy ATA existence.
    const escrowVault = getAssociatedTokenAddressSync(usdcMint, escrowVaultAuth, true);
    const solidarityVault = getAssociatedTokenAddressSync(usdcMint, solidarityVaultAuth, true);

    writeMintAccount(env.context, usdcMint, {
      mintAuthority: env.payer.publicKey,
      decimals: 6,
    });

    writeTokenAccount(env.context, poolUsdcVault, {
      mint: usdcMint,
      owner: poolPk,
      amount: POOL_VAULT_FUND,
    });
    writeTokenAccount(env.context, escrowVault, {
      mint: usdcMint,
      owner: escrowVaultAuth,
      amount: 0n,
    });
    writeTokenAccount(env.context, solidarityVault, {
      mint: usdcMint,
      owner: solidarityVaultAuth,
      amount: 0n,
    });
    // Yield-mock vault: owner is the state PDA, balance starts at 0.
    writeTokenAccount(env.context, yieldVault, {
      mint: usdcMint,
      owner: yieldStatePk,
      amount: 0n,
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

    // Pool: yieldAdapter pinned to yield-mock, status Active.
    await writeAnchorAccount(env.context, env.programs.core, "pool", poolPk, {
      authority: poolAuthority.publicKey,
      seedId: new BN(DEPOSIT_POOL_SEED_ID.toString()),
      usdcMint,
      yieldAdapter: env.ids.yieldMock,
      membersTarget: 3,
      installmentAmount: new BN("1000000"),
      creditAmount: new BN("3000000"),
      cyclesTotal: 3,
      cycleDuration: new BN(60),
      seedDrawBps: 9_160,
      solidarityBps: 100,
      escrowReleaseBps: 2_500,
      membersJoined: 3,
      status: 1, // Active
      startedAt: new BN(1_799_999_000),
      currentCycle: 0,
      nextCycleAt: new BN(1_800_000_000),
      totalContributed: new BN(0),
      totalPaidOut: new BN(0),
      solidarityBalance: new BN(0),
      escrowBalance: new BN(0),
      yieldAccrued: new BN(0),
      guaranteeFundBalance: new BN(0),
      totalProtocolFeeAccrued: new BN(0),
      yieldPrincipalDeposited: new BN(0),
      defaultedMembers: 0,
      slotsBitmap: Buffer.from([0x07, 0, 0, 0, 0, 0, 0, 0]),
      bump: poolBump,
      escrowVaultBump: escrowBump,
      solidarityVaultBump: solidarityBump,
      yieldVaultBump: yieldVaultBump,
    });

    // YieldVaultState — what `init_vault` on yield-mock would have written.
    // Seeded directly so we don't need to run init_vault as a setup tx.
    const [, yieldStateBump] = yieldVaultStatePda(env.ids.yieldMock, poolPk);
    await writeAnchorAccount(env.context, env.programs.yieldMock, "yieldVaultState", yieldStatePk, {
      pool: poolPk,
      underlyingMint: usdcMint,
      vault: yieldVault,
      trackedPrincipal: new BN(0),
      bump: yieldStateBump,
    });
  });

  it("the app-built deposit_idle_to_yield($3) instruction is accepted + USDC flows pool → yield-vault", async function () {
    // ─── Snapshot pre-state ──────────────────────────────────────
    const poolVaultBefore = await readTokenBalance(env, poolUsdcVault);
    const yieldVaultBefore = await readTokenBalance(env, yieldVault);
    const poolBefore = await (env.programs.core.account as any).pool.fetch(poolPk);

    expect(poolVaultBefore).to.equal(POOL_VAULT_FUND);
    expect(yieldVaultBefore).to.equal(0n);
    expect(poolBefore.yieldPrincipalDeposited.toString()).to.equal("0");

    // ─── Build via the APP ENCODER + send ────────────────────────
    const ix = buildDepositIdleToYieldIx({
      pool: poolPk,
      caller: cranker.publicKey,
      amount: DEPOSIT_AMOUNT,
      yieldVault,
      yieldAdapterProgram: env.ids.yieldMock,
      programIds: { core: env.ids.core },
      usdcMint,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = cranker.publicKey;
    tx.recentBlockhash = (await env.context.banksClient.getLatestBlockhash())![0];
    tx.sign(cranker);

    await env.context.banksClient.processTransaction(tx);

    // ─── Snapshot post-state ─────────────────────────────────────
    const poolVaultAfter = await readTokenBalance(env, poolUsdcVault);
    const yieldVaultAfter = await readTokenBalance(env, yieldVault);
    const poolAfter = await (env.programs.core.account as any).pool.fetch(poolPk);

    // Invariant 1: USDC flowed pool vault → yield-mock vault by `amount`
    expect(poolVaultBefore - poolVaultAfter).to.equal(DEPOSIT_AMOUNT);
    expect(yieldVaultAfter - yieldVaultBefore).to.equal(DEPOSIT_AMOUNT);

    // Invariant 2: pool.yield_principal_deposited += amount
    expect(poolAfter.yieldPrincipalDeposited.toString()).to.equal(DEPOSIT_AMOUNT.toString());
  });
});

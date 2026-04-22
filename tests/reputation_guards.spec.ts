/**
 * Reputation CPI integration — guards + negative paths (Step 5d / 2).
 *
 * Proves the reject paths actually reject AND that profile state
 * survives the rejection intact (no half-applied deltas, no rogue
 * attestations, no leaked counters).
 *
 * The happy-path spec (`reputation_cpi.spec.ts`) covers the success
 * side. This spec focuses exclusively on the guards enforced by:
 *
 *   core::cpi::reputation::invoke_attest       — program-id + executable
 *   reputation::attest handler                 — issuer, schema, cooldown,
 *                                                PDA uniqueness
 *
 * Cases:
 *   1. Program-id mismatch — contribute called with a wrong
 *      `reputation_program` account reverts with Unauthorized; profile
 *      and pool vault are unchanged.
 *   2. Replay — re-calling contribute with the same (cycle, slot) fails
 *      at the attestation-PDA init (AccountAlreadyInUse) and the
 *      profile state does NOT mutate across the failed attempt.
 *   3. Invalid schema — admin attest with schemaId=99 rejects with
 *      InvalidSchema; profile unchanged.
 *   4. Invalid issuer — a random signer attempts admin-style attest;
 *      neither the config authority nor a valid pool PDA, so it rejects
 *      with InvalidIssuer; profile unchanged.
 *   5. Cross-pool isolation — attestations from pool A and pool B for
 *      the SAME subject land at DISTINCT PDAs (seeds include issuer).
 *      Both succeed; profile aggregates counts from both pools. A
 *      pool-scoped failure in A must not corrupt data seeded from B.
 *
 * Determinism:
 *   • Seeded member keypairs (`memberKeypairs("repguards")`).
 *   • No sleeps, no clock warp, fixed amounts.
 *
 * State-immutability assertion helpers:
 *   `snapshotProfile` / `expectProfileUnchanged` diff the loosely-typed
 *   profile fields that guards could plausibly touch (score, counters,
 *   level, last_updated_at). We do NOT include `last_cycle_complete_at`
 *   in the immutability check because revoke does not touch it (by
 *   design) and no other instruction resets it.
 */

import { expect } from "chai";
import {
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { ATTESTATION_SCHEMA } from "@roundfi/sdk";

import {
  SCHEMA,
  adminAttest,
  attestationFor,
  attestationNonce,
  balanceOf,
  configPda,
  contribute,
  createPool,
  createUsdcMint,
  fetchProfile,
  fundUsdc,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  memberKeypairs,
  reputationConfigFor,
  reputationProfileFor,
  setupEnv,
  usdc,
  type Env,
  type MemberHandle,
  type PoolHandle,
} from "./_harness/index.js";

// ─── Base pool parameters ─────────────────────────────────────────────

const MEMBERS_TARGET     = 3;
const CYCLES_TOTAL       = 3;
const CYCLE_DURATION_SEC = 60;
const INSTALLMENT_USDC   = 1_250n;
const CREDIT_USDC        = 2_775n;

const LEVEL: 1 | 2 | 3   = 2;

const INSTALLMENT_BASE   = usdc(INSTALLMENT_USDC);
const CREDIT_BASE        = usdc(CREDIT_USDC);

const DELTA_PAYMENT_UNVERIFIED = 5n;

// ─── View + snapshot helpers ──────────────────────────────────────────

interface ProfileSnapshot {
  score: bigint;
  level: number;
  cyclesCompleted: number;
  onTimePayments: number;
  latePayments: number;
  defaults: number;
  totalParticipated: number;
  lastUpdatedAt: bigint;
}

function bn(x: { toString(): string }): bigint {
  return BigInt(x.toString());
}

async function snapshotProfile(
  env: Env,
  wallet: PublicKey,
): Promise<ProfileSnapshot> {
  const raw = await fetchProfile(env, wallet);
  const p = raw as unknown as {
    score: { toString(): string };
    level: number;
    cyclesCompleted: number;
    onTimePayments: number;
    latePayments: number;
    defaults: number;
    totalParticipated: number;
    lastUpdatedAt: { toString(): string };
  };
  return {
    score:             bn(p.score),
    level:             p.level,
    cyclesCompleted:   p.cyclesCompleted,
    onTimePayments:    p.onTimePayments,
    latePayments:      p.latePayments,
    defaults:          p.defaults,
    totalParticipated: p.totalParticipated,
    lastUpdatedAt:     bn(p.lastUpdatedAt),
  };
}

function expectProfileUnchanged(
  before: ProfileSnapshot,
  after: ProfileSnapshot,
  label: string,
): void {
  expect(after.score, `${label}: score`).to.equal(before.score);
  expect(after.level, `${label}: level`).to.equal(before.level);
  expect(after.cyclesCompleted, `${label}: cyclesCompleted`).to.equal(before.cyclesCompleted);
  expect(after.onTimePayments, `${label}: onTimePayments`).to.equal(before.onTimePayments);
  expect(after.latePayments, `${label}: latePayments`).to.equal(before.latePayments);
  expect(after.defaults, `${label}: defaults`).to.equal(before.defaults);
  expect(after.totalParticipated, `${label}: totalParticipated`).to.equal(before.totalParticipated);
  expect(after.lastUpdatedAt, `${label}: lastUpdatedAt`).to.equal(before.lastUpdatedAt);
}

/** Run a thunk and expect it to reject. Returns the error message. */
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

describe("reputation CPI — guards + negative paths", function () {
  this.timeout(180_000);

  let env: Env;
  let usdcMint: PublicKey;

  const authorityA = Keypair.generate();
  const membersA = memberKeypairs(MEMBERS_TARGET, "repguards/A");

  let poolA: PoolHandle;
  let handlesA: MemberHandle[];

  before(async function () {
    env = await setupEnv();
    usdcMint = await createUsdcMint(env);
    await initializeProtocol(env, { usdcMint });
    await initializeReputation(env, { coreProgram: env.ids.core });

    poolA = await createPool(env, {
      authority: authorityA,
      usdcMint,
      membersTarget:     MEMBERS_TARGET,
      installmentAmount: INSTALLMENT_BASE,
      creditAmount:      CREDIT_BASE,
      cyclesTotal:       CYCLES_TOTAL,
      cycleDurationSec:  CYCLE_DURATION_SEC,
      escrowReleaseBps:  2_500,
    });

    handlesA = await joinMembers(
      env,
      poolA,
      membersA.map((m) => ({ member: m, reputationLevel: LEVEL })),
    );

    // Fund each member for all cycles — we'll spend maybe 2 contributes.
    for (const m of membersA) {
      await fundUsdc(env, usdcMint, m.publicKey, BigInt(CYCLES_TOTAL) * INSTALLMENT_BASE);
    }
  });

  // ─── 1. Program-id mismatch on contribute ───────────────────────────

  it("contribute with wrong reputation_program → Unauthorized, profile unchanged", async function () {
    const h = handlesA[0]!;
    const before = await snapshotProfile(env, h.wallet.publicKey);
    const poolBalBefore = await balanceOf(env, poolA.poolUsdcVault);

    const nonce = attestationNonce(0, h.slotIndex);
    const attestation = attestationFor(
      env,
      poolA.pool,
      h.wallet.publicKey,
      ATTESTATION_SCHEMA.Payment,
      nonce,
    );

    // Hand-roll the contribute call so we can replace `reputationProgram`
    // with a lookalike — yieldMock is a real, executable program, so the
    // executable guard passes but the keys-eq guard fails.
    const msg = await expectRejected(() =>
      env.programs.core.methods
        .contribute({ cycle: 0 })
        .accounts({
          memberWallet:             h.wallet.publicKey,
          config:                   configPda(env),
          pool:                     poolA.pool,
          member:                   h.member,
          usdcMint,
          memberUsdc:               h.memberUsdc,
          poolUsdcVault:            poolA.poolUsdcVault,
          solidarityVaultAuthority: poolA.solidarityVaultAuthority,
          solidarityVault:          poolA.solidarityVault,
          escrowVaultAuthority:     poolA.escrowVaultAuthority,
          escrowVault:              poolA.escrowVault,
          tokenProgram:             TOKEN_PROGRAM_ID,
          reputationProgram:        env.ids.yieldMock,   // <<< wrong
          reputationConfig:         reputationConfigFor(env),
          reputationProfile:        reputationProfileFor(env, h.wallet.publicKey),
          identityRecord:           env.ids.yieldMock,   // sentinel must match
          attestation,
          systemProgram:            SystemProgram.programId,
        })
        .signers([h.wallet])
        .rpc(),
    );
    // Anchor surfaces the error as text; check Unauthorized is mentioned.
    expect(msg, `message: ${msg}`).to.match(/Unauthorized|unauthorized/);

    // Pool vault is unchanged (tx fully reverted — the USDC debit
    // happens before the CPI but the tx is atomic).
    expect(await balanceOf(env, poolA.poolUsdcVault)).to.equal(poolBalBefore);

    // Attestation PDA was never initialized.
    const attInfo = await env.connection.getAccountInfo(attestation, "confirmed");
    expect(attInfo, "attestation must not exist after revert").to.be.null;

    // Profile state identical.
    const after = await snapshotProfile(env, h.wallet.publicKey);
    expectProfileUnchanged(before, after, "program-id mismatch");
  });

  // ─── 2. Replay guard ─────────────────────────────────────────────────

  it("replay same (cycle, slot) after a good contribute → rejects, profile unchanged", async function () {
    // First, make a real contribute succeed so the attestation PDA exists.
    const h = handlesA[0]!;
    await contribute(env, { pool: poolA, member: h, cycle: 0, schemaId: SCHEMA.Payment });

    const nonce = attestationNonce(0, h.slotIndex);
    const attestation = attestationFor(
      env,
      poolA.pool,
      h.wallet.publicKey,
      ATTESTATION_SCHEMA.Payment,
      nonce,
    );
    const attInfoAfterGood = await env.connection.getAccountInfo(attestation, "confirmed");
    expect(attInfoAfterGood, "Payment PDA should be funded after good contribute").to.not.be.null;

    // Snapshot profile AFTER the good contribute — this is the "invariant
    // against replay" baseline we want to prove doesn't move.
    const baseline = await snapshotProfile(env, h.wallet.publicKey);
    expect(baseline.onTimePayments).to.equal(1);
    expect(baseline.score).to.equal(DELTA_PAYMENT_UNVERIFIED);

    // Replay: same member, same cycle, same slot. Expect reject — the
    // attestation PDA is `init` (not `init_if_needed`), so the tx fails
    // at account allocation (already-in-use / discriminator mismatch).
    const msg = await expectRejected(() =>
      contribute(env, { pool: poolA, member: h, cycle: 0, schemaId: SCHEMA.Payment }),
    );
    // Don't pin on exact message — different Anchor versions phrase
    // "already in use" differently. Just make sure SOMETHING failed.
    expect(msg.length).to.be.greaterThan(0);

    // The profile must be bit-identical to baseline.
    const after = await snapshotProfile(env, h.wallet.publicKey);
    expectProfileUnchanged(baseline, after, "replay");
  });

  // ─── 3. Invalid schema via admin path ───────────────────────────────

  it("admin attest with unknown schema (99) → InvalidSchema, profile unchanged", async function () {
    const h = handlesA[1]!;          // different member so we don't tangle with #2
    const before = await snapshotProfile(env, h.wallet.publicKey);

    const msg = await expectRejected(() =>
      adminAttest(env, {
        subject:  h.wallet.publicKey,
        schemaId: 99,
        nonce:    0xdead0001n,
      }),
    );
    expect(msg, `message: ${msg}`).to.match(/InvalidSchema|schema/i);

    const after = await snapshotProfile(env, h.wallet.publicKey);
    expectProfileUnchanged(before, after, "invalid schema");
  });

  // ─── 4. Invalid issuer (random signer) ──────────────────────────────

  it("admin attest signed by a random keypair → InvalidIssuer, profile unchanged", async function () {
    const h = handlesA[2]!;
    const before = await snapshotProfile(env, h.wallet.publicKey);

    // Airdrop the random keypair so it can sign. It's neither the config
    // authority (env.payer) nor a valid pool PDA (not executable either,
    // but that check is at the CPI layer, not here — here it's the handler
    // asserting is_admin || is_pool_pda).
    const rogue = Keypair.generate();
    const airdropSig = await env.connection.requestAirdrop(
      rogue.publicKey,
      2_000_000_000, // 2 SOL
    );
    await env.connection.confirmTransaction(airdropSig, "confirmed");

    const msg = await expectRejected(() =>
      adminAttest(env, {
        subject:  h.wallet.publicKey,
        schemaId: SCHEMA.Payment,
        nonce:    0xdead0002n,
        issuer:   rogue,
      }),
    );
    expect(msg, `message: ${msg}`).to.match(/InvalidIssuer|issuer/i);

    const after = await snapshotProfile(env, h.wallet.publicKey);
    expectProfileUnchanged(before, after, "invalid issuer");
  });

  // ─── 5. Cross-pool isolation ────────────────────────────────────────

  describe("cross-pool isolation", function () {
    const sharedMember = Keypair.generate();
    const companionB   = Keypair.generate();
    const authorityB   = Keypair.generate();
    const companionA   = memberKeypairs(1, "repguards/companionA")[0]!;
    const authorityC   = Keypair.generate();

    let poolX: PoolHandle;   // pool with sharedMember + companionA
    let poolY: PoolHandle;   // pool with sharedMember + companionB

    let sharedInX: MemberHandle;
    let sharedInY: MemberHandle;

    before(async function () {
      // Two fresh pools, each 2 members × 2 cycles, so the shared
      // member's slot_index is 0 in one and 0 in the other. That's the
      // worst-case for PDA collision checks: same (subject, schema,
      // nonce) but different issuer — distinct PDAs by construction.

      poolX = await createPool(env, {
        authority: authorityB,
        usdcMint,
        membersTarget:     2,
        installmentAmount: INSTALLMENT_BASE,
        // credit <= pool_float_per_inst = 925 × 2 = 1_850
        creditAmount:      usdc(1_800n),
        cyclesTotal:       2,
        cycleDurationSec:  CYCLE_DURATION_SEC,
        escrowReleaseBps:  2_500,
      });
      // sharedMember first (slot 0), companionA second (slot 1).
      const handlesX = await joinMembers(env, poolX, [
        { member: sharedMember, reputationLevel: LEVEL },
        { member: companionA,   reputationLevel: LEVEL },
      ]);
      sharedInX = handlesX[0]!;

      poolY = await createPool(env, {
        authority: authorityC,
        usdcMint,
        membersTarget:     2,
        installmentAmount: INSTALLMENT_BASE,
        creditAmount:      usdc(1_800n),
        cyclesTotal:       2,
        cycleDurationSec:  CYCLE_DURATION_SEC,
        escrowReleaseBps:  2_500,
      });
      const handlesY = await joinMembers(env, poolY, [
        { member: sharedMember, reputationLevel: LEVEL },
        { member: companionB,   reputationLevel: LEVEL },
      ]);
      sharedInY = handlesY[0]!;

      // Top-up sharedMember so it can contribute in both pools. Two
      // installments total across both pools.
      await fundUsdc(env, usdcMint, sharedMember.publicKey, 2n * INSTALLMENT_BASE);
    });

    it("same (subject, cycle, slot) in two pools → distinct attestation PDAs", async function () {
      const before = await snapshotProfile(env, sharedMember.publicKey);

      const nonce = attestationNonce(0, 0);
      const pdaX = attestationFor(
        env, poolX.pool, sharedMember.publicKey, ATTESTATION_SCHEMA.Payment, nonce,
      );
      const pdaY = attestationFor(
        env, poolY.pool, sharedMember.publicKey, ATTESTATION_SCHEMA.Payment, nonce,
      );
      expect(pdaX.toBase58()).to.not.equal(pdaY.toBase58());

      // Contribute in X.
      await contribute(env, { pool: poolX, member: sharedInX, cycle: 0, schemaId: SCHEMA.Payment });
      const afterX = await snapshotProfile(env, sharedMember.publicKey);
      expect(afterX.score - before.score).to.equal(DELTA_PAYMENT_UNVERIFIED);
      expect(afterX.onTimePayments - before.onTimePayments).to.equal(1);

      const infoX = await env.connection.getAccountInfo(pdaX, "confirmed");
      expect(infoX, "pool X attestation should exist").to.not.be.null;

      // Contribute in Y — completely independent issuer.
      await contribute(env, { pool: poolY, member: sharedInY, cycle: 0, schemaId: SCHEMA.Payment });
      const afterY = await snapshotProfile(env, sharedMember.publicKey);
      expect(afterY.score - afterX.score).to.equal(DELTA_PAYMENT_UNVERIFIED);
      expect(afterY.onTimePayments - afterX.onTimePayments).to.equal(1);

      const infoY = await env.connection.getAccountInfo(pdaY, "confirmed");
      expect(infoY, "pool Y attestation should exist").to.not.be.null;

      // Profile aggregates both — it's the global per-wallet record.
      expect(afterY.onTimePayments - before.onTimePayments).to.equal(2);
      expect(afterY.score - before.score).to.equal(2n * DELTA_PAYMENT_UNVERIFIED);
    });

    it("replay in X does not affect Y's attestation or score", async function () {
      const before = await snapshotProfile(env, sharedMember.publicKey);

      // Re-attempt pool X (cycle 0, slot 0) — already attested above.
      const msg = await expectRejected(() =>
        contribute(env, { pool: poolX, member: sharedInX, cycle: 0, schemaId: SCHEMA.Payment }),
      );
      expect(msg.length).to.be.greaterThan(0);

      // Pool Y's attestation PDA still exists.
      const pdaY = attestationFor(
        env, poolY.pool, sharedMember.publicKey, ATTESTATION_SCHEMA.Payment,
        attestationNonce(0, 0),
      );
      const infoY = await env.connection.getAccountInfo(pdaY, "confirmed");
      expect(infoY, "pool Y attestation should still exist after X replay").to.not.be.null;

      // Profile is unchanged.
      const after = await snapshotProfile(env, sharedMember.publicKey);
      expectProfileUnchanged(before, after, "X-replay does not affect Y");
    });
  });
});

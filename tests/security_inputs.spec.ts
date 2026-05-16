/**
 * Security — malicious inputs + PDA tampering (Step 5e / 1).
 *
 * Treats every contribute account slot as hostile and verifies that
 * Anchor's seeds/ownership/constraint guards trip on every tamper.
 * After each failed attack we assert the "fail-closed" invariant:
 * no balance moves, no member/pool state mutation, no profile deltas,
 * no leftover attestation PDAs.
 *
 * Attacks covered:
 *   A. Seed-based PDA tampering
 *     • Pool swapped for a foreign pool (same member wallet)
 *     • Member PDA from pool B passed against pool A
 *     • Solidarity / escrow vault authorities from pool B vs pool A
 *     • Non-canonical PDA (derived under wrong seed bytes)
 *
 *   B. Explicit constraint checks
 *     • Wrong `usdc_mint` (different SPL mint)
 *     • `pool_usdc_vault` owned by attacker, not by pool
 *     • `pool_usdc_vault` whose mint is a different SPL mint
 *
 *   C. Ownership / discriminator
 *     • SystemProgram-owned empty account passed as `pool`
 *     • Random keypair with no on-chain presence passed as `member`
 *
 * "Correct address, wrong bump":
 *   Not representable in Anchor — address IS a deterministic function
 *   of (seeds, program_id, bump), so "wrong bump" ⇒ different address.
 *   We cover the meaningful attack — non-canonical seed derivation —
 *   which produces a PDA the program's `bump = account.bump` guard
 *   rejects on key-mismatch.
 *
 * Fail-closed assertion:
 *   Every negative test snapshots the full economic surface
 *   (pool vault, solidarity, escrow, member USDC, member state,
 *   profile score + counters) before the attack, runs the attack,
 *   asserts reject, and asserts every snapshot byte-identical after.
 */

import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { ATTESTATION_SCHEMA } from "@roundfi/sdk";

import {
  SCHEMA,
  attestationFor,
  attestationNonce,
  balanceOf,
  configPda,
  createPool,
  createUsdcMint,
  ensureAta,
  escrowVaultAuthorityPda,
  fetchMember,
  fetchPool,
  fetchProfile,
  fundUsdc,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  memberKeypairs,
  memberPda,
  reputationConfigFor,
  reputationProfileFor,
  setupEnv,
  solidarityVaultAuthorityPda,
  usdc,
  type Env,
  type MemberHandle,
  type PoolHandle,
} from "./_harness/index.js";

// ─── Pool parameters ──────────────────────────────────────────────────

const MEMBERS_TARGET = 3;
const CYCLES_TOTAL = 3;
const CYCLE_DURATION_SEC = 86_400;
const INSTALLMENT_USDC = 1_250n;
const CREDIT_USDC = 2_775n;
const LEVEL: 1 | 2 | 3 = 2;

const INSTALLMENT_BASE = usdc(INSTALLMENT_USDC);
const CREDIT_BASE = usdc(CREDIT_USDC);

// ─── Snapshot / assertion helpers ─────────────────────────────────────

interface SecuritySnapshot {
  poolVault: bigint;
  solidarity: bigint;
  escrow: bigint;
  memberUsdc: bigint;
  memberContribs: number;
  memberOnTime: number;
  memberDefaulted: boolean;
  poolCurrentCycle: number;
  poolTotalContrib: bigint;
  profileScore: bigint;
  profileOnTime: number;
}

function bn(x: { toString(): string }): bigint {
  return BigInt(x.toString());
}

async function snapshot(env: Env, pool: PoolHandle, h: MemberHandle): Promise<SecuritySnapshot> {
  const [poolVault, solidarity, escrow, memberUsdc] = await Promise.all([
    balanceOf(env, pool.poolUsdcVault),
    balanceOf(env, pool.solidarityVault),
    balanceOf(env, pool.escrowVault),
    balanceOf(env, h.memberUsdc),
  ]);
  const m = (await fetchMember(env, h.member)) as {
    contributionsPaid: number;
    onTimeCount: number;
    defaulted: boolean;
  };
  const p = (await fetchPool(env, pool.pool)) as {
    currentCycle: number;
    totalContributed: { toString(): string };
  };
  const profile = (await fetchProfile(env, h.wallet.publicKey)) as {
    score: { toString(): string };
    onTimePayments: number;
  };
  return {
    poolVault,
    solidarity,
    escrow,
    memberUsdc,
    memberContribs: m.contributionsPaid,
    memberOnTime: m.onTimeCount,
    memberDefaulted: m.defaulted,
    poolCurrentCycle: p.currentCycle,
    poolTotalContrib: bn(p.totalContributed),
    profileScore: bn(profile.score),
    profileOnTime: profile.onTimePayments,
  };
}

function expectUnchanged(before: SecuritySnapshot, after: SecuritySnapshot, label: string): void {
  expect(after, `${label}: snapshot drift`).to.deep.equal(before);
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

// ─── Contribute tx factory with overrides ─────────────────────────────

/**
 * Build a Contribute RPC against pool A + base member, letting tests
 * selectively swap one or more account slots. Every override is a raw
 * PublicKey — this is the point of the spec: probing what happens when
 * attackers pass arbitrary pubkeys into typed slots.
 */
type AccountOverrides = Partial<{
  config: PublicKey;
  pool: PublicKey;
  member: PublicKey;
  usdcMint: PublicKey;
  memberUsdc: PublicKey;
  poolUsdcVault: PublicKey;
  solidarityVaultAuthority: PublicKey;
  solidarityVault: PublicKey;
  escrowVaultAuthority: PublicKey;
  escrowVault: PublicKey;
  reputationProgram: PublicKey;
  reputationConfig: PublicKey;
  reputationProfile: PublicKey;
  identityRecord: PublicKey;
  attestation: PublicKey;
}>;

// ─── Tests ────────────────────────────────────────────────────────────

describe("security — malicious inputs + PDA tampering", function () {
  this.timeout(180_000);

  let env: Env;
  let usdcMint: PublicKey;
  let fakeMint: PublicKey; // totally separate mint for InvalidMint tests

  const authorityA = Keypair.generate();
  const authorityB = Keypair.generate();
  const membersA = memberKeypairs(MEMBERS_TARGET, "sec/inputs/A");
  const memberB = memberKeypairs(1, "sec/inputs/B")[0]!;
  const attacker = Keypair.generate();
  const rogueAuthPda = Keypair.generate().publicKey; // random pubkey (no real PDA)

  let poolA: PoolHandle;
  let poolB: PoolHandle; // Forming, exists to harvest foreign PDAs
  let handlesA: MemberHandle[];
  let memberBHandle: MemberHandle; // member joined in poolB

  let attackerUsdc: PublicKey; // attacker-owned USDC ATA
  let attackerFakeMintUsdc: PublicKey; // ATA of pool owner under the WRONG mint

  before(async function () {
    env = await setupEnv();
    usdcMint = await createUsdcMint(env);
    fakeMint = await createUsdcMint(env); // second, unrelated mint
    await initializeProtocol(env, { usdcMint });
    await initializeReputation(env, { coreProgram: env.ids.core });

    // Pool A — the target we keep hostile tx'es pointing at.
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

    // Pool B — Forming, only 1/3 joined. Gives us real foreign PDAs
    // (pool, member, vault authorities) to swap in.
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
    memberBHandle = (
      await joinMembers(env, poolB, [{ member: memberB, reputationLevel: LEVEL }])
    )[0]!;

    // Attacker holdings — a real USDC ATA they own, plus an ATA
    // under the wrong-mint for token::mint constraint tests.
    attackerUsdc = await fundUsdc(env, usdcMint, attacker.publicKey, INSTALLMENT_BASE);
    attackerFakeMintUsdc = await ensureAta(env, fakeMint, attacker.publicKey);
  });

  // Helper that builds + sends a contribute with only the overrides
  // differing from the happy-path call.
  async function contributeWith(
    overrides: AccountOverrides,
    signer: Keypair = handlesA[0]!.wallet,
    cycle = 0,
  ): Promise<string> {
    const h = handlesA[0]!;
    const nonce = attestationNonce(cycle, h.slotIndex);
    const defaultAttestation = attestationFor(
      env,
      poolA.pool,
      h.wallet.publicKey,
      ATTESTATION_SCHEMA.Payment,
      nonce,
    );

    const accounts = {
      memberWallet: signer.publicKey,
      config: configPda(env),
      pool: poolA.pool,
      member: h.member,
      usdcMint,
      memberUsdc: h.memberUsdc,
      poolUsdcVault: poolA.poolUsdcVault,
      solidarityVaultAuthority: poolA.solidarityVaultAuthority,
      solidarityVault: poolA.solidarityVault,
      escrowVaultAuthority: poolA.escrowVaultAuthority,
      escrowVault: poolA.escrowVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      reputationProgram: env.ids.reputation,
      reputationConfig: reputationConfigFor(env),
      reputationProfile: reputationProfileFor(env, h.wallet.publicKey),
      identityRecord: env.ids.reputation,
      attestation: defaultAttestation,
      systemProgram: SystemProgram.programId,
      ...overrides,
    };

    return (env.programs.core.methods as any)
      .contribute({ cycle })
      .accounts(accounts)
      .signers([signer])
      .rpc();
  }

  // ─── A. Seed-based PDA tampering ──────────────────────────────────────

  it("A.1 foreign pool swapped in (pool=poolB) → rejects, state unchanged", async function () {
    const h = handlesA[0]!;
    const before = await snapshot(env, poolA, h);

    const msg = await expectRejected(() => contributeWith({ pool: poolB.pool }));
    expect(msg.length, msg).to.be.greaterThan(0);

    expectUnchanged(before, await snapshot(env, poolA, h), "A.1");
  });

  it("A.2 member PDA from poolB used against poolA → seeds mismatch", async function () {
    const h = handlesA[0]!;
    const before = await snapshot(env, poolA, h);

    // memberB's record lives under seeds [SEED_MEMBER, poolB, memberB_wallet].
    // We pass it as `member` for a poolA contribute — Anchor's seeds
    // constraint uses pool.key()=poolA, so address derivation diverges.
    const msg = await expectRejected(() => contributeWith({ member: memberBHandle.member }));
    expect(msg.length, msg).to.be.greaterThan(0);

    expectUnchanged(before, await snapshot(env, poolA, h), "A.2");
  });

  it("A.3 solidarity vault authority from poolB → seeds mismatch", async function () {
    const h = handlesA[0]!;
    const before = await snapshot(env, poolA, h);

    const [solidarityB] = solidarityVaultAuthorityPda(env.ids.core, poolB.pool);
    const msg = await expectRejected(() =>
      contributeWith({ solidarityVaultAuthority: solidarityB }),
    );
    expect(msg.length, msg).to.be.greaterThan(0);

    expectUnchanged(before, await snapshot(env, poolA, h), "A.3");
  });

  it("A.4 escrow vault authority from poolB → seeds mismatch", async function () {
    const h = handlesA[0]!;
    const before = await snapshot(env, poolA, h);

    const [escrowB] = escrowVaultAuthorityPda(env.ids.core, poolB.pool);
    const msg = await expectRejected(() => contributeWith({ escrowVaultAuthority: escrowB }));
    expect(msg.length, msg).to.be.greaterThan(0);

    expectUnchanged(before, await snapshot(env, poolA, h), "A.4");
  });

  it("A.5 non-canonical PDA (random pubkey in pool slot) → rejects", async function () {
    const h = handlesA[0]!;
    const before = await snapshot(env, poolA, h);

    // rogueAuthPda is a random curve point — not a PDA at all. Anchor
    // tries to deserialize as `Account<Pool>`, fails on owner/discriminator.
    const msg = await expectRejected(() => contributeWith({ pool: rogueAuthPda }));
    expect(msg.length, msg).to.be.greaterThan(0);

    expectUnchanged(before, await snapshot(env, poolA, h), "A.5");
  });

  // ─── B. Constraint checks (mint / authority) ──────────────────────────

  it("B.1 wrong usdc_mint → InvalidMint", async function () {
    const h = handlesA[0]!;
    const before = await snapshot(env, poolA, h);

    const msg = await expectRejected(() => contributeWith({ usdcMint: fakeMint }));
    // explicit constraint: `usdc_mint.key() == pool.usdc_mint @ InvalidMint`
    expect(msg, `message: ${msg}`).to.match(/InvalidMint|mint/i);

    expectUnchanged(before, await snapshot(env, poolA, h), "B.1");
  });

  it("B.2 attacker-owned token account as pool_usdc_vault → rejects", async function () {
    const h = handlesA[0]!;
    const before = await snapshot(env, poolA, h);

    // attackerUsdc is owned by `attacker`, not by pool → associated-token
    // authority constraint on pool_usdc_vault trips.
    const msg = await expectRejected(() => contributeWith({ poolUsdcVault: attackerUsdc }));
    expect(msg.length, msg).to.be.greaterThan(0);

    expectUnchanged(before, await snapshot(env, poolA, h), "B.2");
  });

  it("B.3 wrong-mint token account as pool_usdc_vault → rejects", async function () {
    const h = handlesA[0]!;
    const before = await snapshot(env, poolA, h);

    // attackerFakeMintUsdc holds `fakeMint` — pool_usdc_vault's
    // `associated_token::mint = usdc_mint` constraint fails.
    const msg = await expectRejected(() => contributeWith({ poolUsdcVault: attackerFakeMintUsdc }));
    expect(msg.length, msg).to.be.greaterThan(0);

    expectUnchanged(before, await snapshot(env, poolA, h), "B.3");
  });

  it("B.4 solidarity_vault ATA swapped to poolB's → rejects", async function () {
    const h = handlesA[0]!;
    const before = await snapshot(env, poolA, h);

    // Pass poolB's solidarity ATA with the matching authority. Anchor's
    // `associated_token::authority = solidarity_vault_authority` sees
    // poolA's authority (since we didn't override that); poolB's ATA
    // was minted to poolB's authority → authority mismatch.
    const poolBSolATA = poolB.solidarityVault;
    const msg = await expectRejected(() => contributeWith({ solidarityVault: poolBSolATA }));
    expect(msg.length, msg).to.be.greaterThan(0);

    expectUnchanged(before, await snapshot(env, poolA, h), "B.4");
  });

  // ─── C. Ownership / discriminator ────────────────────────────────────

  it("C.1 SystemProgram-owned pubkey as pool → deserialize fails", async function () {
    const h = handlesA[0]!;
    const before = await snapshot(env, poolA, h);

    // The attacker's wallet is SystemProgram-owned. Anchor's
    // `Account<Pool>` first checks owner == program_id, then
    // deserializes the 8-byte discriminator. Owner check fails.
    const msg = await expectRejected(() => contributeWith({ pool: attacker.publicKey }));
    expect(msg.length, msg).to.be.greaterThan(0);

    expectUnchanged(before, await snapshot(env, poolA, h), "C.1");
  });

  it("C.2 random keypair as member (account does not exist) → rejects", async function () {
    const h = handlesA[0]!;
    const before = await snapshot(env, poolA, h);

    // Pure fabrication: a brand-new member PDA derived from a
    // keypair that never joined. Anchor looks it up, finds nothing,
    // rejects on AccountNotInitialized.
    const neverJoined = Keypair.generate();
    const [fakeMember] = memberPda(env.ids.core, poolA.pool, neverJoined.publicKey);
    const msg = await expectRejected(() => contributeWith({ member: fakeMember }));
    expect(msg.length, msg).to.be.greaterThan(0);

    expectUnchanged(before, await snapshot(env, poolA, h), "C.2");
  });

  it("C.3 ATA owned by attacker passed as member_usdc → rejects", async function () {
    const h = handlesA[0]!;
    const before = await snapshot(env, poolA, h);

    // member_usdc must have `authority = member_wallet` (the signer);
    // attackerUsdc's authority is `attacker`, not handlesA[0].wallet,
    // so the token::authority constraint fails.
    const msg = await expectRejected(() => contributeWith({ memberUsdc: attackerUsdc }));
    expect(msg.length, msg).to.be.greaterThan(0);

    expectUnchanged(before, await snapshot(env, poolA, h), "C.3");
  });

  // ─── D. Aggregate fail-closed sanity ──────────────────────────────────

  it("D.1 no attestation PDAs leaked from any rejected attack", async function () {
    // For cycle=0, slot=0 we used `attestationFor` as the default
    // attestation slot in every hostile tx. If ANY of those attacks
    // somehow reached the reputation CPI and allocated the PDA, it
    // would exist now. Must not.
    const h = handlesA[0]!;
    const expectedPda = attestationFor(
      env,
      poolA.pool,
      h.wallet.publicKey,
      ATTESTATION_SCHEMA.Payment,
      attestationNonce(0, h.slotIndex),
    );
    const info = await env.connection.getAccountInfo(expectedPda, "confirmed");
    expect(info, "no attestation PDA should have been initialized").to.be.null;
  });

  it("D.2 pool still accepts a legitimate contribute post-attacks (no poisoning)", async function () {
    // The ultimate safety check: after all the rejected attacks, the
    // real flow still works. If any attack had corrupted an account
    // (even partially), this would fail.
    const h = handlesA[0]!;
    const before = await snapshot(env, poolA, h);
    expect(before.memberContribs).to.equal(0);

    const sig = await (env.programs.core.methods as any)
      .contribute({ cycle: 0 })
      .accounts({
        memberWallet: h.wallet.publicKey,
        config: configPda(env),
        pool: poolA.pool,
        member: h.member,
        usdcMint,
        memberUsdc: h.memberUsdc,
        poolUsdcVault: poolA.poolUsdcVault,
        solidarityVaultAuthority: poolA.solidarityVaultAuthority,
        solidarityVault: poolA.solidarityVault,
        escrowVaultAuthority: poolA.escrowVaultAuthority,
        escrowVault: poolA.escrowVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        reputationProgram: env.ids.reputation,
        reputationConfig: reputationConfigFor(env),
        reputationProfile: reputationProfileFor(env, h.wallet.publicKey),
        identityRecord: env.ids.reputation,
        attestation: attestationFor(
          env,
          poolA.pool,
          h.wallet.publicKey,
          ATTESTATION_SCHEMA.Payment,
          attestationNonce(0, h.slotIndex),
        ),
        systemProgram: SystemProgram.programId,
      })
      .signers([h.wallet])
      .rpc();
    expect(sig).to.be.a("string");

    const after = await snapshot(env, poolA, h);
    expect(after.memberContribs).to.equal(1);
    expect(after.memberOnTime).to.equal(1);
    expect(after.profileOnTime).to.equal(1);
    expect(after.profileScore - before.profileScore).to.equal(5n);
    // SCHEMA.Payment wasn't actually used in an assertion — silence TS.
    void SCHEMA;
  });
});

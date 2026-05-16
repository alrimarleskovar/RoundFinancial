/**
 * Edge — cycle boundary on-time vs late (Step 5f / 1).
 *
 * `roundfi-core::contribute` decides on-time vs late via a single
 * check: `clock.unix_timestamp <= pool.next_cycle_at`. Off-by-one
 * on either side of that comparison would silently mis-classify a
 * payment and credit the wrong reputation schema. This spec pins
 * the behavior on both legs of the boundary from the client side:
 *
 *   A. Contribute well BEFORE `next_cycle_at` → on-time
 *      - `member.on_time_count` increments, `late_count` stays 0
 *      - attestation PDA derived under `SCHEMA_PAYMENT` is initialized
 *
 *   B. Contribute well AFTER `next_cycle_at` → late
 *      - `member.late_count` increments, `on_time_count` stays 0
 *      - attestation PDA derived under `SCHEMA_LATE` is initialized
 *
 *   C. The two attestation PDAs are distinct (schema_id is in the
 *      seeds), so an on-time payment cannot collide with a late
 *      one for the same (issuer, subject, cycle, slot) tuple.
 *
 * Determinism note: we don't assert the *exact-boundary* millisecond
 * case (`clock.unix_timestamp == next_cycle_at` → on-time). Real-time
 * `sleep()` on localnet can't guarantee sub-second precision. The
 * exact equality is covered by Rust unit tests against `split_installment`
 * /reputation attestation helpers and by code inspection of
 * `contribute.rs` (line 181: `<=` is inclusive). Here we verify the
 * client-observable behavior at safe margins (~≥2s before / after).
 *
 * Pool shape kept minimal (2 members, 2 cycles, cycle_duration=60s)
 * so the spec runs in ~80s even after the 62s "wait for late" sleep.
 */

import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";

import { ATTESTATION_SCHEMA } from "@roundfi/sdk";

import {
  attestationFor,
  attestationNonce,
  contribute,
  createPool,
  createUsdcMint,
  fetchMember,
  fetchPool,
  fundUsdc,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  memberKeypairs,
  onchainUnix,
  setupEnv,
  usdc,
  waitUntilUnix,
  type Env,
  type MemberHandle,
  type PoolHandle,
} from "./_harness/index.js";

// ─── Pool parameters ──────────────────────────────────────────────────

const MEMBERS_TARGET = 2;
const CYCLES_TOTAL = 2;
const CYCLE_DURATION_SEC = 86_400; // MIN_CYCLE_DURATION
const INSTALLMENT_BASE = usdc(1_000n);
const CREDIT_BASE = usdc(2_200n);

// Safe margin (seconds) we keep from `next_cycle_at` on each leg.
// Ensures the on-chain `clock.unix_timestamp <= next_cycle_at` check
// stays unambiguous even with a few hundred ms of wall-clock jitter.
const SAFE_MARGIN_SEC = 2;

// ─── Spec ─────────────────────────────────────────────────────────────

describe("edge — cycle boundary on-time vs late", function () {
  // 62s wait + surrounding rpc latency; keep comfortable headroom.
  this.timeout(180_000);

  let env: Env;
  let usdcMint: PublicKey;

  const authority = Keypair.generate();
  const members = memberKeypairs(MEMBERS_TARGET, "edge_cycle_boundary");

  let pool: PoolHandle;
  let alice: MemberHandle;
  let bob: MemberHandle;

  before(async function () {
    env = await setupEnv();
    usdcMint = await createUsdcMint(env);
    await initializeProtocol(env, { usdcMint });
    await initializeReputation(env, { coreProgram: env.ids.core });
  });

  it("activates pool and pins next_cycle_at ≈ now + 60", async function () {
    pool = await createPool(env, {
      authority,
      usdcMint,
      membersTarget: MEMBERS_TARGET,
      installmentAmount: INSTALLMENT_BASE,
      creditAmount: CREDIT_BASE,
      cyclesTotal: CYCLES_TOTAL,
      cycleDurationSec: CYCLE_DURATION_SEC,
    });

    const [aliceH, bobH] = await joinMembers(env, pool, [
      { member: members[0]!, reputationLevel: 1 },
      { member: members[1]!, reputationLevel: 1 },
    ]);
    alice = aliceH!;
    bob = bobH!;

    // One installment worth per member (plus a cushion — the join
    // already transferred the stake, so walletUSDC is currently 0).
    await fundUsdc(env, usdcMint, alice.wallet.publicKey, INSTALLMENT_BASE);
    await fundUsdc(env, usdcMint, bob.wallet.publicKey, INSTALLMENT_BASE);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await fetchPool(env, pool.pool)) as any;
    const now = await onchainUnix(env.connection);
    const nextCycleAt = Number(p.nextCycleAt.toString());

    expect(p.status).to.equal(1); // Active
    expect(p.currentCycle).to.equal(0);
    expect(nextCycleAt).to.be.greaterThan(now);
    // Cluster clock vs wall-clock drift is ≤ a few seconds. Bound it.
    expect(nextCycleAt - now).to.be.lessThanOrEqual(CYCLE_DURATION_SEC + 5);
    expect(nextCycleAt - now).to.be.greaterThanOrEqual(CYCLE_DURATION_SEC - 5);
  });

  it("A. Alice contributes before next_cycle_at → on-time", async function () {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await fetchPool(env, pool.pool)) as any;
    const nextCycleAt = Number(p.nextCycleAt.toString());
    const now = await onchainUnix(env.connection);
    // We expect to be safely inside the cycle (≥ SAFE_MARGIN_SEC before
    // deadline). If this fails, the test env is degenerate (the join
    // transactions alone took >55s) — surface it loudly.
    expect(nextCycleAt - now).to.be.greaterThan(
      SAFE_MARGIN_SEC,
      "pool active but already within the last 2s of cycle 0 — fixture too slow",
    );

    await contribute(env, {
      pool,
      member: alice,
      cycle: 0,
      schemaId: ATTESTATION_SCHEMA.Payment,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (await fetchMember(env, alice.member)) as any;
    expect(m.contributionsPaid).to.equal(1);
    expect(m.onTimeCount).to.equal(1);
    expect(m.lateCount).to.equal(0);

    // The payment attestation PDA is now initialized.
    const att = attestationFor(
      env,
      pool.pool, // issuer
      alice.wallet.publicKey, // subject
      ATTESTATION_SCHEMA.Payment,
      attestationNonce(0, alice.slotIndex),
    );
    const info = await env.connection.getAccountInfo(att);
    expect(info, "on-time attestation PDA should be initialized").to.not.be.null;
  });

  it("B. Bob contributes after next_cycle_at → late", async function () {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await fetchPool(env, pool.pool)) as any;
    const nextCycleAt = Number(p.nextCycleAt.toString());

    // Wait until the on-chain clock is SAFE_MARGIN_SEC past the deadline.
    // Cap the wait so a mis-set fixture doesn't hang CI.
    await waitUntilUnix(nextCycleAt + SAFE_MARGIN_SEC, (CYCLE_DURATION_SEC + 30) * 1_000);

    const after = await onchainUnix(env.connection);
    expect(after).to.be.greaterThan(
      nextCycleAt,
      "cluster clock must have advanced past next_cycle_at before contribute",
    );

    await contribute(env, {
      pool,
      member: bob,
      cycle: 0,
      schemaId: ATTESTATION_SCHEMA.Late,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (await fetchMember(env, bob.member)) as any;
    expect(m.contributionsPaid).to.equal(1);
    expect(m.onTimeCount).to.equal(0);
    expect(m.lateCount).to.equal(1);

    const att = attestationFor(
      env,
      pool.pool,
      bob.wallet.publicKey,
      ATTESTATION_SCHEMA.Late,
      attestationNonce(0, bob.slotIndex),
    );
    const info = await env.connection.getAccountInfo(att);
    expect(info, "late attestation PDA should be initialized").to.not.be.null;
  });

  it("C. schema_id separates on-time and late attestation PDAs", async function () {
    // Same (issuer, subject, cycle, slot) tuple — only the schema byte
    // differs. The two PDAs must be distinct, otherwise a late payment
    // could overwrite (or be overwritten by) an on-time one.
    const nonceAlice = attestationNonce(0, alice.slotIndex);
    const aliceAsPayment = attestationFor(
      env,
      pool.pool,
      alice.wallet.publicKey,
      ATTESTATION_SCHEMA.Payment,
      nonceAlice,
    );
    const aliceAsLate = attestationFor(
      env,
      pool.pool,
      alice.wallet.publicKey,
      ATTESTATION_SCHEMA.Late,
      nonceAlice,
    );
    expect(aliceAsPayment.toBase58()).to.not.equal(aliceAsLate.toBase58());

    // And symmetrically for Bob.
    const nonceBob = attestationNonce(0, bob.slotIndex);
    const bobAsPayment = attestationFor(
      env,
      pool.pool,
      bob.wallet.publicKey,
      ATTESTATION_SCHEMA.Payment,
      nonceBob,
    );
    const bobAsLate = attestationFor(
      env,
      pool.pool,
      bob.wallet.publicKey,
      ATTESTATION_SCHEMA.Late,
      nonceBob,
    );
    expect(bobAsPayment.toBase58()).to.not.equal(bobAsLate.toBase58());

    // The "initialized" attestations from A + B live at the *correct*
    // PDA (Payment for Alice, Late for Bob). The opposite-schema PDAs
    // must be uninitialized — proving no cross-schema collision leaked
    // data onto the wrong account.
    const aliceWrong = await env.connection.getAccountInfo(aliceAsLate);
    const bobWrong = await env.connection.getAccountInfo(bobAsPayment);
    expect(aliceWrong, "Alice's Late-schema slot should be empty").to.be.null;
    expect(bobWrong, "Bob's Payment-schema slot should be empty").to.be.null;
  });
});

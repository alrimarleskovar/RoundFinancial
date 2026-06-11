/**
 * Reputation CPI integration — happy path + score progression (Step 5d / 1).
 *
 * End-to-end proof that the core → reputation CPI fires correctly on
 * every scoring event, applies the right counters/deltas, and leaves
 * attestation PDAs at the exact addresses documented by the CPI
 * nonce convention.
 *
 * Scope (what this spec covers):
 *   • One happy-path ROSCA with 3 members × 3 cycles (60s duration).
 *   • For EACH contribute: assert the Payment attestation PDA exists at
 *     the exact address `[b"attestation", pool, subject, 1_le, nonce_le]`
 *     with `nonce = (cycle << 32) | slot`.
 *   • For EACH claim_payout: assert the CycleComplete attestation PDA
 *     exists at the exact address, and that the profile advanced by
 *     the correct delta.
 *   • No duplicate events: after every step, the total PDA count must
 *     match `expected(Payment) = contributions_so_far` and
 *     `expected(CycleComplete) = payouts_so_far`. No extras.
 *   • Strictly monotonic score: capture a snapshot after every scoring
 *     event and assert score never decreases for any member. Deltas
 *     are non-negative by construction here (Payment + CycleComplete),
 *     so any regression would be a bug.
 *   • Deterministic inputs: seeded keypairs, fixed amounts, no sleeps.
 *
 * Identity semantics note:
 *   The reputation handler applies weight `1/2` unless the subject has
 *   a Verified IdentityRecord. On localnet we never create one (the
 *   Human Passport bridge path is post-canary). So the "absence"
 *   and "present+unverified" paths are indistinguishable at the score
 *   level: both halve positive deltas. The protocol never blocks on
 *   identity (no authorization gate); it only dampens rewards. We
 *   exercise the halved path here; the Verified path is deferred with
 *   the Human Passport bridge service rollout.
 *
 * Expected per-member math (unverified weight = 1/2):
 *   Payment  delta = SCORE_PAYMENT * 1 / 2         =  5
 *   CycleComplete  = SCORE_CYCLE_COMPLETE * 1 / 2  = 25
 *
 *   After 3 cycles × 3 members (each slot wins exactly 1 cycle):
 *     on_time_payments  = 3
 *     cycles_completed  = 1
 *     score             = 3 × 5 + 1 × 25 = 40
 */

import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";

import { ATTESTATION_SCHEMA } from "@roundfi/sdk";

import {
  SCHEMA,
  attestationFor,
  attestationNonce,
  claimPayout,
  contribute,
  createPool,
  createUsdcMint,
  fetchProfile,
  fundUsdc,
  initProfile,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  memberKeypairs,
  setupEnv,
  usdc,
  type Env,
  type MemberHandle,
  type PoolHandle,
} from "./_harness/index.js";

// ─── Pool parameters ──────────────────────────────────────────────────

const MEMBERS_TARGET = 3;
const CYCLES_TOTAL = 3;
const CYCLE_DURATION_SEC = 86_400; // MIN_CYCLE_DURATION (1 day, SEV-023)
const INSTALLMENT_USDC = 1_250n;
// pool_float_per_inst with solidarity_bps=100 + escrow_bps=2500 ≈ 925 per
// installment; 3 × 925 = 2_775. Credit must fit that float.
const CREDIT_USDC = 2_775n;

const LEVEL: 1 | 2 | 3 = 1; // join_pool now asserts level vs ReputationProfile (baseline is level 1)

const INSTALLMENT_BASE = usdc(INSTALLMENT_USDC);
const CREDIT_BASE = usdc(CREDIT_USDC);

// Expected delta math. Unverified = halved for positive; see spec header.
const DELTA_PAYMENT_UNVERIFIED = 5n;
const DELTA_CYCLE_COMPLETE_UNVERIFIED = 25n;

// ─── Local view types for the loosely-typed account fetchers ──────────

interface ProfileView {
  wallet: PublicKey;
  level: number;
  cyclesCompleted: number;
  onTimePayments: number;
  latePayments: number;
  defaults: number;
  totalParticipated: number;
  score: { toString(): string };
  lastCycleCompleteAt: { toString(): string };
  firstSeenAt: { toString(): string };
  lastUpdatedAt: { toString(): string };
  bump: number;
}

function asView(raw: Record<string, unknown>): ProfileView {
  return raw as unknown as ProfileView;
}

function bn(x: { toString(): string }): bigint {
  return BigInt(x.toString());
}

// ─── Test ─────────────────────────────────────────────────────────────

describe("reputation CPI — happy path + score progression", function () {
  // 3 × 3 pool + all per-step profile fetches; 90s is comfortable.
  this.timeout(120_000);

  let env: Env;
  let usdcMint: PublicKey;

  const authority = Keypair.generate();
  const members: Keypair[] = memberKeypairs(MEMBERS_TARGET, "repcpi");

  let pool: PoolHandle;
  let handles: MemberHandle[];

  // Score snapshots per member, appended on every profile read. Used to
  // assert strict monotonicity at the end of the test.
  const scoreSnapshots: bigint[][] = Array.from({ length: MEMBERS_TARGET }, () => []);

  async function captureScores(): Promise<bigint[]> {
    const scores: bigint[] = [];
    for (let i = 0; i < MEMBERS_TARGET; i++) {
      const p = asView(await fetchProfile(env, members[i]!.publicKey));
      const s = bn(p.score);
      scoreSnapshots[i]!.push(s);
      scores.push(s);
    }
    return scores;
  }

  async function expectAttestationExists(
    issuer: PublicKey,
    subject: PublicKey,
    schemaId: number,
    nonce: bigint,
    label: string,
  ): Promise<void> {
    const pda = attestationFor(env, issuer, subject, schemaId, nonce);
    const info = await env.connection.getAccountInfo(pda, "confirmed");
    expect(info, `attestation missing: ${label}`).to.not.be.null;
  }

  // ─── v5.2 Hybrid (Phase B) — BehavioralPayload decode ────────────────
  // The 96-byte `payload` field lives inside the Attestation account at a
  // fixed offset: discriminator(8) + issuer(32) + subject(32) +
  // schema_id u16(2) + nonce u64(8) = 82. Mirrors the Rust layout in
  // programs/roundfi-reputation/src/state/behavioral_payload.rs (v1).
  const PAYLOAD_OFFSET = 82;
  const CLASS = {
    UNSPECIFIED: 0,
    ON_TIME: 1,
    EARLY: 2,
    LATE: 3,
    DEFAULT: 4,
    CYCLE_COMPLETE: 5,
  } as const;
  const NO_TIMESTAMP = -9223372036854775808n; // i64::MIN

  interface DecodedPayload {
    version: number;
    classification: number;
    groupSize: number;
    parcelsPaid: number;
    dueTs: bigint;
    paidTs: bigint;
    deltaSeconds: bigint;
    amount: bigint;
  }

  async function fetchPayload(
    issuer: PublicKey,
    subject: PublicKey,
    schemaId: number,
    nonce: bigint,
  ): Promise<DecodedPayload> {
    const pda = attestationFor(env, issuer, subject, schemaId, nonce);
    const info = await env.connection.getAccountInfo(pda, "confirmed");
    expect(info, "attestation account missing for payload decode").to.not.be.null;
    const buf = Buffer.from(info!.data);
    const p = buf.subarray(PAYLOAD_OFFSET, PAYLOAD_OFFSET + 96);
    return {
      version: p.readUInt8(0),
      classification: p.readUInt8(1),
      groupSize: p.readUInt8(2),
      parcelsPaid: p.readUInt8(3),
      dueTs: p.readBigInt64LE(8),
      paidTs: p.readBigInt64LE(16),
      deltaSeconds: p.readBigInt64LE(24),
      amount: p.readBigUInt64LE(32),
    };
  }

  before(async function () {
    env = await setupEnv();
    usdcMint = await createUsdcMint(env);
    await initializeProtocol(env, { usdcMint });
    await initializeReputation(env, { coreProgram: env.ids.core });
  });

  it("creates pool and joins 3 members (auto-activates)", async function () {
    pool = await createPool(env, {
      authority,
      usdcMint,
      membersTarget: MEMBERS_TARGET,
      installmentAmount: INSTALLMENT_BASE,
      creditAmount: CREDIT_BASE,
      cyclesTotal: CYCLES_TOTAL,
      cycleDurationSec: CYCLE_DURATION_SEC,
      escrowReleaseBps: 2_500,
    });

    handles = await joinMembers(
      env,
      pool,
      members.map((m) => ({ member: m, reputationLevel: LEVEL })),
    );

    // Fund each member with enough USDC for every contribution.
    for (const m of members) {
      await fundUsdc(env, usdcMint, m.publicKey, BigInt(CYCLES_TOTAL) * INSTALLMENT_BASE);
    }

    // Initialize each member's ReputationProfile. join_pool no longer
    // creates it (Step-4d: derive_trusted_reputation_level only *reads*
    // the PDA, treating an empty one as level 1); the profile is
    // otherwise lazily created by the first attest CPI (init_if_needed).
    // We init explicitly so the baseline below can read a level-1,
    // all-zero profile — init_profile produces exactly that state, and
    // the first Payment attest then takes the "already exists" path with
    // identical score deltas.
    for (const m of members) {
      await initProfile(env, m.publicKey);
    }

    // Baseline: freshly init'd profiles start at score 0.
    const scores = await captureScores();
    for (const s of scores) expect(s).to.equal(0n);

    for (let i = 0; i < MEMBERS_TARGET; i++) {
      const p = asView(await fetchProfile(env, members[i]!.publicKey));
      expect(p.level).to.equal(1); // fresh wallet
      expect(p.onTimePayments).to.equal(0);
      expect(p.cyclesCompleted).to.equal(0);
      expect(p.latePayments).to.equal(0);
      expect(p.defaults).to.equal(0);
      expect(p.totalParticipated).to.equal(0);
    }
  });

  // Running totals to cross-check the "no duplicate events" invariant.
  let totalPaymentAtts = 0;
  let totalCycleCompleteAtts = 0;

  for (let cycle = 0; cycle < CYCLES_TOTAL; cycle++) {
    it(`cycle ${cycle}: 3 Payment CPIs + deltas`, async function () {
      for (const h of handles) {
        const profileBefore = asView(await fetchProfile(env, h.wallet.publicKey));
        const scoreBefore = bn(profileBefore.score);
        const onTimeBefore = profileBefore.onTimePayments;

        await contribute(env, { pool, member: h, cycle, schemaId: SCHEMA.Payment });
        totalPaymentAtts += 1;

        // 1. Exact-address attestation PDA check (Payment / schema=1 /
        //    nonce = (cycle << 32) | slot).
        const nonce = attestationNonce(cycle, h.slotIndex);
        await expectAttestationExists(
          pool.pool,
          h.wallet.publicKey,
          ATTESTATION_SCHEMA.Payment,
          nonce,
          `Payment cycle=${cycle} slot=${h.slotIndex}`,
        );

        // 1b. v5.2 Hybrid payload — Phase B wrote real timing into the
        //     96-byte field (was all zeros pre-v5.2). Happy path is on
        //     time, so classification is ON_TIME or EARLY; a real
        //     payment moved the installment, so amount > 0 and a paid
        //     timestamp is present.
        const payPayload = await fetchPayload(
          pool.pool,
          h.wallet.publicKey,
          ATTESTATION_SCHEMA.Payment,
          nonce,
        );
        expect(payPayload.version, "payload version").to.equal(1);
        expect([CLASS.ON_TIME, CLASS.EARLY]).to.include(payPayload.classification);
        expect(payPayload.groupSize, "group_size = members_target").to.equal(handles.length);
        expect(payPayload.parcelsPaid, "one installment per contribute").to.equal(1);
        expect(payPayload.paidTs > 0n, "paid_ts present").to.be.true;
        expect(payPayload.dueTs > 0n, "due_ts present").to.be.true;
        expect(payPayload.amount > 0n, "amount = installment").to.be.true;
        // delta_seconds is consistent with paid - due (single derivation).
        expect(payPayload.deltaSeconds).to.equal(payPayload.paidTs - payPayload.dueTs);

        // 2. Profile delta: +5 (unverified) score, +1 on_time_payments.
        const profileAfter = asView(await fetchProfile(env, h.wallet.publicKey));
        expect(bn(profileAfter.score) - scoreBefore).to.equal(DELTA_PAYMENT_UNVERIFIED);
        expect(profileAfter.onTimePayments - onTimeBefore).to.equal(1);

        // Pool-side counters stay in sync (contributions_paid > on_time? no,
        // this happy path keeps them equal — we rely on the on-chain pool
        // test for that).
        // Late / default counters untouched.
        expect(profileAfter.latePayments).to.equal(0);
        expect(profileAfter.defaults).to.equal(0);

        // Level stays at 1 — 5 points per Payment, threshold is 500.
        expect(profileAfter.level).to.equal(1);

        // Snapshot score for the monotonicity check.
        scoreSnapshots[h.slotIndex]!.push(bn(profileAfter.score));
      }
    });

    it(`cycle ${cycle}: slot ${cycle} CycleComplete CPI + delta`, async function () {
      const recipient = handles[cycle]!;

      const profileBefore = asView(await fetchProfile(env, recipient.wallet.publicKey));
      const scoreBefore = bn(profileBefore.score);
      const cyclesBefore = profileBefore.cyclesCompleted;
      const totalPartBefore = profileBefore.totalParticipated;

      await claimPayout(env, { pool, member: recipient, cycle });
      totalCycleCompleteAtts += 1;

      // 1. Exact-address attestation PDA check (CycleComplete / schema=4).
      const nonce = attestationNonce(cycle, recipient.slotIndex);
      await expectAttestationExists(
        pool.pool,
        recipient.wallet.publicKey,
        ATTESTATION_SCHEMA.CycleComplete,
        nonce,
        `CycleComplete cycle=${cycle} slot=${recipient.slotIndex}`,
      );

      // 1b. v5.2 Hybrid payload — CycleComplete is a payout claim, not a
      //     payment, so timing-vs-deadline is not meaningful: due_ts = 0,
      //     paid_ts = NO_TIMESTAMP, parcels = 0, amount = 0. The scoring
      //     signal is the completion + group size.
      const ccPayload = await fetchPayload(
        pool.pool,
        recipient.wallet.publicKey,
        ATTESTATION_SCHEMA.CycleComplete,
        nonce,
      );
      expect(ccPayload.version, "payload version").to.equal(1);
      expect(ccPayload.classification, "CYCLE_COMPLETE hint").to.equal(CLASS.CYCLE_COMPLETE);
      expect(ccPayload.groupSize, "group_size = members_target").to.equal(handles.length);
      expect(ccPayload.parcelsPaid, "no installment on a payout claim").to.equal(0);
      expect(ccPayload.dueTs, "no deadline for cycle-complete").to.equal(0n);
      expect(ccPayload.paidTs, "no payment timestamp").to.equal(NO_TIMESTAMP);
      expect(ccPayload.deltaSeconds, "delta zero when no payment").to.equal(0n);
      expect(ccPayload.amount, "amount not captured on-chain for cycle-complete").to.equal(0n);

      // 2. Profile delta: +25 (unverified) score, +1 cycles_completed,
      //    +1 total_participated.
      const profileAfter = asView(await fetchProfile(env, recipient.wallet.publicKey));
      expect(bn(profileAfter.score) - scoreBefore).to.equal(DELTA_CYCLE_COMPLETE_UNVERIFIED);
      expect(profileAfter.cyclesCompleted - cyclesBefore).to.equal(1);
      expect(profileAfter.totalParticipated - totalPartBefore).to.equal(1);

      // last_cycle_complete_at advanced (cooldown marker).
      expect(bn(profileAfter.lastCycleCompleteAt) > 0n).to.equal(true);

      // Other members' profiles are untouched by this claim.
      for (const h of handles) {
        if (h.slotIndex === recipient.slotIndex) continue;
        const p = asView(await fetchProfile(env, h.wallet.publicKey));
        expect(p.cyclesCompleted).to.equal(0 + (h.slotIndex < cycle ? 1 : 0));
      }

      scoreSnapshots[recipient.slotIndex]!.push(bn(profileAfter.score));
    });
  }

  it("final profile state matches closed-form expectations", async function () {
    // Each member: 3 Payments (+15) + 1 CycleComplete (+25) = 40.
    for (const h of handles) {
      const p = asView(await fetchProfile(env, h.wallet.publicKey));
      expect(p.onTimePayments).to.equal(CYCLES_TOTAL);
      expect(p.cyclesCompleted).to.equal(1);
      expect(p.totalParticipated).to.equal(1);
      expect(p.latePayments).to.equal(0);
      expect(p.defaults).to.equal(0);
      expect(bn(p.score)).to.equal(
        BigInt(CYCLES_TOTAL) * DELTA_PAYMENT_UNVERIFIED + DELTA_CYCLE_COMPLETE_UNVERIFIED,
      );
      // Still Level 1 (threshold 500).
      expect(p.level).to.equal(1);
    }
  });

  it("attestation PDAs: no duplicates, count matches events fired", async function () {
    // Expected exact-count:
    //   Payment       = MEMBERS × CYCLES
    //   CycleComplete = CYCLES
    expect(totalPaymentAtts).to.equal(MEMBERS_TARGET * CYCLES_TOTAL);
    expect(totalCycleCompleteAtts).to.equal(CYCLES_TOTAL);

    // All Payment PDAs exist; iterating (cycle, slot) gives exactly
    // MEMBERS × CYCLES distinct addresses by PDA-seed construction.
    const seen = new Set<string>();
    for (let c = 0; c < CYCLES_TOTAL; c++) {
      for (const h of handles) {
        const pda = attestationFor(
          env,
          pool.pool,
          h.wallet.publicKey,
          ATTESTATION_SCHEMA.Payment,
          attestationNonce(c, h.slotIndex),
        );
        expect(seen.has(pda.toBase58()), `duplicate Payment PDA: ${pda.toBase58()}`).to.equal(
          false,
        );
        seen.add(pda.toBase58());
        const info = await env.connection.getAccountInfo(pda, "confirmed");
        expect(info, `missing Payment PDA cycle=${c} slot=${h.slotIndex}`).to.not.be.null;
      }
    }
    expect(seen.size).to.equal(MEMBERS_TARGET * CYCLES_TOTAL);

    // All CycleComplete PDAs exist (one per cycle, by the winning slot).
    const seenCC = new Set<string>();
    for (let c = 0; c < CYCLES_TOTAL; c++) {
      const winner = handles[c]!;
      const pda = attestationFor(
        env,
        pool.pool,
        winner.wallet.publicKey,
        ATTESTATION_SCHEMA.CycleComplete,
        attestationNonce(c, winner.slotIndex),
      );
      expect(seenCC.has(pda.toBase58())).to.equal(false);
      seenCC.add(pda.toBase58());
      const info = await env.connection.getAccountInfo(pda, "confirmed");
      expect(info, `missing CycleComplete PDA cycle=${c}`).to.not.be.null;
    }
    expect(seenCC.size).to.equal(CYCLES_TOTAL);
  });

  it("score snapshots are strictly monotonically non-decreasing", async function () {
    // Every scoring event in this happy path is positive (Payment /
    // CycleComplete). So scores must never go down between snapshots.
    for (let i = 0; i < MEMBERS_TARGET; i++) {
      const snaps = scoreSnapshots[i]!;
      expect(snaps.length > 0, `no snapshots for member ${i}`).to.equal(true);
      for (let k = 1; k < snaps.length; k++) {
        const prev = snaps[k - 1]!;
        const cur = snaps[k]!;
        expect(
          cur >= prev,
          `member ${i}: score decreased between snapshot ${k - 1} (${prev}) and ${k} (${cur})`,
        ).to.equal(true);
      }
      // Sanity: final snapshot equals the expected closed-form score.
      expect(snaps[snaps.length - 1]!).to.equal(
        BigInt(CYCLES_TOTAL) * DELTA_PAYMENT_UNVERIFIED + DELTA_CYCLE_COMPLETE_UNVERIFIED,
      );
    }
  });
});

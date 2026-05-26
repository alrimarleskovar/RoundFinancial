/**
 * Reputation — revoke + promote_level boundaries (Step 5d / 3).
 *
 * Covers two lifecycle-adjacent surfaces on the reputation program:
 *
 *   revoke:
 *     • Score delta is reversed SYMMETRICALLY (exact restore).
 *     • Counters decrement by the right amount for each schema.
 *     • `last_cycle_complete_at` is PRESERVED on CycleComplete revoke
 *       (anti-gaming lockout is not a score component).
 *     • `attestation.revoked` flips to `true`.
 *     • Only the original issuer may revoke — random signer =
 *       InvalidIssuer, attestation unchanged.
 *     • Double-revoke = AttestationRevoked.
 *
 *   promote_level:
 *     • No-op at low score (stays at current level, returns Ok).
 *     • Monotonic up: accumulating enough score advances the level
 *       exactly to the qualifying tier — never to a higher tier you
 *       haven't earned.
 *     • Idempotent at the current level (poll-friendly).
 *     • Never demotes: if score drops below the current tier (e.g.
 *       after a Default), promote_level reverts with
 *       LevelThresholdNotMet. The profile.level stays where it was.
 *
 * Level boundaries in play:
 *     LEVEL_2_THRESHOLD = 500
 *     LEVEL_3_THRESHOLD = 2000
 *     LEVEL_2_MIN_CYCLES = 1   (SEV-047 gate)
 * Unverified Payment delta = 5, CycleComplete delta = 25. SEV-047
 * made Level 2 require BOTH score >= 500 AND cycles_completed >= 1
 * (score-only promotion was the reputation-farming vector). So we
 * drive 1 CycleComplete + 94 Payments (the prior test already left 1
 * Payment) to land EXACTLY on score 500 with cycles_completed = 1 —
 * exercising the threshold AND the cycle gate end-to-end. We do NOT
 * drive the Level-3 boundary — `resolve_level` is exhaustively
 * unit-tested in the Rust module (including the cycles gate), and the
 * on-chain path for "level 2 → level 3" is mechanically identical.
 *
 * Determinism:
 *   Seeded per-test wallets, fixed admin nonces, no sleeps, no
 *   clock warp.
 */

import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import {
  SCHEMA,
  adminAttest,
  attestationFor,
  ensureFunded,
  fetchAttestation,
  fetchProfile,
  initializeReputation,
  initProfile,
  keypairFromSeed,
  promoteLevel,
  reputationProfileFor,
  revokeAttestation,
  setIdentityGate,
  setupEnv,
  type Env,
} from "./_harness/index.js";

// ─── View types / helpers ─────────────────────────────────────────────

interface ProfileSnapshot {
  score: bigint;
  level: number;
  cyclesCompleted: number;
  onTimePayments: number;
  latePayments: number;
  defaults: number;
  totalParticipated: number;
  lastCycleCompleteAt: bigint;
}

function bn(x: { toString(): string }): bigint {
  return BigInt(x.toString());
}

async function snapshotProfile(env: Env, wallet: PublicKey): Promise<ProfileSnapshot> {
  const raw = await fetchProfile(env, wallet);
  const p = raw as unknown as {
    score: { toString(): string };
    level: number;
    cyclesCompleted: number;
    onTimePayments: number;
    latePayments: number;
    defaults: number;
    totalParticipated: number;
    lastCycleCompleteAt: { toString(): string };
  };
  return {
    score: bn(p.score),
    level: p.level,
    cyclesCompleted: p.cyclesCompleted,
    onTimePayments: p.onTimePayments,
    latePayments: p.latePayments,
    defaults: p.defaults,
    totalParticipated: p.totalParticipated,
    lastCycleCompleteAt: bn(p.lastCycleCompleteAt),
  };
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

// Constants that mirror the reputation program's on-chain values.
const DELTA_PAYMENT_UNVERIFIED = 5n;
const DELTA_CYCLE_COMPLETE_UNVERIFIED = 25n;
const SCORE_DEFAULT_ABS = 500n;
const LEVEL_2_THRESHOLD = 500n;
const LEVEL_MIN = 1;
const LEVEL_2 = 2;

// ─── Tests ────────────────────────────────────────────────────────────

describe("reputation — revoke + promote_level", function () {
  this.timeout(600_000); // 10min — the promote_level block does 100 serial attests

  let env: Env;

  before(async function () {
    env = await setupEnv();
    // Only the reputation singleton is needed — this spec exercises
    // the reputation program directly (admin-path attest + revoke +
    // promote_level) without routing through core.
    await initializeReputation(env, { coreProgram: env.ids.core });
    // SEV-047: promote_level REQUIRES the IdentityGateConfig PDA. Create it
    // with the gate OFF (required_min_level=0) so the promote tests below run
    // unchanged; the dedicated gate test toggles it on/off itself.
    await setIdentityGate(env, { requiredMinLevel: 0 });
  });

  // ═══════════════════════════════════════════════════════════════════
  //                              REVOKE
  // ═══════════════════════════════════════════════════════════════════

  describe("revoke", function () {
    it("Payment attest → revoke restores score exactly (symmetric delta)", async function () {
      const subject = keypairFromSeed("replife/revoke/symmetric");
      await initProfile(env, subject.publicKey);

      const before = await snapshotProfile(env, subject.publicKey);
      expect(before.score).to.equal(0n);
      expect(before.onTimePayments).to.equal(0);

      const nonce = 0x0100_0000n;
      await adminAttest(env, {
        subject: subject.publicKey,
        schemaId: SCHEMA.Payment,
        nonce,
      });

      const afterAttest = await snapshotProfile(env, subject.publicKey);
      expect(afterAttest.score).to.equal(DELTA_PAYMENT_UNVERIFIED);
      expect(afterAttest.onTimePayments).to.equal(1);

      const attPda = attestationFor(
        env,
        env.payer.publicKey, // admin path — issuer IS env.payer
        subject.publicKey,
        SCHEMA.Payment,
        nonce,
      );
      const attBefore = (await fetchAttestation(env, attPda)) as { revoked: boolean };
      expect(attBefore.revoked).to.equal(false);

      await revokeAttestation(env, {
        issuer: env.payer,
        subject: subject.publicKey,
        attestation: attPda,
      });

      const afterRevoke = await snapshotProfile(env, subject.publicKey);
      // Score restored exactly — counters decremented.
      expect(afterRevoke.score).to.equal(0n);
      expect(afterRevoke.onTimePayments).to.equal(0);
      // Everything else is bit-identical to the pre-attest baseline,
      // modulo `last_updated_at` which revoke also stamps.
      expect(afterRevoke.latePayments).to.equal(0);
      expect(afterRevoke.defaults).to.equal(0);
      expect(afterRevoke.cyclesCompleted).to.equal(0);
      expect(afterRevoke.totalParticipated).to.equal(0);

      const attAfter = (await fetchAttestation(env, attPda)) as { revoked: boolean };
      expect(attAfter.revoked).to.equal(true);
    });

    it("revoke by non-issuer → InvalidIssuer, attestation stays revoked=false", async function () {
      const subject = keypairFromSeed("replife/revoke/wrong-issuer");
      await initProfile(env, subject.publicKey);

      const nonce = 0x0100_0001n;
      await adminAttest(env, {
        subject: subject.publicKey,
        schemaId: SCHEMA.Payment,
        nonce,
      });

      const attPda = attestationFor(
        env,
        env.payer.publicKey,
        subject.publicKey,
        SCHEMA.Payment,
        nonce,
      );
      const attBefore = (await fetchAttestation(env, attPda)) as {
        revoked: boolean;
        issuer: PublicKey;
        subject: PublicKey;
      };
      expect(attBefore.revoked).to.equal(false);

      const rogue = keypairFromSeed("replife/revoke/rogue");
      await ensureFunded(env, [rogue], 1);

      const profileBefore = await snapshotProfile(env, subject.publicKey);

      const msg = await expectRejected(() =>
        revokeAttestation(env, {
          issuer: rogue,
          subject: subject.publicKey,
          attestation: attPda,
        }),
      );
      expect(msg, `message: ${msg}`).to.match(/InvalidIssuer|issuer/i);

      const attAfter = (await fetchAttestation(env, attPda)) as { revoked: boolean };
      expect(attAfter.revoked).to.equal(false);

      // Profile is identical (score, counters, timestamps).
      const profileAfter = await snapshotProfile(env, subject.publicKey);
      expect(profileAfter).to.deep.equal(profileBefore);
    });

    it("CycleComplete revoke preserves last_cycle_complete_at (cooldown intact)", async function () {
      const subject = keypairFromSeed("replife/revoke/cooldown");
      await initProfile(env, subject.publicKey);

      const nonce = 0x0100_0002n;
      await adminAttest(env, {
        subject: subject.publicKey,
        schemaId: SCHEMA.CycleComplete,
        nonce,
      });

      const afterAttest = await snapshotProfile(env, subject.publicKey);
      expect(afterAttest.cyclesCompleted).to.equal(1);
      expect(afterAttest.totalParticipated).to.equal(1);
      expect(afterAttest.score).to.equal(DELTA_CYCLE_COMPLETE_UNVERIFIED);
      // This is the key field — should be non-zero after CycleComplete.
      expect(afterAttest.lastCycleCompleteAt > 0n).to.equal(true);

      const attPda = attestationFor(
        env,
        env.payer.publicKey,
        subject.publicKey,
        SCHEMA.CycleComplete,
        nonce,
      );

      await revokeAttestation(env, {
        issuer: env.payer,
        subject: subject.publicKey,
        attestation: attPda,
      });

      const afterRevoke = await snapshotProfile(env, subject.publicKey);

      // Score + counters revert.
      expect(afterRevoke.score).to.equal(0n);
      expect(afterRevoke.cyclesCompleted).to.equal(0);
      expect(afterRevoke.totalParticipated).to.equal(0);

      // BUT last_cycle_complete_at stays. Cooldown must NOT be
      // clearable via revoke — that would undo anti-gaming.
      expect(afterRevoke.lastCycleCompleteAt).to.equal(afterAttest.lastCycleCompleteAt);
    });

    it("double-revoke on the same attestation → AttestationRevoked", async function () {
      const subject = keypairFromSeed("replife/revoke/double");
      await initProfile(env, subject.publicKey);

      const nonce = 0x0100_0003n;
      await adminAttest(env, {
        subject: subject.publicKey,
        schemaId: SCHEMA.Payment,
        nonce,
      });

      const attPda = attestationFor(
        env,
        env.payer.publicKey,
        subject.publicKey,
        SCHEMA.Payment,
        nonce,
      );

      await revokeAttestation(env, {
        issuer: env.payer,
        subject: subject.publicKey,
        attestation: attPda,
      });

      const afterFirstRevoke = await snapshotProfile(env, subject.publicKey);

      const msg = await expectRejected(() =>
        revokeAttestation(env, {
          issuer: env.payer,
          subject: subject.publicKey,
          attestation: attPda,
        }),
      );
      expect(msg, `message: ${msg}`).to.match(/AttestationRevoked|revoked/i);

      // Profile unchanged after the failed second revoke.
      const afterSecondRevoke = await snapshotProfile(env, subject.publicKey);
      expect(afterSecondRevoke).to.deep.equal(afterFirstRevoke);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //                           PROMOTE_LEVEL
  // ═══════════════════════════════════════════════════════════════════

  describe("promote_level", function () {
    // All tests in this block share one profile that we shepherd
    // across the level-2 boundary.
    const subject = keypairFromSeed("replife/promote/shared");
    let subjectPubkey: PublicKey;
    let profilePda: PublicKey;

    before(async function () {
      subjectPubkey = subject.publicKey;
      profilePda = reputationProfileFor(env, subjectPubkey);
      await initProfile(env, subjectPubkey);
    });

    it("low score: promote_level is a no-op (stays at level 1)", async function () {
      // Seed a single Payment so last_updated_at is set, but score
      // stays well below LEVEL_2_THRESHOLD.
      await adminAttest(env, {
        subject: subjectPubkey,
        schemaId: SCHEMA.Payment,
        nonce: 0x0200_0000n,
      });

      const before = await snapshotProfile(env, subjectPubkey);
      expect(before.score).to.equal(DELTA_PAYMENT_UNVERIFIED);
      expect(before.level).to.equal(LEVEL_MIN);

      await promoteLevel(env, { subject: subjectPubkey });

      const after = await snapshotProfile(env, subjectPubkey);
      expect(after.level).to.equal(LEVEL_MIN);
      expect(after.score).to.equal(before.score);
      // No-op path in the handler returns Ok without stamping last_updated_at
      // (see promote_level.rs). So last-touched stays from the attest above.

      // Sanity: profile PDA bytes exist (we've read it), so nothing exotic.
      const info = await env.connection.getAccountInfo(profilePda, "confirmed");
      expect(info).to.not.be.null;
    });

    it("accumulate score to threshold 500 (+1 cycle) and promote → level 2", async function () {
      // We already have 1 Payment from the previous test (score=5,
      // cycles_completed=0).
      //
      // SEV-047: Level 2 now requires BOTH score >= LEVEL_2_THRESHOLD AND
      // cycles_completed >= LEVEL_2_MIN_CYCLES (=1). Score alone no longer
      // promotes. So we drive ONE CycleComplete (the subject's first, so the
      // 6-day cooldown is trivially satisfied: last_cycle_complete_at = 0)
      // plus enough Payments to land EXACTLY on 500:
      //   prior 1 Payment (5) + CycleComplete (25) + N Payments (5·N) = 500
      //   ⇒ N = 94.
      const PAYMENTS = 94;

      await adminAttest(env, {
        subject: subjectPubkey,
        schemaId: SCHEMA.CycleComplete,
        // Distinct from the 0x0200_0000 (prior test) and 0x0200_0100+ below.
        nonce: 0x0200_00ffn,
      });

      for (let i = 0; i < PAYMENTS; i++) {
        await adminAttest(env, {
          subject: subjectPubkey,
          schemaId: SCHEMA.Payment,
          // Nonces must not collide with the 0x0200_0000 we used above.
          nonce: BigInt(0x0200_0100 + i),
        });
      }

      const beforePromote = await snapshotProfile(env, subjectPubkey);
      expect(beforePromote.score).to.equal(LEVEL_2_THRESHOLD);
      expect(beforePromote.onTimePayments).to.equal(PAYMENTS + 1);
      // SEV-047: the cycle gate must be satisfied for promotion to succeed.
      expect(beforePromote.cyclesCompleted).to.be.at.least(1);
      expect(beforePromote.level).to.equal(LEVEL_MIN);

      await promoteLevel(env, { subject: subjectPubkey });

      const afterPromote = await snapshotProfile(env, subjectPubkey);
      expect(afterPromote.level).to.equal(LEVEL_2);
      // Score is unchanged by promotion (level is a derived field).
      expect(afterPromote.score).to.equal(beforePromote.score);

      // Critical: promotion stopped exactly at level 2, did NOT skip
      // to level 3 even though the resolve_level formula would return
      // the right answer (which is 2 at score=500 < 2000).
      expect(afterPromote.level).to.equal(LEVEL_2);
    });

    it("re-promote at level 2 with same score is a no-op", async function () {
      const before = await snapshotProfile(env, subjectPubkey);
      expect(before.level).to.equal(LEVEL_2);

      await promoteLevel(env, { subject: subjectPubkey });

      const after = await snapshotProfile(env, subjectPubkey);
      expect(after.level).to.equal(LEVEL_2);
      expect(after.score).to.equal(before.score);
      expect(after.onTimePayments).to.equal(before.onTimePayments);
    });

    it("score drops below tier: promote_level reverts, never demotes", async function () {
      // One Default attestation zeros the score (500 - 500 = 0).
      // SCHEMA_DEFAULT delta is NOT halved for unverified (only positive
      // deltas are halved), so the full -500 lands.
      await adminAttest(env, {
        subject: subjectPubkey,
        schemaId: SCHEMA.Default,
        nonce: 0x0300_0000n,
      });

      const afterDefault = await snapshotProfile(env, subjectPubkey);
      // Score reduced by the full 500 (negative deltas NOT halved).
      expect(afterDefault.score).to.equal(0n);
      expect(afterDefault.defaults).to.equal(1);
      // Level stays where it was — default doesn't touch level.
      expect(afterDefault.level).to.equal(LEVEL_2);

      const msg = await expectRejected(() => promoteLevel(env, { subject: subjectPubkey }));
      expect(msg, `message: ${msg}`).to.match(/LevelThresholdNotMet|threshold/i);

      // Level is untouched by the failed promotion attempt.
      const afterPromote = await snapshotProfile(env, subjectPubkey);
      expect(afterPromote.level).to.equal(LEVEL_2);
      expect(afterPromote.score).to.equal(0n);

      // Sanity check SCORE_DEFAULT_ABS matches what we deducted.
      expect(SCORE_DEFAULT_ABS).to.equal(500n);
    });

    it("SEV-047 identity gate: floor=2 caps an unverified L2-qualifier at L1", async function () {
      // Fresh subject, independent of the shared-state tests above.
      const gated = keypairFromSeed("replife/gate/sev047");
      await initProfile(env, gated.publicKey);

      // Drive to an L2-qualifying state WITHOUT identity:
      //   1 CycleComplete (+25) + 95 Payments (+475) = score 500, cycles 1.
      await adminAttest(env, {
        subject: gated.publicKey,
        schemaId: SCHEMA.CycleComplete,
        nonce: 0x0470_0000n,
      });
      for (let i = 0; i < 95; i++) {
        await adminAttest(env, {
          subject: gated.publicKey,
          schemaId: SCHEMA.Payment,
          nonce: BigInt(0x0470_0100 + i),
        });
      }
      const pre = await snapshotProfile(env, gated.publicKey);
      expect(pre.score).to.equal(LEVEL_2_THRESHOLD);
      expect(pre.cyclesCompleted).to.be.at.least(1);
      expect(pre.level).to.equal(LEVEL_MIN);

      // Enable the gate: L2+ now requires a verified identity.
      await setIdentityGate(env, { requiredMinLevel: 2 });

      // Promote WITHOUT an identity record → resolved=2 but capped to L1.
      await promoteLevel(env, { subject: gated.publicKey });
      const gatedSnap = await snapshotProfile(env, gated.publicKey);
      expect(gatedSnap.level, "unverified subject must stay L1 under the gate").to.equal(LEVEL_MIN);

      // Positive control: disable the gate → the same subject promotes to L2.
      await setIdentityGate(env, { requiredMinLevel: 0 });
      await promoteLevel(env, { subject: gated.publicKey });
      const ungated = await snapshotProfile(env, gated.publicKey);
      expect(ungated.level, "with gate off, L2 score+cycles promotes").to.equal(LEVEL_2);
    });
  });
});

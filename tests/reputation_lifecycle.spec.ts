/**
 * Reputation — revoke boundaries (Step 5d / 3, localnet half).
 *
 * The `promote_level` half moved to
 * `tests/reputation_lifecycle_bankrun.spec.ts` (drives ~100 admin
 * attests rate-limited by MIN_ADMIN_ATTEST_COOLDOWN_SECS=60 →
 * structurally unrunnable on plain localnet without ~100min of sleeps;
 * bankrun's clock-warp resolves it deterministically).
 *
 * What remains here (cooldown-free, localnet-friendly):
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

describe("reputation — revoke", function () {
  this.timeout(120_000);

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
  //
  // The promote_level block was moved to
  // `tests/reputation_lifecycle_bankrun.spec.ts` because it drives ~100
  // admin attests against the same subject, each rate-limited by
  // MIN_ADMIN_ATTEST_COOLDOWN_SECS = 60 (SEV-027/SEV-030). Localnet has
  // no way to satisfy that without wall-clock sleeps of ~100 minutes per
  // test; bankrun's clock-warp resolves it deterministically in
  // milliseconds. Same pattern as `reputation_gate_bankrun.spec.ts`.
});

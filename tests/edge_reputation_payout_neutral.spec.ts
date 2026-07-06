/**
 * edge — PAYOUT_CLAIMED is score- and cycles-neutral (LEAD-008, Phase E, bankrun).
 *
 * LEAD-008 (Caio audit) concluded that `crank_payout` (and `claim_payout`) add
 * NO farmable reputation surface: both emit `SCHEMA_PAYOUT_CLAIMED` (id 6), which
 * is wired to `SCORE_PAYOUT_CLAIMED = 0` and does not touch `cycles_completed`
 * (the two inputs the whole level/ROI model depends on) — it only bumps the
 * informational `total_participated`. That conclusion was reached by inspection;
 * this pins it in CI so a future schema-table edit can't silently make the payout
 * event score-bearing (which would re-open the "farm reputation by cranking"
 * vector the audit ruled out).
 *
 * Driven via the admin attest path (proven `_harness` helper) on the
 * bankrun-compat env, so it runs in the bankrun lane.
 */

import { expect } from "chai";
import { describe, it, before } from "mocha";

import {
  adminAttest,
  fetchProfile,
  initProfile,
  initializeReputation,
  keypairFromSeed,
  SCHEMA,
  setIdentityGate,
} from "./_harness/index.js";
import { setupBankrunEnvCompat, type BankrunEnvCompat } from "./_harness/bankrun_compat.js";
import { setBankrunUnixTs } from "./_harness/bankrun.js";

// Local helper (score is i64) — mirrors reputation_gate_bankrun.spec.ts.
function bn(x: { toString(): string }): bigint {
  return BigInt(x.toString());
}

const CLOCK = 1_800_000_000n;

describe("edge — PAYOUT_CLAIMED is score/cycles-neutral (LEAD-008, bankrun)", function () {
  this.timeout(60_000);

  let env: BankrunEnvCompat;
  const subject = keypairFromSeed("lead008/payout-neutral");

  before(async function () {
    env = await setupBankrunEnvCompat({ loadMplCore: false });
    await setBankrunUnixTs(env.context, CLOCK);
    await initializeReputation(env, { coreProgram: env.ids.core });
    await setIdentityGate(env, { requiredMinLevel: 0 }); // gate off
    await initProfile(env, subject.publicKey);
  });

  it("a PAYOUT_CLAIMED attestation adds 0 score and does not advance cycles_completed", async function () {
    // Give the profile a non-zero baseline so we prove PAYOUT_CLAIMED does not
    // ADD (not merely "stays at 0").
    await adminAttest(env, {
      subject: subject.publicKey,
      schemaId: SCHEMA.Payment,
      nonce: 0x0800_0001n,
    });

    const pre = (await fetchProfile(env, subject.publicKey)) as {
      score: { toString(): string };
      cyclesCompleted: number;
    };
    const scoreBefore = bn(pre.score);
    const cyclesBefore = pre.cyclesCompleted;
    expect(scoreBefore, "baseline score is non-zero after a Payment").to.not.equal(0);

    // The event a cranker/claimer produces.
    await adminAttest(env, {
      subject: subject.publicKey,
      schemaId: SCHEMA.PayoutClaimed,
      nonce: 0x0800_0002n,
    });

    const post = (await fetchProfile(env, subject.publicKey)) as {
      score: { toString(): string };
      cyclesCompleted: number;
    };
    expect(bn(post.score), "PAYOUT_CLAIMED must not change score").to.equal(scoreBefore);
    expect(post.cyclesCompleted, "PAYOUT_CLAIMED must not advance cycles_completed").to.equal(
      cyclesBefore,
    );
  });

  it("repeated PAYOUT_CLAIMED attestations never accumulate score or cycles", async function () {
    const start = (await fetchProfile(env, subject.publicKey)) as {
      score: { toString(): string };
      cyclesCompleted: number;
    };
    const scoreStart = bn(start.score);
    const cyclesStart = start.cyclesCompleted;

    // Five more payout events (distinct nonces) — as if a member were cranked /
    // claimed across many cycles. None may move score or cycles.
    for (let i = 0; i < 5; i++) {
      await adminAttest(env, {
        subject: subject.publicKey,
        schemaId: SCHEMA.PayoutClaimed,
        nonce: BigInt(0x0800_0100 + i),
      });
    }

    const end = (await fetchProfile(env, subject.publicKey)) as {
      score: { toString(): string };
      cyclesCompleted: number;
    };
    expect(bn(end.score), "5× PAYOUT_CLAIMED still adds 0 score").to.equal(scoreStart);
    expect(end.cyclesCompleted, "5× PAYOUT_CLAIMED still advances no cycles").to.equal(cyclesStart);
  });
});

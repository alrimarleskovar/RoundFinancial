/**
 * Reputation — promote_level boundaries (bankrun, clock-warp).
 *
 * Split out from `reputation_lifecycle.spec.ts` because the
 * promote_level block needs to drive ~100 admin attests against the
 * same subject, and the on-chain admin-attest path is rate-limited by
 * MIN_ADMIN_ATTEST_COOLDOWN_SECS = 60 (SEV-027/SEV-030). On a real
 * localnet the only way to satisfy that is to wall-clock sleep 60s
 * between every call (~100 min per test), so the block was structurally
 * unrunnable there. bankrun's `setBankrunUnixTs` lets us warp the
 * clock +61s deterministically in milliseconds — the canonical
 * clock-warp lane, same pattern as `reputation_gate_bankrun.spec.ts`.
 *
 * The sibling `reputation_lifecycle.spec.ts` keeps the `revoke` block
 * (cooldown-free) on localnet. This file owns the cooldown-bound tests.
 */

import { describe, it, before } from "mocha";
import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import {
  SCHEMA,
  adminAttest,
  fetchProfile,
  initProfile,
  initializeReputation,
  keypairFromSeed,
  promoteLevel,
  reputationProfileFor,
  setIdentityGate,
} from "./_harness/index.js";
import { setupBankrunEnvCompat, type BankrunEnvCompat } from "./_harness/bankrun_compat.js";
import { setBankrunUnixTs } from "./_harness/bankrun.js";

// ─── Local constants (mirror reputation_lifecycle.spec.ts) ───────────

const DELTA_PAYMENT_UNVERIFIED = 5n;
const SCORE_DEFAULT_ABS = 500n;
const LEVEL_2_THRESHOLD = 500n;
const LEVEL_MIN = 1;
const LEVEL_2 = 2;

// Admin-direct cooldown is 60s; warp a hair past it before each attest.
// Base ts is well past the 6-day CycleComplete cooldown floor
// (MIN_CYCLE_COOLDOWN_SECS = 518_400) so each subject's first
// CycleComplete (last_cycle_complete_at = 0) clears trivially.
const COOLDOWN_STEP = 61n;
let CLOCK = 1_900_000_000n; // ~2030

async function tick(env: BankrunEnvCompat): Promise<void> {
  CLOCK += COOLDOWN_STEP;
  await setBankrunUnixTs(env.context, CLOCK);
}

// ─── View types / helpers ────────────────────────────────────────────

interface ProfileSnapshot {
  score: bigint;
  level: number;
  cyclesCompleted: number;
  onTimePayments: number;
  latePayments: number;
  defaults: number;
  totalParticipated: number;
}

function bn(x: { toString(): string }): bigint {
  return BigInt(x.toString());
}

async function snapshotProfile(env: BankrunEnvCompat, wallet: PublicKey): Promise<ProfileSnapshot> {
  const raw = await fetchProfile(env, wallet);
  const p = raw as unknown as {
    score: { toString(): string };
    level: number;
    cyclesCompleted: number;
    onTimePayments: number;
    latePayments: number;
    defaults: number;
    totalParticipated: number;
  };
  return {
    score: bn(p.score),
    level: p.level,
    cyclesCompleted: p.cyclesCompleted,
    onTimePayments: p.onTimePayments,
    latePayments: p.latePayments,
    defaults: p.defaults,
    totalParticipated: p.totalParticipated,
  };
}

async function expectRejected(thunk: () => Promise<unknown>): Promise<string> {
  try {
    await thunk();
  } catch (err) {
    return String((err as Error)?.message ?? err);
  }
  throw new Error("expected the call to reject, but it resolved");
}

// ─── The spec ────────────────────────────────────────────────────────

describe("reputation — promote_level (bankrun, clock-warp)", function () {
  this.timeout(120_000);

  let env: BankrunEnvCompat;

  before(async function () {
    // reputation has no mpl-core CPI → skip the bankrun-incompatible load.
    env = await setupBankrunEnvCompat({ loadMplCore: false });
    await setBankrunUnixTs(env.context, CLOCK);
    await initializeReputation(env, { coreProgram: env.ids.core });
    // SEV-047: promote_level REQUIRES the IdentityGateConfig PDA. Create it
    // with the gate OFF so the promote tests run unchanged; the dedicated
    // gate test below toggles it on/off itself.
    await setIdentityGate(env, { requiredMinLevel: 0 });
  });

  // All tests in this block share one profile that we shepherd across
  // the level-2 boundary (same shared-state shape as the original).
  const subject = keypairFromSeed("replife/promote/shared");
  let subjectPubkey: PublicKey;
  let profilePda: PublicKey;

  before(async function () {
    subjectPubkey = subject.publicKey;
    profilePda = reputationProfileFor(env, subjectPubkey);
    await initProfile(env, subjectPubkey);
  });

  it("low score: promote_level is a no-op (stays at level 1)", async function () {
    await tick(env);
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

    const info = await env.context.banksClient.getAccount(profilePda);
    expect(info).to.not.equal(null);
  });

  it("accumulate score to threshold 500 (+1 cycle) and promote → level 2", async function () {
    // Prior state: 1 Payment from the test above (score=5, cycles=0).
    // SEV-047 needs score >= 500 AND cycles_completed >= 1.
    //   prior 1 Payment (5) + CycleComplete (25) + N Payments (5·N) = 500
    //   ⇒ N = 94.
    const PAYMENTS = 94;

    await tick(env);
    await adminAttest(env, {
      subject: subjectPubkey,
      schemaId: SCHEMA.CycleComplete,
      nonce: 0x0200_00ffn,
    });

    for (let i = 0; i < PAYMENTS; i++) {
      await tick(env);
      await adminAttest(env, {
        subject: subjectPubkey,
        schemaId: SCHEMA.Payment,
        nonce: BigInt(0x0200_0100 + i),
      });
    }

    const beforePromote = await snapshotProfile(env, subjectPubkey);
    expect(beforePromote.score).to.equal(LEVEL_2_THRESHOLD);
    expect(beforePromote.onTimePayments).to.equal(PAYMENTS + 1);
    expect(beforePromote.cyclesCompleted).to.be.at.least(1);
    expect(beforePromote.level).to.equal(LEVEL_MIN);

    await promoteLevel(env, { subject: subjectPubkey });

    const afterPromote = await snapshotProfile(env, subjectPubkey);
    expect(afterPromote.level).to.equal(LEVEL_2);
    expect(afterPromote.score).to.equal(beforePromote.score);
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

  it("default zeroes score and demotes level (SEV-007); promote_level then reverts", async function () {
    // One Default zeros the score (500 - 500 = 0). Negative deltas are
    // NOT halved (only positive increments are dampened for unverified).
    await tick(env);
    await adminAttest(env, {
      subject: subjectPubkey,
      schemaId: SCHEMA.Default,
      nonce: 0x0300_0000n,
    });

    const afterDefault = await snapshotProfile(env, subjectPubkey);
    expect(afterDefault.score).to.equal(0n);
    expect(afterDefault.defaults).to.equal(1);
    // SEV-007: a Default attestation now re-derives the level from the
    // post-delta score and demotes immediately (clamped at LEVEL_MIN).
    // Before SEV-007 the level stuck at L2 until a later promote_level
    // call — which let a defaulter re-enter the next pool with the
    // cheaper L2/L3 stake_bps. With score back to 0, resolve_level → L1.
    expect(afterDefault.level).to.equal(LEVEL_MIN);

    // promote_level can't re-promote: score 0 < LEVEL_2_THRESHOLD, so it
    // reverts. Level stays demoted (never silently re-promotes).
    const msg = await expectRejected(() => promoteLevel(env, { subject: subjectPubkey }));
    expect(msg, `message: ${msg}`).to.match(/LevelThresholdNotMet|threshold/i);

    const afterPromote = await snapshotProfile(env, subjectPubkey);
    expect(afterPromote.level).to.equal(LEVEL_MIN);
    expect(afterPromote.score).to.equal(0n);

    expect(SCORE_DEFAULT_ABS).to.equal(500n);
  });

  it("SEV-047 identity gate: floor=2 caps an unverified L2-qualifier at L1", async function () {
    const gated = keypairFromSeed("replife/gate/sev047");
    await initProfile(env, gated.publicKey);

    // Drive to L2-qualifying state WITHOUT identity:
    //   1 CycleComplete (+25) + 95 Payments (+475) = score 500, cycles 1.
    await tick(env);
    await adminAttest(env, {
      subject: gated.publicKey,
      schemaId: SCHEMA.CycleComplete,
      nonce: 0x0470_0000n,
    });
    for (let i = 0; i < 95; i++) {
      await tick(env);
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

    await setIdentityGate(env, { requiredMinLevel: 2 });

    await promoteLevel(env, { subject: gated.publicKey });
    const gatedSnap = await snapshotProfile(env, gated.publicKey);
    expect(gatedSnap.level, "unverified subject must stay L1 under the gate").to.equal(LEVEL_MIN);

    await setIdentityGate(env, { requiredMinLevel: 0 });
    await promoteLevel(env, { subject: gated.publicKey });
    const ungated = await snapshotProfile(env, gated.publicKey);
    expect(ungated.level, "with gate off, L2 score+cycles promotes").to.equal(LEVEL_2);
  });
});

/**
 * SEV-047 identity-gate enforcement — bankrun end-to-end.
 *
 * **Why a separate bankrun spec.** The on-chain enforcement of the
 * identity gate lives in `promote_level` (Part 2): it reads the
 * `IdentityGateConfig.required_min_level` floor and the subject's
 * `IdentityRecord` and caps the resolved level via
 * `cap_level_for_identity`. Exercising that path end-to-end needs a
 * profile driven to an L2-qualifying state — score 500 AND
 * cycles_completed >= 1 (the SEV-047 Part 1 cycle gate). Reaching
 * score 500 takes 1 CycleComplete (+25) + 95 unverified Payments
 * (+475). But SEV-027/030 put a 60s `MIN_ADMIN_ATTEST_COOLDOWN_SECS`
 * on every score-changing admin attest, so 96 serial attests are
 * impossible on a wall-clock `solana-test-validator` (each lands in
 * the same second → `CooldownActive`). That is exactly why
 * `reputation_lifecycle.spec.ts`'s promote block cannot run green on
 * plain localnet.
 *
 * bankrun's `setClock` lets us warp the clock +61s between each
 * attest, satisfying the cooldown deterministically and in
 * milliseconds. So this is the canonical clock-warp lane for the gate
 * enforcement — and, because roundfi-reputation has NO mpl-core
 * dependency, it is eligible for the CI `bankrun-no-mpl-core` lane
 * (unlike the mpl-core-gated localnet reputation specs, SEV-012).
 *
 * Coverage:
 *   • Gate floor=2, unverified subject at score 500 + 1 cycle:
 *     promote_level resolves L2 but CAPS to L1.
 *   • Gate floor=0 (off): the SAME subject promotes to L2.
 *
 * The pure capping function `cap_level_for_identity` is exhaustively
 * unit-tested in the Rust module; this spec proves the on-chain
 * wiring (account resolution + handler read of the gate/identity)
 * actually reaches it.
 */

import { expect } from "chai";
import { describe, it, before } from "mocha";
import { PublicKey } from "@solana/web3.js";

import {
  SCHEMA,
  adminAttest,
  fetchProfile,
  initProfile,
  initializeReputation,
  keypairFromSeed,
  promoteLevel,
  setIdentityGate,
} from "./_harness/index.js";
import { setupBankrunEnvCompat, type BankrunEnvCompat } from "./_harness/bankrun_compat.js";
import { setBankrunUnixTs } from "./_harness/bankrun.js";

const LEVEL_2_THRESHOLD = 500n;
const LEVEL_MIN = 1;
const LEVEL_2 = 2;

// Admin-direct cooldown is 60s (MIN_ADMIN_ATTEST_COOLDOWN_SECS); warp a
// hair past it before each score-changing attest. Base ts is well past the
// 30-day POOL_COMPLETE cooldown (MIN_POOL_COMPLETE_COOLDOWN_SECS =
// 2_592_000) so each subject's FIRST PoolComplete (last_cycle_complete_at
// = 0) clears trivially.
const COOLDOWN_STEP = 61n;
// MIN_POOL_COMPLETE_COOLDOWN_SECS (30 days) — the per-subject floor between
// two POOL_COMPLETE attests. ECO-V52 raised LEVEL_2_MIN_CYCLES 1 → 2, so an
// L2-qualifier needs a 2nd completed pool that must clear this cooldown.
const POOL_COMPLETE_COOLDOWN_SECS = 2_592_000n;
let CLOCK = 1_900_000_000n; // ~2030, comfortably > the cooldown floors.

async function tick(env: BankrunEnvCompat): Promise<void> {
  CLOCK += COOLDOWN_STEP;
  await setBankrunUnixTs(env.context, CLOCK);
}

// Warp past the 30-day POOL_COMPLETE cooldown so a subject's 2nd
// PoolComplete is accepted (admin-direct is hard-rejected inside the
// cooldown — attest.rs).
async function tickCycleCooldown(env: BankrunEnvCompat): Promise<void> {
  CLOCK += POOL_COMPLETE_COOLDOWN_SECS + COOLDOWN_STEP;
  await setBankrunUnixTs(env.context, CLOCK);
}

function bn(x: { toString(): string }): bigint {
  return BigInt(x.toString());
}

describe("reputation — SEV-047 identity gate (bankrun, clock-warp)", function () {
  this.timeout(120_000);

  let env: BankrunEnvCompat;

  before(async function () {
    // roundfi-reputation has no mpl-core CPI → skip the (newer-arch,
    // bankrun-incompatible) mpl_core.so load entirely.
    env = await setupBankrunEnvCompat({ loadMplCore: false });
    await setBankrunUnixTs(env.context, CLOCK);
    await initializeReputation(env, { coreProgram: env.ids.core });
    // Create the IdentityGateConfig PDA with the gate OFF.
    await setIdentityGate(env, { requiredMinLevel: 0 });
  });

  it("floor=2 caps an unverified L2-qualifier at L1; floor=0 promotes to L2", async function () {
    const subject = keypairFromSeed("repgate/bankrun/sev047");
    await initProfile(env, subject.publicKey);

    // Drive to an L2-qualifying state WITHOUT an identity. ECO-V52 raised
    // LEVEL_2_MIN_CYCLES 1 → 2, so L2 now needs TWO completed pools:
    //   2 PoolComplete (+25 each) + 90 Payments (+5 each) = score 500, cycles 2.
    // The 2nd PoolComplete must clear the 30-day per-subject cooldown.
    await tick(env);
    await adminAttest(env, {
      subject: subject.publicKey,
      schemaId: SCHEMA.CycleComplete,
      nonce: 0x0470_0000n,
    });
    await tickCycleCooldown(env);
    await adminAttest(env, {
      subject: subject.publicKey,
      schemaId: SCHEMA.CycleComplete,
      nonce: 0x0470_0001n,
    });
    for (let i = 0; i < 90; i++) {
      await tick(env);
      await adminAttest(env, {
        subject: subject.publicKey,
        schemaId: SCHEMA.Payment,
        nonce: BigInt(0x0470_0100 + i),
      });
    }

    const pre = (await fetchProfile(env, subject.publicKey)) as {
      score: { toString(): string };
      cyclesCompleted: number;
      level: number;
    };
    expect(bn(pre.score)).to.equal(LEVEL_2_THRESHOLD);
    expect(pre.cyclesCompleted).to.be.at.least(2);
    expect(pre.level).to.equal(LEVEL_MIN);

    // Enable the gate: L2+ now requires a verified identity.
    await setIdentityGate(env, { requiredMinLevel: 2 });

    // Promote WITHOUT an identity record → resolved L2 but capped to L1.
    await promoteLevel(env, { subject: subject.publicKey });
    const gated = (await fetchProfile(env, subject.publicKey)) as { level: number };
    expect(gated.level, "unverified subject must stay L1 under the gate").to.equal(LEVEL_MIN);

    // Positive control: disable the gate → the SAME subject promotes to L2.
    await setIdentityGate(env, { requiredMinLevel: 0 });
    await promoteLevel(env, { subject: subject.publicKey });
    const ungated = (await fetchProfile(env, subject.publicKey)) as { level: number };
    expect(ungated.level, "with gate off, score 500 + 2 cycles promotes to L2").to.equal(LEVEL_2);
  });
});

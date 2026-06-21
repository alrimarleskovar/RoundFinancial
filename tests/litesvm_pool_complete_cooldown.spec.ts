/**
 * SEV-A2 — final-installment liveness under the POOL_COMPLETE cooldown.
 *
 * Pass-3 moved the `+50 / cycles_completed` reputation reward onto a
 * member's LAST `contribute` (the final installment), emitting
 * `SCHEMA_POOL_COMPLETE` there. That attestation is rate-limited by a
 * per-subject 30-day cooldown (`MIN_POOL_COMPLETE_COOLDOWN_SECS`) so a
 * sybil can't farm the promotion floor (L3 = 3 / L4 = 8 completed pools).
 *
 * The bug (SEV-A2): the CPI sits on contribute's MANDATORY path, so the
 * cooldown could revert the WHOLE payment. A member legitimately finishing
 * two pools < 30 days apart was then UNABLE to pay their final installment
 * — leaving the pool short and forfeiting the reward. Observed on devnet:
 * "Pool 50's cycle-1 POOL_COMPLETE reverted CooldownActive (6004)".
 *
 * The fix makes the completion credit BEST-EFFORT: core swallows ONLY a
 * cooldown rejection (every other CPI failure still reverts), so the
 * installment payment settles. The anti-farming guarantee is intact —
 * `cycles_completed` is NOT bumped and NO attestation is written for the
 * skipped completion.
 *
 * Proof, on the mpl_core (litesvm) path — the only CI lane that can run
 * `join_pool`:
 *   • pool A — subject S completes a pool and earns POOL_COMPLETE.
 *   • pool B — S completes the final installment WHILE inside the 30-day
 *     window. Pre-fix this reverted; post-fix the payment lands and the
 *     reward is skipped (no `cycles_completed` bump, no attestation).
 *   • a FRESH co-member of pool B still earns ITS POOL_COMPLETE — the skip
 *     is specific to the cooled-down subject, not a blanket disable.
 *
 * Clock ordering: all funding / join / cycle-0 run at the DEFAULT clock
 * (the path litesvm_join_pool exercises); the cooldown warp happens AFTER
 * every join — the same ordering the litesvm parity specs warp safely.
 *
 * Skips cleanly when the build artifacts are absent (same guard as
 * litesvm_join_pool.spec.ts).
 */

import { expect } from "chai";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";

import { ATTESTATION_SCHEMA } from "@roundfi/sdk";

import {
  attestationFor,
  attestationNonce,
  claimPayout,
  contribute,
  createPool,
  createUsdcMint,
  fetchMember,
  fetchProfile,
  fundUsdc,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  usdc,
  type MemberHandle,
  type PoolHandle,
} from "./_harness/index.js";
import { setLitesvmUnixTs, setupLitesvmEnv, type LitesvmEnv } from "./_harness/litesvm.js";

const ARTIFACTS = [
  "target/idl/roundfi_core.json",
  "target/idl/roundfi_reputation.json",
  "target/deploy/roundfi_core.so",
  "target/deploy/roundfi_reputation.so",
  "target/deploy/mpl_core.so",
].map((p) => resolve(process.cwd(), p));

// Minimal "real" ROSCA shape — SEV-038 forces cycles_total == members_target.
// Same split ratios as edge_degenerate B/C (solidarity 1 %, escrow 25 %).
const INSTALLMENT = usdc(1_000n);
const CREDIT = usdc(1_480n);
const CYCLE_DURATION = 86_400;

// Once every join is done we jump the clock comfortably past one cooldown
// window (since the epoch). The subject's FIRST completion then applies; the
// SECOND lands at the SAME clock, squarely inside the 30-day window.
const BASE_TS = 1_700_000_000n;

interface ProfileLike {
  cyclesCompleted: number;
  score: { toString(): string };
  lastCycleCompleteAt: { toString(): string };
}

function bn(x: { toString(): string }): bigint {
  return BigInt(x.toString());
}

describe("SEV-A2 — final-installment liveness under POOL_COMPLETE cooldown (litesvm)", function () {
  this.timeout(120_000);

  let env: LitesvmEnv;
  let available = true;
  let usdcMint: PublicKey;

  // S is in BOTH pools; the filler co-members are fresh per pool.
  const subject = Keypair.generate();

  before(async function () {
    for (const p of ARTIFACTS) {
      if (!existsSync(p)) {
        console.warn(`\n[litesvm] SKIPPING SEV-A2 spec — missing ${p} (run 'anchor build').`);
        available = false;
        return;
      }
    }
    try {
      // Setup runs at the DEFAULT clock (the warp comes later, post-join).
      env = await setupLitesvmEnv();
      usdcMint = await createUsdcMint(env, { forceFresh: true });
      await initializeProtocol(env, { usdcMint });
      await initializeReputation(env, { coreProgram: env.ids.core });
    } catch (e) {
      console.warn(
        `\n[litesvm] SKIPPING SEV-A2 spec — setup failed: ${(e as Error)?.message ?? e}`,
      );
      available = false;
    }
  });

  // Build + run a 2×2 pool with `subject` at slot 0 and `filler` at slot 1
  // through cycle 0 (S claims). Returns the handles so the caller can drive
  // cycle 1 (the final installment) with its own assertions.
  async function setupPoolThroughCycle0(
    filler: Keypair,
  ): Promise<{ pool: PoolHandle; sH: MemberHandle; fH: MemberHandle }> {
    const authority = Keypair.generate();
    const pool = await createPool(env, {
      authority,
      usdcMint,
      membersTarget: 2,
      installmentAmount: INSTALLMENT,
      creditAmount: CREDIT,
      cyclesTotal: 2,
      cycleDurationSec: CYCLE_DURATION,
    });
    const handles = await joinMembers(env, pool, [
      { member: subject, reputationLevel: 1 },
      { member: filler, reputationLevel: 1 },
    ]);
    const sH = handles[0]!;
    const fH = handles[1]!;
    await fundUsdc(env, usdcMint, sH.wallet.publicKey, 2n * INSTALLMENT);
    await fundUsdc(env, usdcMint, fH.wallet.publicKey, 2n * INSTALLMENT);

    // Cycle 0 — both pay (PAYMENT), slot 0 (== subject) claims.
    await contribute(env, { pool, member: sH, cycle: 0 });
    await contribute(env, { pool, member: fH, cycle: 0 });
    await claimPayout(env, { pool, member: sH, cycle: 0 });

    return { pool, sH, fH };
  }

  it("final installment settles inside the cooldown; reward skipped, payment kept", async function () {
    if (!available) {
      this.skip();
      return;
    }

    try {
      // ── Setup BOTH pools through cycle 0 at the default clock ──────────
      const fillerA = Keypair.generate();
      const a = await setupPoolThroughCycle0(fillerA);
      const fillerB = Keypair.generate();
      const b = await setupPoolThroughCycle0(fillerB);

      // Every join is done — now jump past one cooldown window. (Final-cycle
      // contributes are merely "late" at this clock, which is fine: the final
      // installment escalates to POOL_COMPLETE regardless of punctuality.)
      await setLitesvmUnixTs(env.svm, BASE_TS);

      // ── Pool A — subject earns its FIRST POOL_COMPLETE ────────────────
      // Neither member has completed a pool, so both rewards apply.
      await contribute(env, { pool: a.pool, member: a.sH, cycle: 1, isFinalInstallment: true });
      await contribute(env, { pool: a.pool, member: a.fH, cycle: 1, isFinalInstallment: true });
      await claimPayout(env, { pool: a.pool, member: a.fH, cycle: 1 }); // slot 1; pool completes

      const sAfterA = (await fetchProfile(env, subject.publicKey)) as unknown as ProfileLike;
      expect(sAfterA.cyclesCompleted, "subject credited one completed pool").to.equal(1);
      expect(bn(sAfterA.lastCycleCompleteAt) > 0n, "cooldown anchor recorded").to.equal(true);
      const pdaA = attestationFor(
        env,
        a.pool.pool,
        subject.publicKey,
        ATTESTATION_SCHEMA.PoolComplete,
        attestationNonce(1, a.sH.slotIndex),
      );
      expect(await env.connection.getAccountInfo(pdaA), "pool A POOL_COMPLETE attestation").to.not
        .be.null;

      // ── Pool B — subject completes a SECOND pool inside the cooldown ──
      const before = (await fetchProfile(env, subject.publicKey)) as unknown as ProfileLike;

      // The crux: the subject's FINAL installment would emit POOL_COMPLETE,
      // but the 30-day cooldown is active (pool A completed at the same clock).
      // Pre-SEV-A2 this reverted the whole tx. It MUST now settle.
      await contribute(env, { pool: b.pool, member: b.sH, cycle: 1, isFinalInstallment: true });

      // 1. Liveness: the installment was recorded (payment kept).
      const sMember = (await fetchMember(env, b.sH.member)) as unknown as {
        contributionsPaid: number;
      };
      expect(sMember.contributionsPaid, "final installment recorded").to.equal(2);

      // 2. Anti-farming intact: no cycles_completed bump, no score change, and
      //    the cooldown anchor is NOT advanced by the skipped completion.
      const after = (await fetchProfile(env, subject.publicKey)) as unknown as ProfileLike;
      expect(after.cyclesCompleted, "no second completion credited in-cooldown").to.equal(
        before.cyclesCompleted,
      );
      expect(bn(after.score), "score unchanged on the skipped completion").to.equal(
        bn(before.score),
      );
      expect(bn(after.lastCycleCompleteAt), "cooldown anchor not advanced").to.equal(
        bn(before.lastCycleCompleteAt),
      );

      // 3. No POOL_COMPLETE attestation was written for the skipped completion.
      const skippedPda = attestationFor(
        env,
        b.pool.pool,
        subject.publicKey,
        ATTESTATION_SCHEMA.PoolComplete,
        attestationNonce(1, b.sH.slotIndex),
      );
      expect(
        await env.connection.getAccountInfo(skippedPda),
        "skipped completion writes NO attestation",
      ).to.be.null;

      // 4. Differential — a FRESH co-member's final installment still earns its
      //    POOL_COMPLETE, so the skip is specific to the cooled-down subject.
      await contribute(env, { pool: b.pool, member: b.fH, cycle: 1, isFinalInstallment: true });
      const fProfile = (await fetchProfile(env, fillerB.publicKey)) as unknown as ProfileLike;
      expect(fProfile.cyclesCompleted, "fresh co-member still earns its completion").to.equal(1);
      const fPda = attestationFor(
        env,
        b.pool.pool,
        fillerB.publicKey,
        ATTESTATION_SCHEMA.PoolComplete,
        attestationNonce(1, b.fH.slotIndex),
      );
      expect(await env.connection.getAccountInfo(fPda), "fresh member's POOL_COMPLETE attestation")
        .to.not.be.null;

      // Pool still finalizes cleanly (slot 1 claims).
      await claimPayout(env, { pool: b.pool, member: b.fH, cycle: 1 });
    } catch (e) {
      // Surface the on-chain program logs litesvm attached to the error so a
      // remaining failure is diagnosable in one run rather than opaque ("6").
      const logs = (e as { logs?: string[] }).logs;
      if (logs?.length) console.error("\n[litesvm] program logs:\n" + logs.join("\n"));
      throw e;
    }
  });
});

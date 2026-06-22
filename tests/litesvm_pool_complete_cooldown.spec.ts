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
 * The fix makes the completion credit BEST-EFFORT inside the reputation
 * program: on the mandatory pool-PDA (contribute) path it does NOT revert the
 * cooldown — it records the attestation but NEUTRALIZES it (applies no score /
 * cycles_completed credit), so the installment payment settles. (A failed CPI
 * cannot be recovered by the caller, so the cooldown can't be allowed to
 * revert here.) The anti-farming guarantee is intact — `cycles_completed` is
 * NOT bumped, and the neutralized flag keeps `revoke` zero-sum. Admin-direct
 * POOL_COMPLETE still hard-rejects on cooldown.
 *
 * Proof, on the mpl_core (litesvm) path — the only CI lane that can run
 * `join_pool`:
 *   • pool A — subject S completes a pool and earns POOL_COMPLETE.
 *   • pool B — S completes the final installment WHILE inside the 30-day
 *     window. Pre-fix this reverted; post-fix the payment lands and the
 *     reward is skipped (no `cycles_completed` bump; attestation neutralized).
 *   • a FRESH co-member of pool B still earns ITS POOL_COMPLETE — the skip
 *     is specific to the cooled-down subject, not a blanket disable.
 *
 * Harness setup mirrors the proven `litesvm_parity` pattern: anchor the
 * (non-advancing) litesvm clock to a real epoch ONCE up front — so the
 * first POOL_COMPLETE clears the cooldown while every contribute stays
 * on-time (BASE_TS < next_cycle_at) — fund the authority, pre-fund each
 * member's USDC before the join, and use seeded keypairs. Both completions
 * then happen at the SAME anchored clock: the subject's first applies, the
 * second lands inside the 30-day window.
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
  keypairFromSeed,
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
const STAKE = (CREDIT * 5_000n) / 10_000n; // Iniciante (Lv1) = 50 %
const TOTAL_PER_MEMBER = 2n * INSTALLMENT + STAKE; // cyclesTotal = 2
const CYCLE_DURATION = 86_400;

// litesvm's clock does NOT auto-advance; anchor it to a real epoch ONCE so
// the first POOL_COMPLETE clears the 30-day cooldown (now − 0). Kept BELOW
// every next_cycle_at (= BASE_TS + cycle_duration) so contributes stay
// on-time. Both completions run at this same clock → the second is inside
// the window. (Matches litesvm_parity.spec.ts.)
const BASE_TS = 1_750_000_000n;

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

  // S is in BOTH pools (seeded so it is stable); the fillers are fresh per pool.
  const subject = keypairFromSeed("sev-a2-cooldown-subject");

  before(async function () {
    for (const p of ARTIFACTS) {
      if (!existsSync(p)) {
        console.warn(`\n[litesvm] SKIPPING SEV-A2 spec — missing ${p} (run 'anchor build').`);
        available = false;
        return;
      }
    }
    try {
      env = await setupLitesvmEnv();
      await setLitesvmUnixTs(env.svm, BASE_TS); // anchor the clock up front
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
  // through cycle 0 (S claims). Funding order mirrors litesvm_parity: fund the
  // authority, pre-fund each member's USDC, THEN join. Returns the handles so
  // the caller can drive cycle 1 (the final installment) with its own checks.
  async function setupPoolThroughCycle0(
    authority: Keypair,
    filler: Keypair,
  ): Promise<{ pool: PoolHandle; sH: MemberHandle; fH: MemberHandle }> {
    // litesvm-native airdrops (no tx → no blockhash) so the harness never
    // needs a payer→member SOL transfer; joinPool's `ensureFunded` then
    // short-circuits. (A bare System transfer to a fresh account proved flaky
    // on the local litesvm build; this sidesteps it without touching the
    // shared harness.)
    for (const kp of [authority, subject, filler]) {
      env.svm.airdrop(kp.publicKey.toBase58(), 100_000_000_000n);
    }
    const pool = await createPool(env, {
      authority,
      usdcMint,
      membersTarget: 2,
      installmentAmount: INSTALLMENT,
      creditAmount: CREDIT,
      cyclesTotal: 2,
      cycleDurationSec: CYCLE_DURATION,
    });

    await fundUsdc(env, usdcMint, subject.publicKey, TOTAL_PER_MEMBER);
    await fundUsdc(env, usdcMint, filler.publicKey, TOTAL_PER_MEMBER);

    const handles = await joinMembers(env, pool, [
      { member: subject, reputationLevel: 1 },
      { member: filler, reputationLevel: 1 },
    ]);
    const sH = handles[0]!;
    const fH = handles[1]!;

    // Cycle 0 — both pay (PAYMENT, on-time), slot 0 (== subject) claims.
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
      // ── Pool A — subject earns its FIRST POOL_COMPLETE ────────────────
      const a = await setupPoolThroughCycle0(
        keypairFromSeed("sev-a2-cooldown-authA"),
        keypairFromSeed("sev-a2-cooldown-fillerA"),
      );

      // Cycle 1 — both members' FINAL installment → SCHEMA_POOL_COMPLETE.
      // Neither has completed a pool before, so both rewards apply.
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
      const b = await setupPoolThroughCycle0(
        keypairFromSeed("sev-a2-cooldown-authB"),
        keypairFromSeed("sev-a2-cooldown-fillerB"),
      );
      const fillerB = b.fH;

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

      // 3. The completion IS recorded but NEUTRALIZED — the reputation program
      //    cannot revert here (a failed CPI would abort the contribute), so it
      //    skips the credit and flags the attestation. No credit was applied,
      //    so a later revoke reverses nothing.
      const skippedPda = attestationFor(
        env,
        b.pool.pool,
        subject.publicKey,
        ATTESTATION_SCHEMA.PoolComplete,
        attestationNonce(1, b.sH.slotIndex),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const skippedAtt = (await (env.programs.reputation.account as any).attestation.fetch(
        skippedPda,
      )) as { neutralized: boolean };
      expect(skippedAtt.neutralized, "skipped completion is recorded as neutralized").to.equal(
        true,
      );

      // 4. Differential — the FRESH co-member's final installment still earns
      //    its POOL_COMPLETE, so the skip is specific to the cooled-down subject.
      await contribute(env, { pool: b.pool, member: fillerB, cycle: 1, isFinalInstallment: true });
      const fProfile = (await fetchProfile(
        env,
        fillerB.wallet.publicKey,
      )) as unknown as ProfileLike;
      expect(fProfile.cyclesCompleted, "fresh co-member still earns its completion").to.equal(1);
      const fPda = attestationFor(
        env,
        b.pool.pool,
        fillerB.wallet.publicKey,
        ATTESTATION_SCHEMA.PoolComplete,
        attestationNonce(1, fillerB.slotIndex),
      );
      expect(await env.connection.getAccountInfo(fPda), "fresh member's POOL_COMPLETE attestation")
        .to.not.be.null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fAtt = (await (env.programs.reputation.account as any).attestation.fetch(fPda)) as {
        neutralized: boolean;
      };
      expect(fAtt.neutralized, "fresh member earns a real (non-neutralized) completion").to.equal(
        false,
      );

      // Pool still finalizes cleanly (slot 1 claims).
      await claimPayout(env, { pool: b.pool, member: fillerB, cycle: 1 });
    } catch (e) {
      // Surface the on-chain program logs litesvm attached to the error so a
      // remaining failure is diagnosable in one run rather than opaque ("6").
      const logs = (e as { logs?: string[] }).logs;
      if (logs?.length) console.error("\n[litesvm] program logs:\n" + logs.join("\n"));
      throw e;
    }
  });
});

/**
 * ADR 0012 (Phase 1) — installment prepayment.
 *
 * A member may pay a future installment AHEAD of the pool's current cycle. The
 * `contribute` cycle gate relaxes from `args.cycle == pool.current_cycle` to
 * `args.cycle >= pool.current_cycle` (keeping `== member.contributions_paid` so
 * there's no skipping, and `< cycles_total` as the cap). Pre-change, paying
 * cycle 1 while the pool sat at cycle 0 reverted `WrongCycle (6xxx)`; post-change
 * it settles, the member races ahead, and the pool still contemplates + completes.
 *
 * Proof, on the mpl_core (litesvm) path — the only CI lane that can run
 * `join_pool` end-to-end:
 *   • 2-member / 2-cycle pool, arrival order (slot i claims cycle i).
 *   • A (slot 0) pays cycle 0, then PREPAYS cycle 1 while `pool.current_cycle`
 *     is still 0 — the load-bearing assertion. A is now fully paid (2/2) and
 *     two cycles ahead of the pool, and — because cycle 1 is A's final
 *     installment — earns POOL_COMPLETE early (cycles_completed == 1).
 *   • The pool then finishes normally: B pays both cycles, slot 0 claims cycle
 *     0 (pool advances 0→1), slot 1 claims cycle 1 (pool → Completed). A never
 *     pays again; its contributions_paid stays at 2.
 *
 * Harness setup mirrors litesvm_pool_complete_cooldown: anchor the (non-
 * advancing) litesvm clock once so every contribute is on-time, fund the
 * authority + each member's USDC before the join, use seeded keypairs. Skips
 * cleanly when the build artifacts are absent (same guard as litesvm_join_pool).
 */

import { expect } from "chai";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";

import {
  claimPayout,
  contribute,
  createPool,
  createUsdcMint,
  fetchMember,
  fetchPool,
  fetchProfile,
  fundUsdc,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  keypairFromSeed,
  usdc,
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
// Same split ratios as litesvm_pool_complete_cooldown.
const INSTALLMENT = usdc(1_000n);
const CREDIT = usdc(1_480n);
const STAKE = (CREDIT * 5_000n) / 10_000n; // Iniciante (Lv1) = 50 %
const TOTAL_PER_MEMBER = 2n * INSTALLMENT + STAKE; // cyclesTotal = 2
const CYCLE_DURATION = 86_400;

// litesvm's clock does NOT auto-advance; anchor it below every next_cycle_at
// (= BASE_TS + cycle_duration) so every contribute — including the prepaid one
// — stays on-time. (Matches litesvm_parity / cooldown.)
const BASE_TS = 1_750_000_000n;

function num(x: unknown): number {
  return Number((x as { toString(): string }).toString());
}

describe("ADR 0012 Phase 1 — installment prepayment (pay ahead of current cycle) (litesvm)", function () {
  this.timeout(120_000);

  let env: LitesvmEnv;
  let available = true;
  let usdcMint: PublicKey;

  before(async function () {
    for (const p of ARTIFACTS) {
      if (!existsSync(p)) {
        console.warn(`\n[litesvm] SKIPPING prepay-ahead spec — missing ${p} (run 'anchor build').`);
        available = false;
        return;
      }
    }
    try {
      env = await setupLitesvmEnv();
      await setLitesvmUnixTs(env.svm, BASE_TS);
      usdcMint = await createUsdcMint(env, { forceFresh: true });
      await initializeProtocol(env, { usdcMint });
      await initializeReputation(env, { coreProgram: env.ids.core });
    } catch (e) {
      console.warn(
        `\n[litesvm] SKIPPING prepay-ahead spec — setup failed: ${(e as Error)?.message ?? e}`,
      );
      available = false;
    }
  });

  it("accepts a contribute for cycle > current_cycle; member races ahead and the pool still completes", async function () {
    if (!available) {
      this.skip();
      return;
    }

    try {
      const authority = keypairFromSeed("adr12-prepay-auth");
      const a = keypairFromSeed("adr12-prepay-A");
      const b = keypairFromSeed("adr12-prepay-B");

      // litesvm-native airdrops (no tx → no blockhash), like the cooldown spec.
      for (const kp of [authority, a, b]) {
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

      await fundUsdc(env, usdcMint, a.publicKey, TOTAL_PER_MEMBER);
      await fundUsdc(env, usdcMint, b.publicKey, TOTAL_PER_MEMBER);

      const [aH, bH] = await joinMembers(env, pool, [
        { member: a, reputationLevel: 1 },
        { member: b, reputationLevel: 1 },
      ]);

      // A pays cycle 0 on schedule.
      await contribute(env, { pool, member: aH!, cycle: 0 });

      // ── The load-bearing step: A PREPAYS cycle 1 while the pool is still at
      //    current_cycle 0. Pre-ADR-0012 this reverted WrongCycle. cycle 1 is
      //    A's final installment (2/2) → POOL_COMPLETE emitted early.
      await contribute(env, { pool, member: aH!, cycle: 1, isFinalInstallment: true });

      // A is now fully paid and two cycles ahead of the pool.
      const aMember = await fetchMember(env, aH!.member);
      expect(num(aMember.contributionsPaid), "A prepaid both installments").to.equal(2);

      const poolAhead = (await fetchPool(env, pool.pool)) as Record<string, unknown>;
      expect(num(poolAhead.currentCycle), "pool has NOT advanced — A is genuinely ahead").to.equal(
        0,
      );
      expect(num(poolAhead.status), "pool still Active while a member is prepaid").to.equal(1);

      // Early POOL_COMPLETE: A demonstrably kept every obligation → +1 completion.
      const aProfile = await fetchProfile(env, a.publicKey);
      expect(
        num((aProfile as { cyclesCompleted: number }).cyclesCompleted),
        "A earns POOL_COMPLETE early on the prepaid final installment",
      ).to.equal(1);

      // ── Pool finishes normally around the prepaid member ──────────────────
      await contribute(env, { pool, member: bH!, cycle: 0 });
      await claimPayout(env, { pool, member: aH!, cycle: 0 }); // slot 0 → cycle 0; advances 0→1

      const poolMid = (await fetchPool(env, pool.pool)) as Record<string, unknown>;
      expect(num(poolMid.currentCycle), "pool advanced 0 → 1 after the cycle-0 claim").to.equal(1);

      await contribute(env, { pool, member: bH!, cycle: 1, isFinalInstallment: true });
      await claimPayout(env, { pool, member: bH!, cycle: 1 }); // slot 1 → cycle 1; pool completes

      const poolDone = (await fetchPool(env, pool.pool)) as Record<string, unknown>;
      expect(num(poolDone.status), "pool reaches Completed").to.equal(2);

      // A never paid again — the prepayment was counted exactly once.
      const aFinal = await fetchMember(env, aH!.member);
      expect(num(aFinal.contributionsPaid), "A's prepaid total is unchanged (paid once)").to.equal(
        2,
      );
    } catch (e) {
      const logs = (e as { logs?: string[] }).logs;
      if (logs?.length) console.error("\n[litesvm] program logs:\n" + logs.join("\n"));
      throw e;
    }
  });
});

/**
 * ADR 0013 — behind-member catch-up (regularização) during the grace window.
 *
 * A member who missed an installment and whose pool then advanced
 * (`contributions_paid < current_cycle`) may now pay that ARREARS installment
 * — but ONLY while the current cycle's grace window is open
 * (`clock < next_cycle_at + GRACE_PERIOD_SECS`). `settle_default` requires
 * `clock >=` that same deadline, so the two windows are temporally disjoint and
 * the LEAD-001 pay-vs-settle race stays impossible — by TIME instead of STATE.
 *
 * **Arrears are classified against THEIR OWN deadline, not "late by
 * construction".** This spec previously pinned the opposite — case (a) asserted
 * `lateCount == 1` for a payment made a full `cycle_duration` BEFORE the missed
 * installment's deadline, petrifying the bug instead of catching it. The pool
 * advances on `claim_payout`, which has no lower time bound; the contemplated
 * member claims the moment the vault can fund the credit, and everyone who pays
 * after that — still inside their own window — was stamped LATE for −100
 * permanently. Cases (a) and (a2) below now pin both directions.
 *
 * Pins the ADR's validation matrix on the mpl_core (litesvm) path:
 *   • (a) catch-up DURING grace and BEFORE the missed installment's own
 *     deadline: 3-member pool, slot 2 misses cycle 0, the pool advances (slot 0
 *     claims early); slot 2 then pays cycle 0 in arrears → lands ON TIME
 *     (on_time_count bumps, late_count stays 0), and its contributions_paid
 *     climbs back to current_cycle. An early claim must not cost a punctual
 *     payer their score.
 *   • (a2) the same catch-up AFTER that deadline passes (still in grace) →
 *     LATE. Without this, (a) alone would be satisfied by never classifying
 *     anything late at all.
 *   • (d) no double-processing: settle_default on the caught-up member rejects
 *     MemberNotBehind (checked before the grace gate, so it holds mid-grace).
 *   • walk-forward: the restored member then pays the CURRENT cycle normally.
 *   • (b) catch-up AFTER grace rejects: fresh pool, same miss, clock warps past
 *     `next_cycle_at + GRACE` → the same arrears contribute reverts WrongCycle
 *     (settle territory now — the time-disjointness boundary).
 *   • (c) settle-succeeds-after-grace is NOT re-pinned here — that path is
 *     unchanged by ADR 0013 and already covered in this lane by
 *     `litesvm_settle_default_real_pool.spec.ts`.
 *
 * Economics: credit (1_400) ≤ 2 payers' float (2 × 740) so the cycle-0 claim
 * clears the waterfall with only 2 of 3 members paid — that's what lets the
 * pool advance while slot 2 is behind. Viability holds (1_400 ≤ 2_220).
 *
 * Harness setup mirrors litesvm_prepay_ahead / cooldown: anchor the
 * (non-advancing) litesvm clock once, litesvm-native airdrops, fund USDC before
 * joins, seeded keypairs, fresh blockhash per pool. GRACE here is the vanilla
 * 604_800 (7d) — CI's `anchor build` has no devnet-canary feature. Skips
 * cleanly when build artifacts are absent.
 */

import { expect } from "chai";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";

import { ATTESTATION_SCHEMA } from "@roundfi/sdk";

import {
  attestationFor,
  attestationNonce,
  claimPayout,
  contribute,
  createPool,
  createUsdcMint,
  fetchMember,
  fetchPool,
  fundUsdc,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  keypairFromSeed,
  settleDefault,
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

const INSTALLMENT = usdc(1_000n);
// ≤ 2 payers' float (2 × 740) so the pool can advance with one member behind;
// viability-passing (≤ 3 × 1_000 × 74% = 2_220).
const CREDIT = usdc(1_400n);
const STAKE = (CREDIT * 5_000n) / 10_000n; // Lv1 = 50%
const TOTAL_PER_MEMBER = 3n * INSTALLMENT + STAKE;
const CYCLE_DURATION = 86_400;
// CI's litesvm build is vanilla (no devnet-canary) → 7-day grace.
const GRACE_PERIOD_SECS = 604_800n;

// litesvm's clock does NOT auto-advance; anchor it below next_cycle_at so the
// payers' cycle-0 contributes are on-time. (Matches litesvm_prepay_ahead.)
const BASE_TS = 1_750_000_000n;

function num(x: unknown): number {
  return Number((x as { toString(): string }).toString());
}

describe("ADR 0013 — behind-member catch-up during grace (litesvm)", function () {
  this.timeout(180_000);

  let env: LitesvmEnv;
  let available = true;
  let usdcMint: PublicKey;

  before(async function () {
    for (const p of ARTIFACTS) {
      if (!existsSync(p)) {
        console.warn(`\n[litesvm] SKIPPING catch-up spec — missing ${p} (run 'anchor build').`);
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
        `\n[litesvm] SKIPPING catch-up spec — setup failed: ${(e as Error)?.message ?? e}`,
      );
      available = false;
    }
  });

  // 3×3 pool; the slot-2 member SKIPS cycle 0 while the other two pay and
  // slot 0 claims — the pool advances to cycle 1 leaving slot 2 behind.
  async function setupBehindMember(seedTag: string): Promise<{
    pool: PoolHandle;
    behind: MemberHandle;
  }> {
    env.svm.expireBlockhash();
    const authority = keypairFromSeed(`adr13-${seedTag}-auth`);
    const m0 = keypairFromSeed(`adr13-${seedTag}-m0`);
    const m1 = keypairFromSeed(`adr13-${seedTag}-m1`);
    const m2 = keypairFromSeed(`adr13-${seedTag}-m2`);
    for (const kp of [authority, m0, m1, m2]) {
      env.svm.airdrop(kp.publicKey.toBase58(), 100_000_000_000n);
    }
    const pool = await createPool(env, {
      authority,
      usdcMint,
      membersTarget: 3,
      installmentAmount: INSTALLMENT,
      creditAmount: CREDIT,
      cyclesTotal: 3,
      cycleDurationSec: CYCLE_DURATION,
    });
    for (const kp of [m0, m1, m2]) {
      await fundUsdc(env, usdcMint, kp.publicKey, TOTAL_PER_MEMBER);
    }
    const handles = await joinMembers(env, pool, [
      { member: m0, reputationLevel: 1 },
      { member: m1, reputationLevel: 1 },
      { member: m2, reputationLevel: 1 },
    ]);
    const h0 = handles[0]!;
    const h1 = handles[1]!;
    const h2 = handles[2]!;

    // Cycle 0 — slots 0+1 pay, slot 2 MISSES; slot 0 claims (2 × 740 ≥ 1_400).
    await contribute(env, { pool, member: h0, cycle: 0 });
    await contribute(env, { pool, member: h1, cycle: 0 });
    await claimPayout(env, { pool, member: h0, cycle: 0 });

    const p = (await fetchPool(env, pool.pool)) as Record<string, unknown>;
    expect(num(p.currentCycle), "pool advanced to cycle 1 with slot 2 behind").to.equal(1);
    const m = await fetchMember(env, h2.member);
    expect(num(m.contributionsPaid), "slot 2 is genuinely behind (0 < 1)").to.equal(0);

    return { pool, behind: h2 };
  }

  it("(a)+(d): catch-up before the missed installment's deadline lands ON TIME, restores the member, and cannot be settled", async function () {
    if (!available) {
      this.skip();
      return;
    }
    try {
      const { pool, behind } = await setupBehindMember("grace");

      // (a) The load-bearing call: pay the MISSED cycle 0 while current_cycle
      // is 1 and grace is open (clock < next_cycle_at + GRACE). Pre-ADR-0013
      // this reverted WrongCycle.
      //
      // The clock has not moved since the pool opened — slot 2 is paying a full
      // cycle_duration BEFORE cycle 0's own deadline. It is only "in arrears"
      // because slot 0 claimed the moment two payers had funded the credit,
      // advancing the pool off the clock. Punctual payment, so: ON TIME, and
      // the attestation schema is Payment (the schema id is in the PDA seeds,
      // so the helper's choice has to match what the handler emits).
      await contribute(env, {
        pool,
        member: behind,
        cycle: 0,
        schemaId: ATTESTATION_SCHEMA.Payment,
      });

      const m = await fetchMember(env, behind.member);
      expect(num(m.contributionsPaid), "arrears installment recorded").to.equal(1);
      expect(num(m.lateCount), "paid before its own deadline — no LATE").to.equal(0);
      expect(num(m.onTimeCount), "punctual arrears earns on-time credit").to.equal(1);

      const attPda = attestationFor(
        env,
        pool.pool,
        behind.wallet.publicKey,
        ATTESTATION_SCHEMA.Payment,
        attestationNonce(0, behind.slotIndex),
      );
      expect(await env.connection.getAccountInfo(attPda), "PAYMENT attestation minted").to.not.be
        .null;

      // (d) No double-processing: the caught-up member is payable-current again
      // (contributions_paid == current_cycle), so settle_default rejects
      // MemberNotBehind — checked BEFORE the grace gate, so it holds right now
      // (mid-grace) and the two paths can never both act on the same miss.
      let threw = false;
      try {
        await settleDefault(env, { pool, defaulter: behind, cycle: 1 });
      } catch (e) {
        threw = true;
        const err = e as { logs?: string[]; message?: string };
        const haystack = [...(err.logs ?? []), err.message ?? "", String(e)].join("\n");
        expect(haystack).to.match(
          /MemberNotBehind/,
          `expected MemberNotBehind on a caught-up member, got:\n${haystack}`,
        );
      }
      expect(threw, "settling a caught-up member must reject").to.equal(true);

      // Walk-forward: the restored member pays the CURRENT cycle normally.
      await contribute(env, { pool, member: behind, cycle: 1 });
      const m2 = await fetchMember(env, behind.member);
      expect(num(m2.contributionsPaid), "current-cycle payment after catch-up").to.equal(2);
    } catch (e) {
      const logs = (e as { logs?: string[] }).logs;
      if (logs?.length) console.error("\n[litesvm] program logs:\n" + logs.join("\n"));
      throw e;
    }
  });

  it("(a2): catch-up AFTER the missed installment's own deadline is still LATE", async function () {
    if (!available) {
      this.skip();
      return;
    }
    try {
      const { pool, behind } = await setupBehindMember("latecatchup");

      // Derive cycle 0's deadline exactly the way the handler does:
      //   deadline(c) = next_cycle_at − (current_cycle − c) × cycle_duration
      // Mirroring the on-chain formula here is deliberate — if the handler's
      // derivation ever changes, this test stops agreeing with it and says so.
      const p = (await fetchPool(env, pool.pool)) as Record<string, unknown>;
      const nextCycleAt = BigInt(String(p.nextCycleAt));
      const cyclesBehind = BigInt(num(p.currentCycle)); // cycle 0 → current − 0
      const deadline0 = nextCycleAt - cyclesBehind * BigInt(CYCLE_DURATION);

      // One second past cycle 0's deadline — genuinely late — while the
      // CURRENT cycle's grace is still wide open, so the arrears path is still
      // reachable and we are testing classification, not the window.
      const paidAt = deadline0 + 1n;
      expect(paidAt < nextCycleAt + GRACE_PERIOD_SECS, "still inside the arrears window").to.equal(
        true,
      );
      await setLitesvmUnixTs(env.svm, paidAt);

      await contribute(env, {
        pool,
        member: behind,
        cycle: 0,
        schemaId: ATTESTATION_SCHEMA.Late,
      });

      const m = await fetchMember(env, behind.member);
      expect(num(m.contributionsPaid), "arrears installment recorded").to.equal(1);
      expect(num(m.lateCount), "past its own deadline — LATE").to.equal(1);
      expect(num(m.onTimeCount), "no on-time credit for a genuinely missed deadline").to.equal(0);

      const attPda = attestationFor(
        env,
        pool.pool,
        behind.wallet.publicKey,
        ATTESTATION_SCHEMA.Late,
        attestationNonce(0, behind.slotIndex),
      );
      expect(await env.connection.getAccountInfo(attPda), "LATE attestation minted").to.not.be.null;

      // Restore the clock for any later case in this file.
      await setLitesvmUnixTs(env.svm, BASE_TS);
    } catch (e) {
      const logs = (e as { logs?: string[] }).logs;
      if (logs?.length) console.error("\n[litesvm] program logs:\n" + logs.join("\n"));
      throw e;
    }
  });

  it("(b): after grace elapses the arrears path closes — WrongCycle (settle territory)", async function () {
    if (!available) {
      this.skip();
      return;
    }
    try {
      const { pool, behind } = await setupBehindMember("postgrace");

      // Warp PAST the current cycle's grace deadline — settle territory.
      const p = (await fetchPool(env, pool.pool)) as Record<string, unknown>;
      const deadline = BigInt(String(p.nextCycleAt)) + GRACE_PERIOD_SECS;
      await setLitesvmUnixTs(env.svm, deadline + 1n);

      // (b) The catch-up window is CLOSED: the same arrears contribute that
      // works in-grace now reverts WrongCycle — the time-disjointness boundary
      // that keeps the LEAD-001 pay-vs-settle race impossible.
      let threw = false;
      try {
        await contribute(env, {
          pool,
          member: behind,
          cycle: 0,
          schemaId: ATTESTATION_SCHEMA.Late,
        });
      } catch (e) {
        threw = true;
        const err = e as { logs?: string[]; message?: string };
        const haystack = [...(err.logs ?? []), err.message ?? "", String(e)].join("\n");
        expect(haystack).to.match(
          /WrongCycle/,
          `expected WrongCycle for post-grace arrears, got:\n${haystack}`,
        );
      }
      expect(threw, "post-grace catch-up must reject").to.equal(true);
    } catch (e) {
      const logs = (e as { logs?: string[] }).logs;
      if (logs?.length) console.error("\n[litesvm] program logs:\n" + logs.join("\n"));
      throw e;
    }
  });
});

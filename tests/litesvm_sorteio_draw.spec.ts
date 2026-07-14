/**
 * Sorteio draw machinery E2E (ADR pool_v2) — litesvm, CI-executed.
 *
 * The full arc of a sorteio pool against the real programs:
 *
 *   A. Payouts are FAIL-CLOSED before the draw: with the pool full,
 *      Active, and cycle-0 contributions in, `claim_payout` without the
 *      DrawResult fails `DrawRequired` — a sorteio pool can never
 *      silently behave as arrival-order.
 *   B. `finalize_draw` (permissionless) mints the DrawResult exactly
 *      once: the stored order is a bijection over `0..n` (re-derivable
 *      from the stored seed — auditability), and a second finalize
 *      collides on the PDA `init`, so nobody can re-roll an unfavorable
 *      permutation. The cycle-0 window is re-anchored to a full
 *      duration (SEV-053 pattern).
 *   C. The seat→cycle translation gates payouts: the member whose drawn
 *      cycle is NOT 0 is rejected (`NotYourPayoutSlot`), the drawn
 *      cycle-0 member claims successfully with the DrawResult appended
 *      as the first remaining account, and the cycle advances. The
 *      cycle-0 claim passing also means the Shield-1 seed-draw
 *      retention gate held under a *drawn* order — the ADR-review
 *      "prove the early-slot worst case with numbers" obligation,
 *      encoded as a test (all members here stake at the same level, so
 *      whoever is drawn first IS the worst case for this pool shape).
 *
 * ArrivalOrder pools are the untouched control: every other litesvm
 * spec (join_pool lifecycle, parity presets, stall re-anchor) claims
 * payouts with NO remaining account — those staying green pins the
 * unchanged ABI for existing pools.
 *
 * Runs in the `litesvm · mpl-core path` lane via the `litesvm_*.spec.ts`
 * glob (SEV-053 lesson: program regressions live in lanes that execute
 * on every PR). Skips cleanly when build artifacts are absent.
 */

import { expect } from "chai";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";

import { ATTESTATION_SCHEMA, ORDERING_POLICY } from "@roundfi/sdk";

import {
  claimPayout,
  contribute,
  createPool,
  createUsdcMint,
  fetchDraw,
  fetchMember,
  fetchPool,
  finalizeDraw,
  fundUsdc,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  memberKeypairs,
  usdc,
  type MemberHandle,
  type PoolHandle,
} from "./_harness/index.js";
import { setLitesvmUnixTs, setupLitesvmEnv, type LitesvmEnv } from "./_harness/litesvm.js";

const MEMBERS_TARGET = 3;
const CYCLES_TOTAL = 3;
const CYCLE_DURATION_SEC = 86_400;
// SEV-031 viability with protocol defaults (same shape as the stall
// re-anchor spec): 3 × 2000 × 0.74 = 4440 ≥ 2200 ✓.
const INSTALLMENT_BASE = usdc(2_000n);
const CREDIT_BASE = usdc(2_200n);

// litesvm's clock doesn't advance on its own; anchor it once so every
// contribute/claim lands inside the cycle-0 window.
const BASE_TS = 1_900_000_000n; // ~2030

const ARTIFACTS = [
  "target/idl/roundfi_core.json",
  "target/deploy/roundfi_core.so",
  "target/deploy/roundfi_reputation.so",
  "target/deploy/mpl_core.so",
].map((p) => resolve(process.cwd(), p));

describe("sorteio draw machinery (ADR pool_v2) — E2E (litesvm)", function () {
  this.timeout(120_000);

  let env: LitesvmEnv;
  let litesvmAvailable = true;
  let usdcMint: PublicKey;

  const authority = Keypair.generate();
  const memberKps = memberKeypairs(MEMBERS_TARGET, "litesvm_sorteio_draw");

  let pool: PoolHandle;
  let members: MemberHandle[] = [];
  let drawPda: PublicKey;
  /** order[seat] == payout cycle, straight from the fetched DrawResult. */
  let order: number[] = [];

  before(async function () {
    for (const p of ARTIFACTS) {
      if (!existsSync(p)) {
        console.warn(
          `\n[litesvm] SKIPPING — missing ${p} (run 'anchor build' + dump mpl_core.so).`,
        );
        litesvmAvailable = false;
        return;
      }
    }
    try {
      env = await setupLitesvmEnv();
    } catch (e) {
      console.warn(`\n[litesvm] SKIPPING — setup failed: ${(e as Error)?.message ?? e}`);
      litesvmAvailable = false;
      return;
    }

    await setLitesvmUnixTs(env.svm, BASE_TS);
    usdcMint = await createUsdcMint(env);
    await initializeProtocol(env, { usdcMint });
    await initializeReputation(env, { coreProgram: env.ids.core });

    pool = await createPool(env, {
      authority,
      usdcMint,
      membersTarget: MEMBERS_TARGET,
      installmentAmount: INSTALLMENT_BASE,
      creditAmount: CREDIT_BASE,
      cyclesTotal: CYCLES_TOTAL,
      cycleDurationSec: CYCLE_DURATION_SEC,
      orderingPolicy: ORDERING_POLICY.Sorteio,
    });

    members = await joinMembers(env, pool, [
      { member: memberKps[0]!, reputationLevel: 1 },
      { member: memberKps[1]!, reputationLevel: 1 },
      { member: memberKps[2]!, reputationLevel: 1 },
    ]);

    for (const m of members) {
      await fundUsdc(env, usdcMint, m.wallet.publicKey, INSTALLMENT_BASE * 3n);
      // Contributions are seat-agnostic (cycle == contributions_paid) —
      // they must work on an UNDRAWN sorteio pool: only payouts wait.
      await contribute(env, { pool, member: m, cycle: 0, schemaId: ATTESTATION_SCHEMA.Payment });
    }
  });

  it("A. payouts are fail-closed before the draw (DrawRequired)", async function () {
    if (!litesvmAvailable) return this.skip();
    let err: unknown = null;
    try {
      // No drawResult appended AND no draw finalized — both missing.
      await claimPayout(env, { pool, member: members[0]!, cycle: 0 });
    } catch (e) {
      err = e;
    }
    expect(err, "undrawn sorteio pool must not pay out").to.not.equal(null);
    expect(String((err as Error)?.message ?? err)).to.match(/DrawRequired/i);
  });

  it("B. finalize_draw mints a bijective, seed-auditable order exactly once", async function () {
    if (!litesvmAvailable) return this.skip();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = (await fetchPool(env, pool.pool)) as any;
    const nextCycleAtBefore = BigInt(before.nextCycleAt.toString());

    drawPda = await finalizeDraw(env, { pool });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const draw = (await fetchDraw(env, pool.pool)) as any;
    expect(draw.membersTarget).to.equal(MEMBERS_TARGET);
    expect(draw.pool.toBase58()).to.equal(pool.pool.toBase58());

    const seed: number[] = Array.from(draw.seed as number[]);
    expect(seed.length).to.equal(32);
    expect(
      seed.some((b) => b !== 0),
      "stored seed must be non-trivial (auditability of the permutation)",
    ).to.equal(true);

    order = Array.from(draw.order as number[]).slice(0, MEMBERS_TARGET);
    const seen = new Set(order);
    expect(seen.size, "no cycle assigned twice").to.equal(MEMBERS_TARGET);
    for (const c of order) {
      expect(c, "cycle in range").to.be.gte(0).and.lt(MEMBERS_TARGET);
    }

    // SEV-053-pattern re-anchor: full cycle-0 window from the draw.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = (await fetchPool(env, pool.pool)) as any;
    const nextCycleAtAfter = BigInt(after.nextCycleAt.toString());
    expect(nextCycleAtAfter >= nextCycleAtBefore, "window never shrinks").to.equal(true);
    expect(
      nextCycleAtAfter >= BASE_TS + BigInt(CYCLE_DURATION_SEC),
      "cycle 0 gets a full window from the draw",
    ).to.equal(true);

    // Single-shot: re-rolling the permutation must be impossible.
    let err: unknown = null;
    try {
      await finalizeDraw(env, { pool });
    } catch (e) {
      err = e;
    }
    expect(err, "second finalize_draw must collide on the PDA init").to.not.equal(null);
  });

  it("C. seat→cycle translation gates the payout to the drawn member only", async function () {
    if (!litesvmAvailable) return this.skip();

    const drawnIdx = order.findIndex((c) => c === 0);
    const notDrawnIdx = order.findIndex((c) => c !== 0);
    expect(drawnIdx, "exactly one seat draws cycle 0").to.be.gte(0);
    expect(notDrawnIdx).to.be.gte(0);

    // Wrong member — drawn to a later cycle — is rejected even WITH the
    // DrawResult appended.
    let err: unknown = null;
    try {
      await claimPayout(env, {
        pool,
        member: members[notDrawnIdx]!,
        cycle: 0,
        drawResult: drawPda,
      });
    } catch (e) {
      err = e;
    }
    expect(err, "non-drawn member must not claim cycle 0").to.not.equal(null);
    expect(String((err as Error)?.message ?? err)).to.match(/NotYourPayoutSlot/i);

    // The drawn member claims cycle 0. This passing also proves the
    // Shield-1 seed-draw retention gate held under the drawn order (it
    // runs inside cycle-0 claim_payout) — the early-slot worst case for
    // this pool shape, since every member staked at the same level.
    await claimPayout(env, {
      pool,
      member: members[drawnIdx]!,
      cycle: 0,
      drawResult: drawPda,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (await fetchMember(env, members[drawnIdx]!.member)) as any;
    expect(m.paidOut, "drawn member is paid out").to.equal(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await fetchPool(env, pool.pool)) as any;
    expect(p.currentCycle, "cycle advanced 0 → 1").to.equal(1);
  });
});

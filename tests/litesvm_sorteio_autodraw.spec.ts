/**
 * Sorteio AUTO-DRAW at activation (ADR pool_v2 follow-up) — litesvm,
 * CI-executed.
 *
 * The activating join of a sorteio pool now mints the DrawResult
 * atomically (the last joiner's own tx draws the payout order), so no
 * member ever pays a separate transaction — the founder's "tem como ser
 * sem o botão?" ask. The DrawResult rides as the FIRST remaining
 * account of join_pool; ArrivalOrder joins stay byte-identical (every
 * other spec joins with no remaining accounts — those staying green pin
 * the unchanged ABI).
 *
 *   A. Auto path (the app's default): every sorteio join appends the
 *      draw PDA. Non-activating joins IGNORE it (no draw account is
 *      created early); the ACTIVATING join creates it — pool flips
 *      Active AND the order exists in the same transaction, bijective
 *      over 0..n. A finalize_draw afterwards COLLIDES (single-shot is
 *      preserved — nobody re-rolls the auto-drawn order).
 *   B. Backstop path (stale client / pools filled pre-upgrade, e.g.
 *      devnet pool9): the activating join WITHOUT the account still
 *      activates the pool — undrawn — and the permissionless
 *      finalize_draw then works exactly as before.
 *
 * Runs in the `litesvm · mpl-core path` lane via the `litesvm_*.spec.ts`
 * glob (SEV-053 lesson). Skips cleanly when build artifacts are absent.
 */

import { expect } from "chai";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";

import { ORDERING_POLICY } from "@roundfi/sdk";

import {
  createPool,
  createUsdcMint,
  drawResultFor,
  fetchDraw,
  fetchPool,
  finalizeDraw,
  initializeProtocol,
  initializeReputation,
  joinPool,
  memberKeypairs,
  usdc,
  type PoolHandle,
} from "./_harness/index.js";
import { setLitesvmUnixTs, setupLitesvmEnv, type LitesvmEnv } from "./_harness/litesvm.js";

const MEMBERS_TARGET = 3;
const CYCLES_TOTAL = 3;
const CYCLE_DURATION_SEC = 86_400;
const INSTALLMENT = usdc(2_000n);
const CREDIT = usdc(2_200n); // SEV-031-viable: 3 × 2000 × 0.74 = 4440 ≥ 2200
const BASE_TS = 1_900_000_000n;

const ARTIFACTS = [
  "target/idl/roundfi_core.json",
  "target/deploy/roundfi_core.so",
  "target/deploy/roundfi_reputation.so",
  "target/deploy/mpl_core.so",
].map((p) => resolve(process.cwd(), p));

describe("sorteio auto-draw at activation (ADR pool_v2) — litesvm", function () {
  this.timeout(120_000);

  let env: LitesvmEnv;
  let litesvmAvailable = true;
  let usdcMint: PublicKey;

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
  });

  // Distinct pool per case via a fresh authority keypair.
  async function newSorteioPool(): Promise<PoolHandle> {
    return createPool(env, {
      authority: Keypair.generate(),
      usdcMint,
      membersTarget: MEMBERS_TARGET,
      installmentAmount: INSTALLMENT,
      creditAmount: CREDIT,
      cyclesTotal: CYCLES_TOTAL,
      cycleDurationSec: CYCLE_DURATION_SEC,
      orderingPolicy: ORDERING_POLICY.Sorteio,
    });
  }

  it("A. the activating join auto-draws; earlier joins don't; finalize collides after", async function () {
    if (!litesvmAvailable) return this.skip();

    const pool = await newSorteioPool();
    const drawPda = drawResultFor(env, pool.pool);
    const kps = memberKeypairs(MEMBERS_TARGET, "litesvm_autodraw_A");

    // Joins 0 and 1 append the draw account (the app always does on
    // sorteio pools) — but they must NOT create it: only activation draws.
    for (let i = 0; i < 2; i++) {
      await joinPool(env, pool, {
        member: kps[i]!,
        slotIndex: i,
        reputationLevel: 1,
        drawResult: drawPda,
      });
      expect(await fetchDraw(env, pool.pool), `no draw after join ${i}`).to.equal(null);
    }

    // The ACTIVATING join: pool flips Active AND the order is drawn in
    // the same transaction — no button, no extra tx.
    await joinPool(env, pool, {
      member: kps[2]!,
      slotIndex: 2,
      reputationLevel: 1,
      drawResult: drawPda,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await fetchPool(env, pool.pool)) as any;
    expect(p.status, "pool active at the last join").to.equal(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const draw = (await fetchDraw(env, pool.pool)) as any;
    expect(draw, "DrawResult minted by the activating join").to.not.equal(null);
    expect(draw.membersTarget).to.equal(MEMBERS_TARGET);
    expect(draw.pool.toBase58()).to.equal(pool.pool.toBase58());

    const seed: number[] = Array.from(draw.seed as number[]);
    expect(
      seed.some((b) => b !== 0),
      "stored seed non-trivial (auditability)",
    ).to.equal(true);

    const order = Array.from(draw.order as number[]).slice(0, MEMBERS_TARGET);
    expect(new Set(order).size, "order is a bijection over 0..n").to.equal(MEMBERS_TARGET);
    for (const c of order) expect(c).to.be.gte(0).and.lt(MEMBERS_TARGET);

    // Single-shot survives the auto path: the backstop can't re-roll.
    let err: unknown = null;
    try {
      await finalizeDraw(env, { pool });
    } catch (e) {
      err = e;
    }
    expect(err, "finalize_draw after auto-draw must collide").to.not.equal(null);
  });

  it("B. activating join WITHOUT the account degrades to the finalize_draw backstop", async function () {
    if (!litesvmAvailable) return this.skip();

    const pool = await newSorteioPool();
    const kps = memberKeypairs(MEMBERS_TARGET, "litesvm_autodraw_B");

    // Nobody appends the draw account (stale client / pre-upgrade shape:
    // exactly devnet pool9, which filled before this feature deployed).
    for (let i = 0; i < MEMBERS_TARGET; i++) {
      await joinPool(env, pool, { member: kps[i]!, slotIndex: i, reputationLevel: 1 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await fetchPool(env, pool.pool)) as any;
    expect(p.status, "activation is NEVER blocked by a missing draw account").to.equal(1);
    expect(await fetchDraw(env, pool.pool), "pool activates undrawn").to.equal(null);

    // The permissionless backstop still mints the order — today's flow.
    await finalizeDraw(env, { pool });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const draw = (await fetchDraw(env, pool.pool)) as any;
    expect(draw, "backstop draw works").to.not.equal(null);
    const order = Array.from(draw.order as number[]).slice(0, MEMBERS_TARGET);
    expect(new Set(order).size).to.equal(MEMBERS_TARGET);
  });
});

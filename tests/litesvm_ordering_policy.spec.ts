/**
 * Ordering-policy plumbing (ADR pool_v2) — litesvm, CI-executed.
 *
 * PR-2 of the contemplation-order work ships plumbing only, with a
 * FAIL-CLOSED gate: `Pool.ordering_policy` exists (1 byte carved from the
 * struct padding — no migration; pre-existing pools read 0), `create_pool`
 * takes the trailing arg, and ONLY ArrivalOrder (0) is accepted until the
 * sorteio draw machinery lands. This spec pins all three facts against the
 * real program so the gate can't silently drift:
 *
 *   A. Default create (policy 0) succeeds and `fetchPool` exposes
 *      `orderingPolicy == 0` — today's pools keep today's behavior.
 *   B. `ORDERING_POLICY.Sorteio` (1) is REJECTED with
 *      `OrderingPolicyUnsupported` — declared id, fail-closed. The PR that
 *      ships the draw machinery flips this case to a positive test.
 *   C. An undeclared id (7) is rejected the same way — the gate is a
 *      whitelist of one, not a `<= Sorteio` range check that would let a
 *      future id slip in unbuilt (the SEV-053-erratum drift class).
 *
 * Runs in the `litesvm · mpl-core path` lane via the `litesvm_*.spec.ts`
 * glob — per the SEV-053 lesson, program regressions live in lanes that
 * actually execute on every PR. Skips cleanly when build artifacts are
 * absent (same guard as litesvm_join_pool.spec.ts).
 */

import { expect } from "chai";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";

import { ORDERING_POLICY } from "@roundfi/sdk";

import { createPool, createUsdcMint, fetchPool, initializeProtocol } from "./_harness/index.js";
import { setupLitesvmEnv, type LitesvmEnv } from "./_harness/litesvm.js";

const ARTIFACTS = [
  "target/idl/roundfi_core.json",
  "target/deploy/roundfi_core.so",
  "target/deploy/mpl_core.so",
].map((p) => resolve(process.cwd(), p));

describe("ordering policy (ADR pool_v2) — plumbing + fail-closed gate (litesvm)", function () {
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

    usdcMint = await createUsdcMint(env);
    await initializeProtocol(env, { usdcMint });
  });

  it("A. default create exposes orderingPolicy == ArrivalOrder (0)", async function () {
    if (!litesvmAvailable) return this.skip();
    const pool = await createPool(env, { authority: Keypair.generate(), usdcMint });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await fetchPool(env, pool.pool)) as any;
    expect(p.orderingPolicy, "pre-draw pools run under today's arrival order").to.equal(
      ORDERING_POLICY.ArrivalOrder,
    );
  });

  it("B. Sorteio (1) is fail-closed until the draw machinery ships", async function () {
    if (!litesvmAvailable) return this.skip();
    let err: unknown = null;
    try {
      await createPool(env, {
        authority: Keypair.generate(),
        usdcMint,
        orderingPolicy: ORDERING_POLICY.Sorteio,
      });
    } catch (e) {
      err = e;
    }
    expect(err, "sorteio must be rejected, not silently arrival-ordered").to.not.equal(null);
    expect(String((err as Error)?.message ?? err)).to.match(/OrderingPolicyUnsupported/i);
  });

  it("C. an undeclared policy id (7) is rejected by the same gate", async function () {
    if (!litesvmAvailable) return this.skip();
    let err: unknown = null;
    try {
      await createPool(env, { authority: Keypair.generate(), usdcMint, orderingPolicy: 7 });
    } catch (e) {
      err = e;
    }
    expect(err, "unknown ids must NOT clear the gate").to.not.equal(null);
    expect(String((err as Error)?.message ?? err)).to.match(/OrderingPolicyUnsupported/i);
  });
});

/**
 * Ordering-policy plumbing (ADR pool_v2) — litesvm, CI-executed.
 *
 * `Pool.ordering_policy` is 1 byte carved from the struct padding (no
 * migration; pre-existing pools read 0 = ArrivalOrder) and `create_pool`
 * takes the trailing arg, validated as a WHITELIST. This spec pins the
 * gate against the real program so it can't silently drift:
 *
 *   A. Default create (policy 0) succeeds and `fetchPool` exposes
 *      `orderingPolicy == 0` — today's pools keep today's behavior.
 *   B. `ORDERING_POLICY.Sorteio` (1) is ACCEPTED and exposed (the draw
 *      machinery shipped — payouts on such a pool require the finalized
 *      DrawResult; the E2E lives in litesvm_sorteio_draw.spec.ts).
 *   C. An undeclared id (7) is rejected — the gate stays a whitelist,
 *      not a `<= Sorteio` range check that would let a future id
 *      (reputação, lance) slip in unbuilt (the SEV-053-erratum drift
 *      class).
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

  it("B. Sorteio (1) is accepted and exposed on the account", async function () {
    if (!litesvmAvailable) return this.skip();
    const pool = await createPool(env, {
      authority: Keypair.generate(),
      usdcMint,
      orderingPolicy: ORDERING_POLICY.Sorteio,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await fetchPool(env, pool.pool)) as any;
    expect(p.orderingPolicy, "sorteio pool records its policy").to.equal(ORDERING_POLICY.Sorteio);
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

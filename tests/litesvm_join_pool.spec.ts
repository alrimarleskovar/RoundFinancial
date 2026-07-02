/**
 * SEV-012 — mpl_core-path lifecycle on litesvm.
 *
 * The decisive test that `solana-bankrun` cannot run: the
 * `join_pool`/`create_pool` Metaplex-Core CPI path. litesvm loads the
 * current mainnet SBFv2 `mpl_core.so` (bankrun's `solana-program-test
 * 1.18` panics on it), so the full pool-formation lifecycle — each step
 * minting an mpl_core asset via the CreateV2 CPI — runs end-to-end on
 * the repo's anchor 0.30.1 via a thin custom Provider + v1→v2 tx bridge
 * (see `tests/_harness/litesvm.ts`).
 *
 *   create_pool → mints the pool Collection NFT (mpl_core CreateV2)
 *   join_pool   → mints the member position NFT (mpl_core CreateV2)
 *
 * Prereqs (the litesvm-mpl-core CI lane provides these):
 *   - `anchor build` → target/idl + target/deploy
 *   - `solana program dump -u mainnet-beta <mpl_core> target/deploy/mpl_core.so`
 *   - devDeps `litesvm` + `@solana/transactions`
 *
 * If the prereqs are absent (e.g. a plain `pnpm install` without a build)
 * the suite SKIPS with a clear message rather than failing.
 */

import { expect } from "chai";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  createUsdcMint,
  initializeProtocol,
  createPool,
  joinMembers,
  joinPool,
  positionAssetPda,
} from "./_harness/index.js";
import { setupLitesvmEnv, type LitesvmEnv } from "./_harness/litesvm.js";

const ARTIFACTS = [
  "target/idl/roundfi_core.json",
  "target/deploy/roundfi_core.so",
  "target/deploy/mpl_core.so",
].map((p) => resolve(process.cwd(), p));

describe("SEV-012 — mpl_core-path lifecycle on litesvm", function () {
  this.timeout(120_000);

  let env: LitesvmEnv;
  let litesvmAvailable = true;

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
    }
  });

  it("runs create_pool + join_pool (both mpl_core CreateV2 CPIs) end-to-end", async function () {
    if (!litesvmAvailable) {
      this.skip();
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = env as any;

    const usdcMint = await createUsdcMint(e, { forceFresh: true });
    await initializeProtocol(e, { usdcMint });

    // create_pool CPIs mpl_core to mint the pool Collection NFT. A green
    // result is the SEV-012 gold standard (the CPI bankrun can't run).
    const { Keypair } = await import("@solana/web3.js");
    const authority = Keypair.generate();
    const pool = await createPool(e, { authority, usdcMint });
    expect(pool, "createPool should return a pool handle").to.exist;

    // join_pool CPIs mpl_core to mint the member position NFT. The asset
    // is the program-derived [b"position-asset", pool, slot] PDA, signed
    // via invoke_signed — this run against the REAL mpl_core.so is the
    // proof that CreateV2 accepts a PDA asset with no client co-signer.
    const member = Keypair.generate();
    const handles = await joinMembers(e, pool, [{ member, reputationLevel: 1 }]);
    expect(handles.length, "one member joined").to.equal(1);

    // Pre-funding griefing regression: the asset PDA is deterministic, so
    // anyone can compute it and send it dust; mpl-core's raw system
    // create_account fails AccountAlreadyInUse on any pre-funded target.
    // join_pool must drain the PDA's lamports (invoke_signed system
    // transfer) before the CreateV2 CPI — without the drain this join
    // reverts and the slot is bricked forever.
    const griefedSlot = 1;
    const [griefedAsset] = positionAssetPda(e.ids.core, pool.pool, griefedSlot);
    await e.connection.requestAirdrop(griefedAsset, 1); // the 1-lamport grief
    const member2 = Keypair.generate();
    const h2 = await joinPool(e, pool, {
      member: member2,
      slotIndex: griefedSlot,
      reputationLevel: 1,
    });
    expect(h2.nftAsset.toBase58(), "griefed slot still mints at the derived PDA").to.equal(
      griefedAsset.toBase58(),
    );
  });
});

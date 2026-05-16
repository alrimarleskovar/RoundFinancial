/**
 * Security — audit error path coverage (Step 5e / 5).
 *
 * The Critical/High audit fixes from PRs #122-#127 introduced six new
 * error codes that no existing spec exercises. This file adds one
 * minimal failing-path case per code so the guard rails are
 * demonstrably wired up — not just present in `error.rs`.
 *
 * Errors covered:
 *
 *   1. MetadataUriInvalidScheme — `join_pool` rejects a URI whose scheme
 *      is not in {https, ipfs, ar}. Probed with "ftp://".
 *
 *   2. ReputationLevelMismatch — `join_pool` checks the asserted
 *      `reputation_level` against the on-chain `ReputationProfile`.
 *      Probed with a fresh wallet (uninit profile = trusted level 1)
 *      asserting level 2.
 *
 *   3. HarvestSlippageExceeded — `harvest_yield` rejects when realized
 *      yield falls below `min_realized_usdc`. Probed on a freshly
 *      initialized mock vault (zero surplus) with `min_realized=1` so
 *      `0 >= 1` is false → reject.
 *
 *   4. AssetTransferIncomplete — `escape_valve_buy` post-CPI assertion
 *      that the position NFT's owner equals the buyer after the
 *      Metaplex Core transfer. Skipped: cannot fail on real
 *      `mpl-core` (which always either succeeds with the new owner or
 *      reverts the transaction). Reaching the branch requires a
 *      malicious / forked mpl-core mock that the harness doesn't ship.
 *      Documented so the audit ledger reflects the rationale.
 *
 *   5. AssetNotRefrozen — `escape_valve_buy` post-CPI assertion that
 *      the FreezeDelegate plugin reports `frozen=true` after the
 *      re-freeze CPI. Same defense-in-depth shape as #4 — skipped for
 *      the same reason.
 *
 *   6. TreasuryLocked — `propose_new_treasury` rejects after
 *      `lock_treasury()` flips the one-way kill switch. KEPT LAST in
 *      the file because `lock_treasury` permanently mutates the
 *      singleton `ProtocolConfig` for the whole mocha run.
 *
 * Fail-closed bar:
 *   Each implementable test asserts the error fires. We do NOT also
 *   re-snapshot every economic surface here — the prior security
 *   specs already cover that for the broader handler families. This
 *   spec's job is single-axis: prove the new require!() lines exist
 *   and trip on their canonical input.
 */

import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
  configPda,
  createPool,
  createUsdcMint,
  ensureAta,
  fetchProtocolConfig,
  initMockVault,
  initializeProtocol,
  initializeReputation,
  joinPool,
  harvestYield,
  setupEnv,
  usdc,
  type Env,
} from "./_harness/index.js";

// ─── Pool parameters (small — these tests don't model contributions) ──

const MEMBERS_TARGET = 3;
const CYCLES_TOTAL = 3;
const CYCLE_DURATION_SEC = 86_400;
const INSTALLMENT_USDC = 1_000n;
const CREDIT_USDC = 1_500n;
const INSTALLMENT_BASE = usdc(INSTALLMENT_USDC);
const CREDIT_BASE = usdc(CREDIT_USDC);

// ─── Helpers ──────────────────────────────────────────────────────────

async function expectRejected(
  thunk: () => Promise<unknown>,
  expectedErrorRe: RegExp,
): Promise<void> {
  try {
    await thunk();
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    expect(msg, `unexpected error: ${msg}`).to.match(expectedErrorRe);
    return;
  }
  expect.fail("expected transaction to revert, but it succeeded");
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("security — audit error path coverage", function () {
  this.timeout(120_000);

  let env: Env;
  let usdcMint: PublicKey;
  let treasury: PublicKey;

  before(async function () {
    env = await setupEnv();
    usdcMint = await createUsdcMint(env);
    const proto = await initializeProtocol(env, { usdcMint });
    treasury = proto.treasury;
    await initializeReputation(env, { coreProgram: env.ids.core });
  });

  // ───────────────────────────────────────────────────────────────────
  // 1. MetadataUriInvalidScheme
  // ───────────────────────────────────────────────────────────────────
  it("MetadataUriInvalidScheme — join_pool rejects ftp:// URI", async function () {
    const authority = Keypair.generate();
    const pool = await createPool(env, {
      authority,
      usdcMint,
      membersTarget: MEMBERS_TARGET,
      installmentAmount: INSTALLMENT_BASE,
      creditAmount: CREDIT_BASE,
      cyclesTotal: CYCLES_TOTAL,
      cycleDurationSec: CYCLE_DURATION_SEC,
    });
    const member = Keypair.generate();
    await expectRejected(
      () =>
        joinPool(env, pool, {
          member,
          slotIndex: 0,
          reputationLevel: 1,
          metadataUri: "ftp://attacker.example/position.json",
        }),
      /MetadataUriInvalidScheme|scheme not allowed/i,
    );
  });

  // ───────────────────────────────────────────────────────────────────
  // 2. ReputationLevelMismatch
  // ───────────────────────────────────────────────────────────────────
  it("ReputationLevelMismatch — asserting level=2 against an empty profile fails", async function () {
    const authority = Keypair.generate();
    const pool = await createPool(env, {
      authority,
      usdcMint,
      membersTarget: MEMBERS_TARGET,
      installmentAmount: INSTALLMENT_BASE,
      creditAmount: CREDIT_BASE,
      cyclesTotal: CYCLES_TOTAL,
      cycleDurationSec: CYCLE_DURATION_SEC,
    });
    // Fresh wallet, no `init_profile` call → handler treats as level 1.
    // Asserting level 2 must trip ReputationLevelMismatch.
    const member = Keypair.generate();
    await expectRejected(
      () =>
        joinPool(env, pool, {
          member,
          slotIndex: 0,
          reputationLevel: 2,
        }),
      /ReputationLevelMismatch|reputation_level/i,
    );
  });

  // ───────────────────────────────────────────────────────────────────
  // 3. HarvestSlippageExceeded
  // ───────────────────────────────────────────────────────────────────
  it("HarvestSlippageExceeded — min_realized_usdc=1 against 0-yield mock vault rejects", async function () {
    const authority = Keypair.generate();
    const pool = await createPool(env, {
      authority,
      usdcMint,
      membersTarget: MEMBERS_TARGET,
      installmentAmount: INSTALLMENT_BASE,
      creditAmount: CREDIT_BASE,
      cyclesTotal: CYCLES_TOTAL,
      cycleDurationSec: CYCLE_DURATION_SEC,
    });
    // `harvest_yield` requires `pool.status == Active`. Fill the
    // members_target slots so join_pool auto-activates the pool
    // before we probe the slippage check.
    for (let i = 0; i < MEMBERS_TARGET; i++) {
      await joinPool(env, pool, {
        member: Keypair.generate(),
        slotIndex: i,
        reputationLevel: 1,
      });
    }
    await initMockVault(env, pool.pool, usdcMint);
    // No `prefundMockYield` — adapter has 0 surplus. realized will be 0.
    // min_realized_usdc=1 forces `0 >= 1` to fail with HarvestSlippageExceeded.
    const treasuryUsdc = await ensureAta(env, usdcMint, treasury);
    await expectRejected(
      () =>
        harvestYield(env, {
          pool,
          treasuryUsdc,
          minRealizedUsdc: 1n,
        }),
      /HarvestSlippageExceeded|slippage/i,
    );
  });

  // ───────────────────────────────────────────────────────────────────
  // 4. AssetTransferIncomplete  (skipped — see file header)
  // ───────────────────────────────────────────────────────────────────
  it.skip("AssetTransferIncomplete — defense-in-depth, requires malicious mpl-core mock", function () {
    // The post-CPI check `require_keys_eq!(asset.owner, buyer_wallet)`
    // can only fail if `mpl-core` returns success without mutating the
    // asset's owner. Real Metaplex Core enforces atomicity (transfer
    // either succeeds with the new owner or reverts). Reaching the
    // branch requires a forked / mocked program ID, which the harness
    // doesn't ship. Tracked in the audit backlog as guard-only.
  });

  // ───────────────────────────────────────────────────────────────────
  // 5. AssetNotRefrozen  (skipped — see file header)
  // ───────────────────────────────────────────────────────────────────
  it.skip("AssetNotRefrozen — defense-in-depth, requires malicious mpl-core mock", function () {
    // Same shape as #4: post-CPI assertion that the FreezeDelegate
    // plugin reports `frozen=true` after the re-freeze step. Cannot
    // fail on real `mpl-core` — the plugin write is atomic with the
    // CPI. Ships unverified by design; reaching it requires a mock
    // that returns success without setting `frozen=true`.
  });

  // ───────────────────────────────────────────────────────────────────
  // 6. TreasuryLocked  (LAST — permanently mutates singleton config)
  // ───────────────────────────────────────────────────────────────────
  it("TreasuryLocked — propose_new_treasury rejects after lock_treasury", async function () {
    // `lock_treasury` is monotonic — once flipped, it stays locked
    // forever (no unlock ix by design). If a previous mocha run in
    // the same validator session already exercised this test, the
    // sanity check below would fail. Detect + skip in that case so
    // the suite re-runs cleanly without a validator reset.
    const cfg = (await fetchProtocolConfig(env)) as {
      treasuryLocked: boolean;
      pendingTreasury: PublicKey;
    };
    if (cfg.treasuryLocked) {
      this.skip();
    }
    expect(cfg.treasuryLocked, "config must start unlocked").to.equal(false);
    expect(cfg.pendingTreasury.toString(), "no pending proposal at start").to.equal(
      PublicKey.default.toString(),
    );

    // 1) Authority flips the kill switch.
    await (env.programs.core.methods as any)
      .lockTreasury()
      .accounts({
        config: configPda(env),
        authority: env.payer.publicKey,
      })
      .signers([env.payer])
      .rpc();

    // 2) Now propose_new_treasury must reject. The require!() order
    //    in the handler is `treasury_locked` first, then
    //    `pending_treasury == default` — so a passing test means the
    //    lock guard fired before the pending-proposal check.
    const newTreasury = Keypair.generate().publicKey;
    await expectRejected(
      () =>
        (env.programs.core.methods as any)
          .proposeNewTreasury({ newTreasury })
          .accounts({
            config: configPda(env),
            authority: env.payer.publicKey,
          })
          .signers([env.payer])
          .rpc(),
      /TreasuryLocked|locked/i,
    );

    // Post-condition: lock flag stuck true, treasury unchanged.
    const cfgAfter = (await fetchProtocolConfig(env)) as {
      treasuryLocked: boolean;
      treasury: PublicKey;
      pendingTreasury: PublicKey;
    };
    expect(cfgAfter.treasuryLocked, "lock must persist").to.equal(true);
    expect(
      cfgAfter.pendingTreasury.toString(),
      "rejected proposal must not have written pendingTreasury",
    ).to.equal(PublicKey.default.toString());
  });
});

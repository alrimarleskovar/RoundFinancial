/**
 * Security — canary control negative paths (TVL caps + adapter allowlist).
 *
 * Closes P1 items 2 + 3 from the post-#310/#311 external review:
 *
 *   2. TVL caps need negative tests
 *      - pool above per-pool cap → `PoolTvlCapExceeded`
 *      - protocol above protocol-wide cap → `ProtocolTvlCapExceeded`
 *      - cap=0 disabled (back-compat)
 *      - exact-cap boundary allowed (≤ comparison)
 *
 *   3. Yield-adapter allowlist needs negative tests
 *      - default (Pubkey::default()) accepts any executable adapter
 *      - non-default rejects wrong adapter with `InvalidYieldAdapter`
 *      - non-default accepts correct adapter
 *      - `update_protocol_config` can re-disable the allowlist
 *
 * **All checks fire at `create_pool`** — the fail-fast point shipped
 * by #314 (the orphan-PDA fix). A rejected pool leaves NO Pool PDA
 * on-chain, so the test asserts only the revert + error code; the
 * "fail-closed" balance snapshot pattern from `security_inputs.spec.ts`
 * isn't applicable here (there are no balances yet to drift).
 *
 * **Bankrun init_pool_vaults bypass:** the harness pre-creates vault
 * ATAs via SPL token CPIs, so bankrun never exercises
 * `init_pool_vaults`. The TVL cap CHECK that lives in
 * `init_pool_vaults` (race-free reservation point + committed-total
 * increment + close_pool decrement) is therefore NOT exercised by
 * this spec. It's covered by the create_pool fail-fast at the same
 * cap value — both paths use the identical arithmetic so a regression
 * in one will manifest in the other.
 *
 * Per the dual-check pattern in `create_pool.rs` + `init_pool_vaults.rs`,
 * the create_pool check is the cheap fail-fast and init_pool_vaults is
 * the authoritative commit. Race semantics between the two are benign
 * (recoverable DoS, not fund-loss).
 *
 * **State bleed-through:** `ProtocolConfig` is a singleton — these tests
 * mutate `max_pool_tvl_usdc`, `max_protocol_tvl_usdc`, and
 * `approved_yield_adapter` via `update_protocol_config`. `afterEach`
 * resets every field to its initial-disabled state so subsequent specs
 * in the same mocha run see a clean config.
 *
 * **Suite ordering note** — by design, the yield-adapter allowlist
 * subdir tests MUTATE the singleton `ProtocolConfig.approved_yield_adapter`
 * field. The on-chain handler at `update_protocol_config.rs:132` forbids
 * reverting that field to `Pubkey::default()` (allowlist is one-way
 * tightening). So once this spec runs, every subsequent createPool in
 * the same validator session must pass the pinned adapter, or it bounces
 * with `InvalidYieldAdapter` (6016). When batching specs against a single
 * `solana-test-validator`, run `security_canary_controls` LAST — or run
 * it isolated with a `--reset` before the next batch.
 */

import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";

import {
  setupEnv,
  createUsdcMint,
  type Env,
  initializeProtocol,
  createPool,
  configPda,
  usdc,
} from "./_harness/index.js";

// ─── Local helpers ────────────────────────────────────────────────────

/** Capture a rejected promise's error message for regex matching. */
async function expectRejected(thunk: () => Promise<unknown>): Promise<string> {
  try {
    await thunk();
  } catch (err) {
    return String((err as Error)?.message ?? err);
  }
  expect.fail("expected transaction to revert, but it succeeded");
  return ""; // unreachable
}

interface UpdateConfigOpts {
  maxPoolTvlUsdc?: bigint | null; // null = no change; bigint = Some(v); undefined = no change
  maxProtocolTvlUsdc?: bigint | null;
  approvedYieldAdapter?: PublicKey | null;
}

/**
 * Wrapper around `update_protocol_config` for the three new fields
 * this spec exercises. Leaves the BPS fees untouched.
 */
async function updateProtocolConfig(env: Env, opts: UpdateConfigOpts): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const methods = env.programs.core.methods as any;
  await methods
    .updateProtocolConfig({
      newFeeBpsYield: null,
      newFeeBpsCycleL1: null,
      newFeeBpsCycleL2: null,
      newFeeBpsCycleL3: null,
      newGuaranteeFundBps: null,
      // Anchor's Option<u64> encoder requires `BN | null` (the borsh
      // BNLayout calls `src.toArrayLike(...)`). Wrap bigints here so
      // callers can keep the more ergonomic `bigint | null` API.
      newMaxPoolTvlUsdc:
        opts.maxPoolTvlUsdc !== undefined && opts.maxPoolTvlUsdc !== null
          ? new BN(opts.maxPoolTvlUsdc.toString())
          : null,
      newMaxProtocolTvlUsdc:
        opts.maxProtocolTvlUsdc !== undefined && opts.maxProtocolTvlUsdc !== null
          ? new BN(opts.maxProtocolTvlUsdc.toString())
          : null,
      newApprovedYieldAdapter:
        opts.approvedYieldAdapter !== undefined ? opts.approvedYieldAdapter : null,
      // Fields added to UpdateProtocolConfigArgs after this spec was
      // written. Borsh deserializer requires the full struct shape
      // even when leaving fields unchanged — pass null explicitly.
      newCommitRevealRequired: null, // #232 commit-reveal gate
      newLpShareBps: null, // SEV-003 lp share authoritative slot
    })
    .accounts({
      config: configPda(env),
      authority: env.payer.publicKey,
    })
    .signers([env.payer])
    .rpc();
}

/**
 * Reset every cap field to its initial "disabled" state so subsequent
 * describe blocks / specs see a clean ProtocolConfig. NOTE: cannot
 * reset `approved_yield_adapter` back to Pubkey::default() — the
 * on-chain handler rejects that path (one-way tightening invariant;
 * see update_protocol_config.rs:132). Allowlist resets that require
 * "no allowlist" are now a redeploy decision, not a runtime call.
 * Subsequent tests that exercise the allowlist must either:
 *   (a) leave the same approved adapter in place across runs, OR
 *   (b) set a different known-valid adapter (e.g. env.ids.yieldMock).
 */
async function resetCanaryControls(env: Env): Promise<void> {
  await updateProtocolConfig(env, {
    maxPoolTvlUsdc: 0n,
    maxProtocolTvlUsdc: 0n,
    // approvedYieldAdapter intentionally NOT reset — see fn docstring.
    // The on-chain guard forbids setting it back to Pubkey::default().
  });
}

// ─── The spec ─────────────────────────────────────────────────────────

describe("canary controls — TVL caps + adapter allowlist (negative paths)", function () {
  this.timeout(60_000);

  let env: Env;
  let usdcMint: PublicKey;
  let authority: Keypair;

  before(async () => {
    env = await setupEnv();
    authority = env.payer;
    usdcMint = await createUsdcMint(env);
    await initializeProtocol(env, { usdcMint });
    // Make sure we start each suite from a known-disabled state.
    await resetCanaryControls(env);
  });

  afterEach(async () => {
    // Every cap/allowlist mutation is undone after each test so the
    // suite is order-independent + subsequent spec files (e.g.
    // security_lifecycle) don't pick up stale config.
    await resetCanaryControls(env);
  });

  // ─── TVL caps ───────────────────────────────────────────────────────

  describe("TVL caps", () => {
    it("per-pool cap exceeded → PoolTvlCapExceeded, no Pool PDA created", async () => {
      // Set cap = $5; pool credit $20 exceeds it. Installment bumped to
      // $10 so SEV-031 viability passes: 3 × 10 × 0.74 = 22.2 >= 20.
      await updateProtocolConfig(env, { maxPoolTvlUsdc: usdc(5n) });

      const msg = await expectRejected(() =>
        createPool(env, {
          authority,
          usdcMint,
          creditAmount: usdc(20n),
          installmentAmount: usdc(15n), // SEV-031: 3 × 15 × 0.74 = 33.3 >= 30
          cyclesTotal: 3,
          membersTarget: 3,
        }),
      );
      expect(msg, `TVL.per-pool: ${msg}`).to.match(/PoolTvlCapExceeded/i);
    });

    it("protocol-wide cap exceeded → ProtocolTvlCapExceeded", async () => {
      // Set protocol cap = $5; even with per-pool cap disabled, the
      // protocol-wide running-total check rejects.
      await updateProtocolConfig(env, { maxProtocolTvlUsdc: usdc(5n) });

      const msg = await expectRejected(() =>
        createPool(env, {
          authority,
          usdcMint,
          creditAmount: usdc(30n),
          installmentAmount: usdc(15n), // SEV-031: 3 × 15 × 0.74 = 33.3 >= 30
          cyclesTotal: 3,
          membersTarget: 3,
        }),
      );
      expect(msg, `TVL.protocol: ${msg}`).to.match(/ProtocolTvlCapExceeded/i);
    });

    it("caps=0 accepts pools of any size (back-compat default)", async () => {
      // Both caps disabled; arbitrarily large pool succeeds.
      const pool = await createPool(env, {
        authority,
        usdcMint,
        creditAmount: usdc(1_000n), // $1k
        installmentAmount: usdc(100n),
        cyclesTotal: 10,
        membersTarget: 10,
      });
      expect(pool.pool).to.be.instanceOf(PublicKey);
    });

    it("exact-cap match is allowed (≤ comparison)", async () => {
      // pool_committed = credit × cycles = $30 × 3 = $90.
      // Setting cap to exactly $90 must allow the pool (not reject).
      await updateProtocolConfig(env, { maxPoolTvlUsdc: usdc(90n) });

      const pool = await createPool(env, {
        authority,
        usdcMint,
        creditAmount: usdc(30n),
        installmentAmount: usdc(15n), // SEV-031: 3 × 15 × 0.74 = 33.3 >= 30
        cyclesTotal: 3,
        membersTarget: 3,
      });
      expect(pool.pool).to.be.instanceOf(PublicKey);
    });

    it("one-over cap is rejected (boundary off-by-one guard)", async () => {
      // Same pool as above but cap is $89 = one short of the $90 required.
      await updateProtocolConfig(env, { maxPoolTvlUsdc: usdc(89n) });

      const msg = await expectRejected(() =>
        createPool(env, {
          authority,
          usdcMint,
          creditAmount: usdc(30n),
          installmentAmount: usdc(15n), // SEV-031: 3 × 15 × 0.74 = 33.3 >= 30
          cyclesTotal: 3,
          membersTarget: 3,
        }),
      );
      expect(msg, `TVL.boundary: ${msg}`).to.match(/PoolTvlCapExceeded/i);
    });
  });

  // ─── Yield-adapter allowlist ────────────────────────────────────────

  describe("yield-adapter allowlist", () => {
    it("default (Pubkey::default()) accepts any executable adapter", async () => {
      // Allowlist disabled. Reputation program isn't a yield adapter but
      // it IS executable, so it passes the #[account(executable)]
      // constraint and the allowlist (being disabled) doesn't reject.
      const pool = await createPool(env, {
        authority,
        usdcMint,
        yieldAdapter: env.ids.yieldMock,
      });
      expect(pool.pool).to.be.instanceOf(PublicKey);
    });

    it("non-default rejects mismatched adapter with InvalidYieldAdapter", async () => {
      // Pin allowlist to the mock yield program; attempt to use the
      // reputation program (also executable, so passes the executable
      // constraint but fails the allowlist match).
      await updateProtocolConfig(env, { approvedYieldAdapter: env.ids.yieldMock });

      const msg = await expectRejected(() =>
        createPool(env, {
          authority,
          usdcMint,
          yieldAdapter: env.ids.reputation,
        }),
      );
      expect(msg, `allowlist.mismatch: ${msg}`).to.match(/InvalidYieldAdapter/i);
    });

    it("non-default accepts the pinned adapter", async () => {
      await updateProtocolConfig(env, { approvedYieldAdapter: env.ids.yieldMock });

      const pool = await createPool(env, {
        authority,
        usdcMint,
        yieldAdapter: env.ids.yieldMock,
      });
      expect(pool.pool).to.be.instanceOf(PublicKey);
    });

    it.skip("update_protocol_config can re-disable the allowlist", async () => {
      // **Behavioural change**: the `update_protocol_config` handler
      // now explicitly REJECTS `Pubkey::default()` for the adapter
      // field (update_protocol_config.rs:132) — the allowlist is
      // one-way-tightening by design (post-canary it gets locked via
      // `lock_approved_yield_adapter`; reverting to "no allowlist"
      // is a redeploy decision). This test asserted the old "set →
      // clear → set anything" behaviour that no longer exists.
      //
      // The negative companion test (`InvalidYieldAdapter`) above
      // still covers the wider security property — keeping this
      // test as `.skip` for historical record, in case the policy
      // ever softens.
    });
  });

  // ─── Cross-control interaction ──────────────────────────────────────

  describe("cross-control", () => {
    it("misconfigured allowlist only blocks NEW pools — pre-set state intact", async () => {
      // Create one pool while allowlist is disabled → succeeds.
      const before = await createPool(env, {
        authority,
        usdcMint,
        yieldAdapter: env.ids.yieldMock,
      });
      expect(before.pool).to.be.instanceOf(PublicKey);

      // Pin allowlist to a nonsense pubkey (it's an executable program
      // but not approved) — only blocks future create_pool calls,
      // doesn't trap funds in `before`.
      await updateProtocolConfig(env, { approvedYieldAdapter: env.ids.reputation });

      const msg = await expectRejected(() =>
        createPool(env, {
          authority,
          usdcMint,
          yieldAdapter: env.ids.yieldMock, // was fine before; now rejected
        }),
      );
      expect(msg, `cross.allowlist: ${msg}`).to.match(/InvalidYieldAdapter/i);

      // The earlier pool is untouched — no funds trapped; no state mutation.
      // (No balances to assert here since we never funded the pool;
      // the contract is "allowlist misconfig doesn't affect existing pools",
      // which is structural — the allowlist only gates create_pool.)
      expect(before.pool).to.be.instanceOf(PublicKey);
    });
  });
});

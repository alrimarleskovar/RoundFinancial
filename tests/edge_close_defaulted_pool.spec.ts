/**
 * edge — `close_pool` on a defaulted pool (SEV-050 liveness regression).
 *
 * The former close_pool guard required `defaulted_members == 0 ||
 * escrow_balance == 0`. But `settle_default` only ever INCREMENTS
 * `defaulted_members` (never zeroes it), and `escrow_balance` ends > 0 for any
 * pool that took contributions (release_escrow vests only the STAKE, not the
 * escrow deposits). So BOTH clauses are unsatisfiable once anyone defaults — a
 * defaulted pool could NEVER close, stranding its funds and leaking its
 * committed TVL forever (a griefing DoS on the global cap). SEV-050 removed the
 * guard: close_pool is a pure terminal-state transition (moves no funds; vault
 * drain is deferred to close_pool_vaults).
 *
 * The litesvm parity lane closes defaulted pools but is artifact-gated
 * (this.skip()s without mpl_core.so) and asserts economic parity, not this
 * property in isolation. Here we seed the exact removed-guard condition
 * (Completed pool, defaulted_members > 0 AND escrow_balance > 0) and assert:
 *   A. close_pool succeeds → status Closed (4), committed TVL decremented by
 *      credit_amount * cycles_total.
 *   B. a second close_pool reverts (SEV-005 single-shot terminal state).
 */

import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";

import { poolPda, protocolConfigPda } from "@roundfi/sdk";

import {
  setupBankrunEnv,
  writeAnchorAccount,
  writeMintAccount,
  type BankrunEnv,
} from "./_harness/bankrun.js";

const MEMBERS_TARGET = 3;
const CYCLES_TOTAL = 3;
const CYCLE_DURATION_SEC = 86_400n;
const INSTALLMENT = 1_000_000_000n; // 1_000 USDC
const CREDIT = 3_000_000_000n; // 3_000 USDC
const POOL_COMMITTED = CREDIT * BigInt(CYCLES_TOTAL); // 9_000 USDC max flow
const TVL_BEFORE = 12_000_000_000n; // 12_000 USDC committed across the protocol
const RESIDENT_ESCROW = 750_000_000n; // > 0 — the exact removed-guard condition
const NEXT_CYCLE_AT = 1_800_000_000n;
const POOL_SEED_ID = 5050n;

describe("edge — close_pool on a defaulted pool (SEV-050, bankrun)", function () {
  this.timeout(60_000);

  let env: BankrunEnv;

  const poolAuthority = Keypair.generate();
  const treasury = Keypair.generate();
  const metaplexCore = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
  const usdcMint = Keypair.generate().publicKey;

  let configPk: PublicKey;
  let configBump: number;
  let poolPk: PublicKey;
  let poolBump: number;

  async function seedCompletedDefaultedPool() {
    await writeAnchorAccount(env.context, env.programs.core, "pool", poolPk, {
      authority: poolAuthority.publicKey,
      seedId: new BN(POOL_SEED_ID.toString()),
      usdcMint,
      yieldAdapter: env.ids.yieldMock,
      membersTarget: MEMBERS_TARGET,
      installmentAmount: new BN(INSTALLMENT.toString()),
      creditAmount: new BN(CREDIT.toString()),
      cyclesTotal: CYCLES_TOTAL,
      cycleDuration: new BN(CYCLE_DURATION_SEC.toString()),
      seedDrawBps: 9_160,
      solidarityBps: 100,
      escrowReleaseBps: 2_500,
      membersJoined: MEMBERS_TARGET,
      status: 2, // Completed — the close_pool entry precondition
      startedAt: new BN((NEXT_CYCLE_AT - CYCLE_DURATION_SEC * 3n).toString()),
      currentCycle: CYCLES_TOTAL, // ran to the end
      nextCycleAt: new BN(NEXT_CYCLE_AT.toString()),
      totalContributed: new BN((INSTALLMENT * 6n).toString()),
      totalPaidOut: new BN(CREDIT.toString()),
      solidarityBalance: new BN(0),
      escrowBalance: new BN(RESIDENT_ESCROW.toString()), // > 0 — removed-guard condition
      yieldAccrued: new BN(0),
      guaranteeFundBalance: new BN(0),
      totalProtocolFeeAccrued: new BN(0),
      yieldPrincipalDeposited: new BN(0),
      defaultedMembers: 1, // > 0 — removed-guard condition
      lpDistributionBalance: new BN(0),
      slotsBitmap: Buffer.from([0x07, 0, 0, 0, 0, 0, 0, 0]),
      bump: poolBump,
      escrowVaultBump: 255,
      solidarityVaultBump: 255,
      yieldVaultBump: 255,
    });
  }

  before(async function () {
    env = await setupBankrunEnv();

    [configPk, configBump] = protocolConfigPda(env.ids.core);
    [poolPk, poolBump] = poolPda(env.ids.core, poolAuthority.publicKey, POOL_SEED_ID);

    writeMintAccount(env.context, usdcMint, { mintAuthority: env.payer.publicKey, decimals: 6 });

    // config.authority = env.payer so the default payer signer satisfies
    // close_pool's `authority == pool.authority || == config.authority`.
    // committed TVL is pre-loaded so we can assert the decrement.
    await writeAnchorAccount(env.context, env.programs.core, "protocolConfig", configPk, {
      authority: env.payer.publicKey,
      treasury: treasury.publicKey,
      usdcMint,
      metaplexCore,
      defaultYieldAdapter: env.ids.yieldMock,
      reputationProgram: PublicKey.default,
      feeBpsYield: 2_000,
      feeBpsCycleL1: 200,
      feeBpsCycleL2: 100,
      feeBpsCycleL3: 0,
      guaranteeFundBps: 15_000,
      paused: false,
      bump: configBump,
      committedProtocolTvlUsdc: new BN(TVL_BEFORE.toString()),
    });

    await seedCompletedDefaultedPool();
  });

  function closeAccounts() {
    return {
      config: configPk,
      authority: env.payer.publicKey,
      pool: poolPk,
    };
  }

  const close = () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env.programs.core.methods as any).closePool().accounts(closeAccounts());

  it("A. defaulted pool (defaulted_members>0 AND escrow>0) closes; TVL decremented", async function () {
    await close().rpc();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await (env.programs.core.account as any).pool.fetch(poolPk)) as { status: number };
    expect(p.status, "pool → Closed (4), not blocked by the removed guard").to.equal(4);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfg = (await (env.programs.core.account as any).protocolConfig.fetch(configPk)) as {
      committedProtocolTvlUsdc: BN;
    };
    expect(
      BigInt(cfg.committedProtocolTvlUsdc.toString()),
      "committed TVL decremented by credit_amount * cycles_total",
    ).to.equal(TVL_BEFORE - POOL_COMMITTED);
  });

  it("B. second close_pool reverts (SEV-005 single-shot terminal state)", async function () {
    let threw = false;
    try {
      await close().rpc(); // status is now Closed (4) != Completed (2)
    } catch (e) {
      threw = true;
      const err = e as { logs?: string[]; message?: string };
      const haystack = [...(err.logs ?? []), err.message ?? "", String(e)].join("\n");
      expect(haystack).to.match(/PoolNotCompleted/, `expected PoolNotCompleted, got:\n${haystack}`);
    }
    expect(threw, "re-closing a Closed pool must reject").to.equal(true);
  });
});

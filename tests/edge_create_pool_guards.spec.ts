/**
 * edge — create_pool parameter guards (LEAD-002, Phase E, bankrun).
 *
 * LEAD-002 (Caio audit) found the dangerous outcomes (div-by-zero, overflow,
 * cycle-0 unsatisfiability) are structurally prevented in create_pool's handler
 * — but the only on-chain negative coverage was for the two TVL caps. Every
 * per-parameter `require!` (`create_pool.rs:92-125`) plus the SEV-031 viability
 * guard was untested from the client side.
 *
 * This pins one revert per guard, plus a positive control proving the harness
 * reaches the handler (so a wrong-reason revert can't masquerade as a pass — the
 * error-string regexes already guard that).
 *
 * Accounts mirror the proven `_harness/pool.ts` createPool call verbatim. The
 * account validation (typed mint == config.usdc_mint, executable adapter, fresh
 * pool PDA) runs in try_accounts BEFORE the handler, so every case supplies a
 * valid mint + adapter and a distinct seed_id, then the bad arg trips the
 * specific handler error.
 */

import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import {
  escrowVaultAuthorityPda,
  poolPda,
  protocolConfigPda,
  solidarityVaultAuthorityPda,
  yieldVaultAuthorityPda,
} from "@roundfi/sdk";

import {
  setupBankrunEnv,
  writeAnchorAccount,
  writeMintAccount,
  type BankrunEnv,
} from "./_harness/bankrun.js";

// On-chain constants (roundfi-core/src/constants.rs).
const MAX_MEMBERS = 64;
const MAX_BPS = 10_000;
const MIN_CYCLE_DURATION = 86_400; // 1 day

// A valid, viable base config: members == cycles, credit far below
// members × installment so viability holds regardless of the exact formula.
const VALID = {
  membersTarget: 3,
  installmentAmount: 1_000_000_000n, // 1_000 USDC
  creditAmount: 1_000_000n, // tiny → definitely viable
  cyclesTotal: 3,
  cycleDuration: MIN_CYCLE_DURATION,
  escrowReleaseBps: 2_500,
};

describe("edge — create_pool parameter guards (LEAD-002, bankrun)", function () {
  this.timeout(60_000);

  let env: BankrunEnv;

  const treasury = Keypair.generate();
  const metaplexCore = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
  const usdcMint = Keypair.generate().publicKey;

  let configPk: PublicKey;
  let configBump: number;

  before(async function () {
    env = await setupBankrunEnv();
    [configPk, configBump] = protocolConfigPda(env.ids.core);

    writeMintAccount(env.context, usdcMint, { mintAuthority: env.payer.publicKey, decimals: 6 });

    // TVL caps + adapter allowlist default to 0/off (unset → zero-filled), so
    // create_pool's late checks don't interfere with the arg-guard reverts.
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
    });
  });

  // Build a createPool method call for the given args, mirroring the harness
  // account object verbatim. `authority = env.payer` so the default bankrun
  // signer both signs and owns the pool PDA seed.
  function attemptCreate(over: Partial<typeof VALID>, seedId: bigint) {
    const a = { ...VALID, ...over };
    const authorityPk = env.payer.publicKey;
    const [pool] = poolPda(env.ids.core, authorityPk, seedId);
    const [escrowVaultAuthority] = escrowVaultAuthorityPda(env.ids.core, pool);
    const [solidarityVaultAuthority] = solidarityVaultAuthorityPda(env.ids.core, pool);
    const [yieldVaultAuthority] = yieldVaultAuthorityPda(env.ids.core, pool);
    const poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, pool, true);
    const escrowVault = getAssociatedTokenAddressSync(usdcMint, escrowVaultAuthority, true);
    const solidarityVault = getAssociatedTokenAddressSync(usdcMint, solidarityVaultAuthority, true);
    const yieldVault = getAssociatedTokenAddressSync(usdcMint, yieldVaultAuthority, true);

    return {
      pool,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      builder: (env.programs.core.methods as any)
        .createPool({
          seedId: new BN(seedId.toString()),
          membersTarget: a.membersTarget,
          installmentAmount: new BN(a.installmentAmount.toString()),
          creditAmount: new BN(a.creditAmount.toString()),
          cyclesTotal: a.cyclesTotal,
          cycleDuration: new BN(a.cycleDuration),
          escrowReleaseBps: a.escrowReleaseBps,
        })
        .accounts({
          authority: authorityPk,
          config: configPk,
          pool,
          usdcMint,
          yieldAdapter: env.ids.yieldMock,
          escrowVaultAuthority,
          solidarityVaultAuthority,
          yieldVaultAuthority,
          poolUsdcVault,
          escrowVault,
          solidarityVault,
          yieldVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        }),
    };
  }

  async function expectReject(over: Partial<typeof VALID>, seedId: bigint, pattern: RegExp) {
    let threw = false;
    try {
      await attemptCreate(over, seedId).builder.rpc();
    } catch (e) {
      threw = true;
      const err = e as { logs?: string[]; message?: string };
      const haystack = [...(err.logs ?? []), err.message ?? "", String(e)].join("\n");
      expect(haystack).to.match(pattern, `expected ${pattern}, got:\n${haystack}`);
    }
    expect(threw, `create_pool with ${JSON.stringify(over)} must reject`).to.equal(true);
  }

  it("members_target = 0 → InvalidMembersTarget", async function () {
    await expectReject({ membersTarget: 0, cyclesTotal: 0 }, 6001n, /InvalidMembersTarget/);
  });

  it("members_target > MAX_MEMBERS → InvalidMembersTarget", async function () {
    await expectReject(
      { membersTarget: MAX_MEMBERS + 1, cyclesTotal: MAX_MEMBERS + 1 },
      6002n,
      /InvalidMembersTarget/,
    );
  });

  it("installment_amount = 0 → InvalidAmount", async function () {
    await expectReject({ installmentAmount: 0n }, 6003n, /InvalidAmount/);
  });

  it("credit_amount = 0 → InvalidAmount", async function () {
    await expectReject({ creditAmount: 0n }, 6004n, /InvalidAmount/);
  });

  it("cycle_duration < MIN_CYCLE_DURATION → InvalidCycleDuration", async function () {
    await expectReject({ cycleDuration: MIN_CYCLE_DURATION - 1 }, 6005n, /InvalidCycleDuration/);
  });

  it("escrow_release_bps > MAX_BPS → InvalidBps", async function () {
    await expectReject({ escrowReleaseBps: MAX_BPS + 1 }, 6006n, /InvalidBps/);
  });

  it("cycles_total != members_target → InvalidPoolParams (SEV-038)", async function () {
    await expectReject({ membersTarget: 3, cyclesTotal: 4 }, 6007n, /InvalidPoolParams/);
  });

  it("inviable config (credit >> members × installment) → PoolNotViable (SEV-031)", async function () {
    await expectReject(
      { installmentAmount: 1n, creditAmount: 1_000_000_000_000n },
      6008n,
      /PoolNotViable/,
    );
  });

  it("positive control: a valid, viable config creates the pool", async function () {
    const { pool, builder } = attemptCreate({}, 6009n);
    await builder.rpc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (await (env.programs.core.account as any).pool.fetch(pool)) as {
      membersTarget: number;
      cyclesTotal: number;
    };
    expect(p.membersTarget, "pool created with the requested members_target").to.equal(
      VALID.membersTarget,
    );
    expect(p.cyclesTotal, "pool created with the requested cycles_total").to.equal(
      VALID.cyclesTotal,
    );
  });
});

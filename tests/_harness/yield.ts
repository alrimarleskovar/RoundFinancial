/**
 * Yield adapter helpers.
 *
 * `roundfi-yield-mock` is a minimum-viable deposit/harvest implementation
 * (see `programs/roundfi-yield-mock/src/lib.rs`). This harness wraps its
 * `init_vault` instruction and exposes helpers to derive the state PDA
 * and its vault ATA — the two addresses that specs need to pass to
 * `roundfi-core::deposit_idle_to_yield` and `::harvest_yield` as the
 * `yield_vault` account and the sole `remaining_account`.
 *
 * `prefundMockYield` mints surplus tokens directly into the mock's
 * vault so that `harvest()` has something to pay out — the mock has
 * no APY / time-based accrual by design (Option C of Step 5c).
 */

import { PublicKey, SystemProgram, Keypair, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { yieldVaultStatePda } from "@roundfi/sdk";

import type { Env } from "./env.js";
import { mintToAta } from "./mint.js";

/** Mock adapter program ID for this env. */
export function yieldMockProgramId(env: Env): PublicKey {
  return env.ids.yieldMock;
}

/** State PDA the mock uses — seeds: [b"yield-state", owner]. */
export function yieldMockStatePda(env: Env, owner: PublicKey): PublicKey {
  return yieldVaultStatePda(env.ids.yieldMock, owner)[0];
}

/**
 * The mock's own vault ATA — authority is the state PDA. This is the
 * account specs pass as `yield_vault` to core's deposit/harvest ixs.
 * Different from the core-side `yield_vault` minted in `create_pool`;
 * that one stays empty in the mock setup.
 */
export function yieldMockVault(
  env: Env,
  pool: PublicKey,
  usdcMint: PublicKey,
): PublicKey {
  const state = yieldMockStatePda(env, pool);
  return getAssociatedTokenAddressSync(usdcMint, state, true);
}

export interface InitMockVaultResult {
  state: PublicKey;
  vault: PublicKey;
  txSig: string;
}

/**
 * Call `roundfi_yield_mock.init_vault` to allocate the state PDA and
 * its vault ATA for `pool`. Idempotent: if the state already exists
 * (e.g. a prior test in the same mocha run already initialized it),
 * short-circuits without resubmitting.
 */
export async function initMockVault(
  env: Env,
  pool: PublicKey,
  usdcMint: PublicKey,
  payer: Keypair = env.payer,
): Promise<InitMockVaultResult> {
  const state = yieldMockStatePda(env, pool);
  const vault = yieldMockVault(env, pool, usdcMint);

  const existing = await env.connection.getAccountInfo(state, "confirmed");
  if (existing) {
    return { state, vault, txSig: "already-initialized" };
  }

  const txSig = await env.programs.yieldMock.methods
    .initVault()
    .accounts({
      payer: payer.publicKey,
      pool,
      mint: usdcMint,
      state,
      vault,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([payer])
    .rpc();

  return { state, vault, txSig };
}

/**
 * Drop `amount` base units into the mock's vault ATA — simulates
 * "yield accrued since last harvest" without any APY math. Next
 * `harvest()` call will sweep exactly this amount (minus whatever
 * tracked principal is currently deposited, see mock impl).
 */
export async function prefundMockYield(
  env: Env,
  pool: PublicKey,
  usdcMint: PublicKey,
  amount: bigint,
): Promise<PublicKey> {
  const vault = yieldMockVault(env, pool, usdcMint);
  await mintToAta(env, usdcMint, vault, amount);
  return vault;
}

export interface MockVaultStateView {
  pool: PublicKey;
  underlyingMint: PublicKey;
  vault: PublicKey;
  trackedPrincipal: bigint;
  bump: number;
}

/** Loosely-typed fetch of the mock's YieldVaultState account. */
export async function fetchMockVaultState(
  env: Env,
  pool: PublicKey,
): Promise<MockVaultStateView> {
  const state = yieldMockStatePda(env, pool);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await (env.programs.yieldMock.account as any).yieldVaultState.fetch(
    state,
  )) as {
    pool: PublicKey;
    underlyingMint: PublicKey;
    vault: PublicKey;
    trackedPrincipal: { toString(): string };
    bump: number;
  };
  return {
    pool: raw.pool,
    underlyingMint: raw.underlyingMint,
    vault: raw.vault,
    trackedPrincipal: BigInt(raw.trackedPrincipal.toString()),
    bump: raw.bump,
  };
}

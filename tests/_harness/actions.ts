/**
 * Lifecycle instruction wrappers.
 *
 * These thin helpers fill in the account tables and (for contribute /
 * claim_payout) the reputation sidecar so spec files can call one
 * line per on-chain action. Nothing here mutates the harness's
 * internal state — each helper returns the signature and enough
 * context for the caller to do its own `account.fetch` assertions.
 *
 * Every call that mints a reputation attestation follows the
 * "pass reputation program itself = None" convention for
 * `identity_record` (see core::cpi::reputation).
 */

import {
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

import { ATTESTATION_SCHEMA } from "@roundfi/sdk";

import type { Env } from "./env.js";
import type { PoolHandle, MemberHandle } from "./pool.js";
import {
  attestationFor,
  attestationNonce,
  configPda,
  reputationConfigFor,
  reputationProfileFor,
} from "./pda.js";
import { yieldMockStatePda, yieldMockVault } from "./yield.js";

// ─── contribute ────────────────────────────────────────────────────────

export interface ContributeOpts {
  pool: PoolHandle;
  member: MemberHandle;
  cycle: number;
  /**
   * Schema routed to reputation::attest. Happy-path specs pass
   * Payment=1; late specs pass Late=2. The PDA derivation must
   * match on-chain (schema_id is part of the attestation seeds).
   */
  schemaId?: number;
}

export async function contribute(
  env: Env,
  opts: ContributeOpts,
): Promise<string> {
  const schemaId = opts.schemaId ?? ATTESTATION_SCHEMA.Payment;
  const nonce = attestationNonce(opts.cycle, opts.member.slotIndex);
  const attestation = attestationFor(
    env,
    opts.pool.pool,              // issuer
    opts.member.wallet.publicKey, // subject
    schemaId,
    nonce,
  );

  return env.programs.core.methods
    .contribute({ cycle: opts.cycle })
    .accounts({
      memberWallet: opts.member.wallet.publicKey,
      config: configPda(env),
      pool: opts.pool.pool,
      member: opts.member.member,
      usdcMint: opts.pool.usdcMint,
      memberUsdc: opts.member.memberUsdc,
      poolUsdcVault: opts.pool.poolUsdcVault,
      solidarityVaultAuthority: opts.pool.solidarityVaultAuthority,
      solidarityVault: opts.pool.solidarityVault,
      escrowVaultAuthority: opts.pool.escrowVaultAuthority,
      escrowVault: opts.pool.escrowVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      reputationProgram: env.ids.reputation,
      reputationConfig: reputationConfigFor(env),
      reputationProfile: reputationProfileFor(env, opts.member.wallet.publicKey),
      // Pass the reputation program itself to signal "no identity linked".
      identityRecord: env.ids.reputation,
      attestation,
      systemProgram: SystemProgram.programId,
    })
    .signers([opts.member.wallet])
    .rpc();
}

// ─── claim_payout ──────────────────────────────────────────────────────

export interface ClaimPayoutOpts {
  pool: PoolHandle;
  member: MemberHandle;
  cycle: number;
}

export async function claimPayout(
  env: Env,
  opts: ClaimPayoutOpts,
): Promise<string> {
  const nonce = attestationNonce(opts.cycle, opts.member.slotIndex);
  const attestation = attestationFor(
    env,
    opts.pool.pool,
    opts.member.wallet.publicKey,
    ATTESTATION_SCHEMA.CycleComplete,
    nonce,
  );

  return env.programs.core.methods
    .claimPayout({ cycle: opts.cycle })
    .accounts({
      memberWallet: opts.member.wallet.publicKey,
      config: configPda(env),
      pool: opts.pool.pool,
      member: opts.member.member,
      usdcMint: opts.pool.usdcMint,
      memberUsdc: opts.member.memberUsdc,
      poolUsdcVault: opts.pool.poolUsdcVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      reputationProgram: env.ids.reputation,
      reputationConfig: reputationConfigFor(env),
      reputationProfile: reputationProfileFor(env, opts.member.wallet.publicKey),
      identityRecord: env.ids.reputation,
      attestation,
      systemProgram: SystemProgram.programId,
    })
    .signers([opts.member.wallet])
    .rpc();
}

// ─── release_escrow ────────────────────────────────────────────────────

export interface ReleaseEscrowOpts {
  pool: PoolHandle;
  member: MemberHandle;
  checkpoint: number;
}

export async function releaseEscrow(
  env: Env,
  opts: ReleaseEscrowOpts,
): Promise<string> {
  return env.programs.core.methods
    .releaseEscrow({ checkpoint: opts.checkpoint })
    .accounts({
      memberWallet: opts.member.wallet.publicKey,
      config: configPda(env),
      pool: opts.pool.pool,
      member: opts.member.member,
      usdcMint: opts.pool.usdcMint,
      memberUsdc: opts.member.memberUsdc,
      escrowVaultAuthority: opts.pool.escrowVaultAuthority,
      escrowVault: opts.pool.escrowVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([opts.member.wallet])
    .rpc();
}

// ─── deposit_idle_to_yield ─────────────────────────────────────────────

export interface DepositIdleOpts {
  pool: PoolHandle;
  amount: bigint;
  caller?: Keypair;     // anyone can crank; defaults to env.payer
}

export async function depositIdleToYield(
  env: Env,
  opts: DepositIdleOpts,
): Promise<string> {
  const caller = opts.caller ?? env.payer;
  const mockState = yieldMockStatePda(env, opts.pool.pool);
  // Pass the MOCK's vault ATA as yield_vault — not the core-side
  // PoolHandle.yieldVault (that one stays empty in the mock setup).
  const mockVault = yieldMockVault(env, opts.pool.pool, opts.pool.usdcMint);

  return env.programs.core.methods
    .depositIdleToYield({ amount: new BN(opts.amount.toString()) })
    .accounts({
      caller: caller.publicKey,
      config: configPda(env),
      pool: opts.pool.pool,
      usdcMint: opts.pool.usdcMint,
      poolUsdcVault: opts.pool.poolUsdcVault,
      yieldVault: mockVault,
      yieldAdapterProgram: env.ids.yieldMock,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    // The mock needs its `state` PDA as the sole remaining account.
    .remainingAccounts([
      { pubkey: mockState, isSigner: false, isWritable: true },
    ])
    .signers([caller])
    .rpc();
}

// ─── harvest_yield ─────────────────────────────────────────────────────

export interface HarvestYieldOpts {
  pool: PoolHandle;
  treasuryUsdc: PublicKey;
  goodFaithShareBps?: number;     // defaults to 5_000 (50%)
  caller?: Keypair;
}

export async function harvestYield(
  env: Env,
  opts: HarvestYieldOpts,
): Promise<string> {
  const caller = opts.caller ?? env.payer;
  const mockState = yieldMockStatePda(env, opts.pool.pool);
  const mockVault = yieldMockVault(env, opts.pool.pool, opts.pool.usdcMint);

  return env.programs.core.methods
    .harvestYield({ goodFaithShareBps: opts.goodFaithShareBps ?? 5_000 })
    .accounts({
      caller: caller.publicKey,
      config: configPda(env),
      pool: opts.pool.pool,
      usdcMint: opts.pool.usdcMint,
      poolUsdcVault: opts.pool.poolUsdcVault,
      solidarityVaultAuthority: opts.pool.solidarityVaultAuthority,
      solidarityVault: opts.pool.solidarityVault,
      treasuryUsdc: opts.treasuryUsdc,
      yieldVault: mockVault,
      yieldAdapterProgram: env.ids.yieldMock,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .remainingAccounts([
      // Harvest reads state but does not mutate it.
      { pubkey: mockState, isSigner: false, isWritable: false },
    ])
    .signers([caller])
    .rpc();
}

// ─── close_pool ────────────────────────────────────────────────────────

export interface ClosePoolOpts {
  pool: PoolHandle;
  authority?: Keypair;    // defaults to pool.authority
}

export async function closePool(
  env: Env,
  opts: ClosePoolOpts,
): Promise<string> {
  const authority = opts.authority ?? opts.pool.authority;
  return env.programs.core.methods
    .closePool()
    .accounts({
      config: configPda(env),
      authority: authority.publicKey,
      pool: opts.pool.pool,
    })
    .signers([authority])
    .rpc();
}


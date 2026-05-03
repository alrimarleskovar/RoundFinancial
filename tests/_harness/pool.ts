/**
 * Reusable pool initializer.
 *
 * Specs typically need a pool that is either:
 *   - `Forming`  (for join-flow tests),
 *   - `Active`   (for contribute/claim/settle tests, i.e. all members joined),
 *   - `Completed` (for close_pool tests — built by rolling a pool
 *                  through its lifecycle, which higher-level specs
 *                  compose from `createPool` + `joinMembers`).
 *
 * This module provides the primitives:
 *   - `createPool(env, opts)`               → PoolHandle (status=Forming)
 *   - `joinPool(env, pool, opts)`           → MemberHandle (one join)
 *   - `joinMembers(env, pool, opts)`        → MemberHandle[] (N joins in order)
 *   - `createActivePool(env, opts)`         → PoolHandle (members_target joins already done)
 *
 * Stake math is mirrored here (not trusted from chain) so specs
 * can assert exact balances without a second `account.fetch`.
 */

import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

import { POOL_DEFAULTS, STAKE_BPS_BY_LEVEL } from "@roundfi/sdk";

import type { Env } from "./env.js";
import {
  configPda,
  escrowVaultAuthorityPda,
  memberPda,
  poolPda,
  positionAuthorityPda,
  reputationProfileFor,
  solidarityVaultAuthorityPda,
  yieldVaultAuthorityPda,
} from "./pda.js";
import { fundUsdc, USDC_UNIT } from "./mint.js";
import { ensureFunded } from "./airdrop.js";
import { METAPLEX_CORE_ID } from "./protocol.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface CreatePoolOpts {
  authority: Keypair;
  usdcMint: PublicKey;
  seedId?: bigint;
  membersTarget?: number;
  installmentAmount?: bigint;     // base units
  creditAmount?: bigint;          // base units
  cyclesTotal?: number;
  cycleDurationSec?: number;
  escrowReleaseBps?: number;
  yieldAdapter?: PublicKey;       // defaults to env.ids.yieldMock
}

export interface PoolHandle {
  pool: PublicKey;
  authority: Keypair;
  seedId: bigint;
  usdcMint: PublicKey;
  yieldAdapter: PublicKey;
  membersTarget: number;
  installmentAmount: bigint;
  creditAmount: bigint;
  cyclesTotal: number;
  cycleDurationSec: number;
  escrowReleaseBps: number;
  escrowVaultAuthority: PublicKey;
  solidarityVaultAuthority: PublicKey;
  yieldVaultAuthority: PublicKey;
  poolUsdcVault: PublicKey;
  escrowVault: PublicKey;
  solidarityVault: PublicKey;
  yieldVault: PublicKey;
}

export interface JoinOpts {
  member: Keypair;
  slotIndex: number;
  reputationLevel: 1 | 2 | 3;
  metadataUri?: string;
  /** Pre-fund the member's USDC ATA with the stake before joining. Default true. */
  prefundStake?: boolean;
  /** Pre-airdrop SOL for rent + tx fees. Default true (1 SOL). */
  prefundSol?: boolean;
}

export interface MemberHandle {
  member: PublicKey;              // member-record PDA
  wallet: Keypair;                // the joining signer
  nftAsset: Keypair;              // fresh keypair that became the NFT asset
  slotIndex: number;
  reputationLevel: 1 | 2 | 3;
  stakeBps: number;
  stakeAmount: bigint;            // credit_amount * stake_bps / 10_000
  memberUsdc: PublicKey;          // the member's USDC ATA
  positionAuthority: PublicKey;
}

// ─── Helpers ──────────────────────────────────────────────────────────

let defaultSeedCounter = 1n;
function nextSeedId(): bigint {
  // Keep test pool seeds unique across a single mocha run.
  return defaultSeedCounter++;
}

function stakeAmount(creditAmount: bigint, stakeBps: number): bigint {
  return (creditAmount * BigInt(stakeBps)) / 10_000n;
}

// ─── createPool ───────────────────────────────────────────────────────

export async function createPool(
  env: Env,
  opts: CreatePoolOpts,
): Promise<PoolHandle> {
  await ensureFunded(env, [opts.authority], 3);

  const seedId            = opts.seedId            ?? nextSeedId();
  const membersTarget     = opts.membersTarget     ?? POOL_DEFAULTS.membersTarget;
  const installmentAmount = opts.installmentAmount ?? POOL_DEFAULTS.installmentAmount;
  const creditAmount      = opts.creditAmount      ?? POOL_DEFAULTS.creditAmount;
  const cyclesTotal       = opts.cyclesTotal       ?? POOL_DEFAULTS.cyclesTotal;
  // Tests should prefer tiny cycle durations so time-based specs
  // can `sleep()` across boundaries in seconds instead of days.
  // Default to 60s (matches MIN_CYCLE_DURATION).
  const cycleDurationSec  = opts.cycleDurationSec  ?? 60;
  const escrowReleaseBps  = opts.escrowReleaseBps  ?? 2500;
  const yieldAdapter      = opts.yieldAdapter      ?? env.ids.yieldMock;

  const authorityPk = opts.authority.publicKey;
  const [pool] = poolPda(env.ids.core, authorityPk, seedId);
  const [escrowVaultAuthority] = escrowVaultAuthorityPda(env.ids.core, pool);
  const [solidarityVaultAuthority] = solidarityVaultAuthorityPda(env.ids.core, pool);
  const [yieldVaultAuthority] = yieldVaultAuthorityPda(env.ids.core, pool);

  const poolUsdcVault   = getAssociatedTokenAddressSync(opts.usdcMint, pool, true);
  const escrowVault     = getAssociatedTokenAddressSync(opts.usdcMint, escrowVaultAuthority, true);
  const solidarityVault = getAssociatedTokenAddressSync(opts.usdcMint, solidarityVaultAuthority, true);
  const yieldVault      = getAssociatedTokenAddressSync(opts.usdcMint, yieldVaultAuthority, true);

  await env.programs.core.methods
    .createPool({
      seedId:            new BN(seedId.toString()),
      membersTarget:     membersTarget,
      installmentAmount: new BN(installmentAmount.toString()),
      creditAmount:      new BN(creditAmount.toString()),
      cyclesTotal:       cyclesTotal,
      cycleDuration:     new BN(cycleDurationSec),
      escrowReleaseBps:  escrowReleaseBps,
    })
    .accounts({
      authority: authorityPk,
      config: configPda(env),
      pool,
      usdcMint: opts.usdcMint,
      yieldAdapter,
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
    })
    .signers([opts.authority])
    .rpc();

  return {
    pool,
    authority: opts.authority,
    seedId,
    usdcMint: opts.usdcMint,
    yieldAdapter,
    membersTarget,
    installmentAmount,
    creditAmount,
    cyclesTotal,
    cycleDurationSec,
    escrowReleaseBps,
    escrowVaultAuthority,
    solidarityVaultAuthority,
    yieldVaultAuthority,
    poolUsdcVault,
    escrowVault,
    solidarityVault,
    yieldVault,
  };
}

// ─── joinPool ─────────────────────────────────────────────────────────

export async function joinPool(
  env: Env,
  pool: PoolHandle,
  opts: JoinOpts,
): Promise<MemberHandle> {
  const prefundSol   = opts.prefundSol   ?? true;
  const prefundStake = opts.prefundStake ?? true;

  if (prefundSol) {
    await ensureFunded(env, [opts.member], 1);
  }

  const stakeBps = STAKE_BPS_BY_LEVEL[opts.reputationLevel];
  const stake = stakeAmount(pool.creditAmount, stakeBps);

  let memberUsdc: PublicKey;
  if (prefundStake) {
    memberUsdc = await fundUsdc(env, pool.usdcMint, opts.member.publicKey, stake);
  } else {
    memberUsdc = getAssociatedTokenAddressSync(pool.usdcMint, opts.member.publicKey);
  }

  const [member] = memberPda(env.ids.core, pool.pool, opts.member.publicKey);
  const [positionAuthority] = positionAuthorityPda(env.ids.core, pool.pool, opts.slotIndex);
  const nftAsset = Keypair.generate();

  const metadataUri = opts.metadataUri ?? `https://roundfi.test/position/${opts.slotIndex}`;

  // Step 4d: trusted reputation level — handler reads ReputationProfile
  // PDA owned by config.reputation_program. May be uninitialized for a
  // fresh wallet; the program treats absence as level 1.
  const reputationProfile = reputationProfileFor(env, opts.member.publicKey);

  // Metaplex Core CreateV2 is CU-heavy (>200k on first-of-run), so
  // pre-bump the budget to avoid flaky CI failures.
  const bumpCu = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });

  await env.programs.core.methods
    .joinPool({
      slotIndex: opts.slotIndex,
      reputationLevel: opts.reputationLevel,
      metadataUri,
    })
    .accounts({
      memberWallet: opts.member.publicKey,
      config: configPda(env),
      pool: pool.pool,
      member,
      usdcMint: pool.usdcMint,
      memberUsdc,
      escrowVaultAuthority: pool.escrowVaultAuthority,
      escrowVault: pool.escrowVault,
      positionAuthority,
      nftAsset: nftAsset.publicKey,
      metaplexCore: METAPLEX_CORE_ID,
      reputationProgram: env.ids.reputation,
      reputationProfile,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .preInstructions([bumpCu])
    .signers([opts.member, nftAsset])
    .rpc();

  return {
    member,
    wallet: opts.member,
    nftAsset,
    slotIndex: opts.slotIndex,
    reputationLevel: opts.reputationLevel,
    stakeBps,
    stakeAmount: stake,
    memberUsdc,
    positionAuthority,
  };
}

// ─── joinMembers / createActivePool ───────────────────────────────────

export interface JoinSlateEntry {
  member: Keypair;
  reputationLevel: 1 | 2 | 3;
}

/**
 * Join an ordered list of members into `pool`, allocating slot
 * indices 0, 1, 2, ... in input order. Returns MemberHandle[]
 * indexed by slot.
 *
 * Skips already-joined slots (useful for fixtures that build
 * a pool in stages across nested describe()s).
 */
export async function joinMembers(
  env: Env,
  pool: PoolHandle,
  slate: JoinSlateEntry[],
): Promise<MemberHandle[]> {
  if (slate.length > pool.membersTarget) {
    throw new Error(
      `joinMembers: slate has ${slate.length} entries but pool.membersTarget=${pool.membersTarget}`,
    );
  }
  const handles: MemberHandle[] = [];
  for (let i = 0; i < slate.length; i++) {
    const entry = slate[i]!;
    handles.push(
      await joinPool(env, pool, {
        member: entry.member,
        slotIndex: i,
        reputationLevel: entry.reputationLevel,
      }),
    );
  }
  return handles;
}

/**
 * One-shot helper: create a pool AND fill it to `membersTarget`,
 * transitioning status Forming → Active. Default fill uses all
 * Level-1 members (50% stake). Override via `levels`.
 */
export async function createActivePool(
  env: Env,
  opts: CreatePoolOpts & { levels?: (1 | 2 | 3)[]; members: Keypair[] },
): Promise<{ pool: PoolHandle; members: MemberHandle[] }> {
  if (opts.members.length !== (opts.membersTarget ?? POOL_DEFAULTS.membersTarget)) {
    throw new Error(
      "createActivePool: members.length must equal opts.membersTarget for the pool to activate",
    );
  }
  const pool = await createPool(env, opts);
  const levels = opts.levels ?? opts.members.map(() => 1 as const);
  if (levels.length !== opts.members.length) {
    throw new Error("createActivePool: levels.length != members.length");
  }
  const members = await joinMembers(
    env,
    pool,
    opts.members.map((m, i) => ({ member: m, reputationLevel: levels[i]! })),
  );
  return { pool, members };
}

// ─── Introspection ────────────────────────────────────────────────────

/** Loose type for tests that only need a handful of fields. */
export async function fetchPool(env: Env, pool: PublicKey): Promise<Record<string, unknown>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (env.programs.core.account as any).pool.fetch(pool)) as Record<string, unknown>;
}

export async function fetchMember(env: Env, member: PublicKey): Promise<Record<string, unknown>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (env.programs.core.account as any).member.fetch(member)) as Record<string, unknown>;
}

// Silence unused-import warning until first spec uses this helper.
void USDC_UNIT;

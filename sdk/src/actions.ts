/**
 * Action wrappers — one function per user-facing on-chain instruction.
 *
 * Each action:
 *   - derives every PDA / ATA it needs from `@roundfi/sdk/pda`,
 *   - runs minimal pre-flight validation (arg bounds; existence vs
 *     non-existence of init targets) and throws a clear error on
 *     misuse,
 *   - submits exactly ONE transaction (no retries, no batching),
 *   - returns `{ signature, context }` where `context` carries the
 *     derived addresses the caller will probably want next (e.g. the
 *     newly-created pool PDA or member PDA).
 *
 * Reputation-sidecar convention: when a member has no IdentityRecord
 * (the demo's default), `identityRecord` defaults to the reputation
 * program ID itself. This is the on-chain sentinel for "no identity
 * linked" (see programs/roundfi-core/src/cpi/reputation.rs).
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
import { BN, Program } from "@coral-xyz/anchor";

import { ATTESTATION_SCHEMA } from "./constants.js";
import {
  attestationNonce,
  attestationPda,
  escrowVaultAuthorityPda,
  memberPda,
  poolPda,
  positionAuthorityPda,
  protocolConfigPda,
  reputationConfigPda,
  reputationProfilePda,
  solidarityVaultAuthorityPda,
  yieldVaultAuthorityPda,
} from "./pda.js";

// Re-export `attestationNonce` from its new canonical home in `./pda` so
// existing call sites that `import { attestationNonce } from "@roundfi/sdk/actions"`
// (or via the barrel) keep working. Moved to `pda.ts` because it's a
// pure derivation helper — no Solana RPC, no Anchor program, just bit
// shifts on (cycle, slot). Front-end encoders use the lean PDA module
// directly to keep the browser bundle tight.
export { attestationNonce };
import type { AnyIdl, RoundFiClient } from "./client.js";

// Anchor's `Program<AnyIdl>.methods.<ix>` typing is union-of-undefined
// because AnyIdl has no instruction schema; we cast through this tiny
// helper so every call site stays readable. Runtime behavior is
// unchanged — the loaded IDL resolves the real method set.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function m(program: Program<AnyIdl>): any {
  return program.methods;
}

// ─── Shared types ────────────────────────────────────────────────────

/** The canonical return shape for every SDK action. */
export interface ActionResult<Context> {
  signature: string;
  context: Context;
}

/** Metaplex Core program ID — same on every cluster. */
export const METAPLEX_CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

/** Sentinel for "no IdentityRecord linked" — pass reputation_program itself. */
function noIdentityRecord(client: RoundFiClient): PublicKey {
  return client.ids.reputation;
}

async function requireAccountMissing(
  client: RoundFiClient,
  address: PublicKey,
  label: string,
): Promise<void> {
  const info = await client.connection.getAccountInfo(address, "confirmed");
  if (info) {
    throw new Error(
      `${label} already exists at ${address.toBase58()}; this action ` + `cannot re-initialize.`,
    );
  }
}

async function requireAccountPresent(
  client: RoundFiClient,
  address: PublicKey,
  label: string,
): Promise<void> {
  const info = await client.connection.getAccountInfo(address, "confirmed");
  if (!info) {
    throw new Error(
      `${label} not found at ${address.toBase58()}; ensure it is ` +
        `initialized before calling this action.`,
    );
  }
}

// ─── initializeProtocol ──────────────────────────────────────────────

export interface InitializeProtocolArgs {
  authority: Keypair;
  usdcMint: PublicKey;
  treasury: PublicKey; // pre-existing USDC ATA for fees
  feeBpsYield: number;
  feeBpsCycleL1: number;
  feeBpsCycleL2: number;
  feeBpsCycleL3: number;
  guaranteeFundBps: number;
  /** Defaults to client.ids.yieldAdapter. */
  defaultYieldAdapter?: PublicKey;
}

export interface InitializeProtocolContext {
  config: PublicKey;
  treasury: PublicKey;
  usdcMint: PublicKey;
}

export async function initializeProtocol(
  client: RoundFiClient,
  args: InitializeProtocolArgs,
): Promise<ActionResult<InitializeProtocolContext>> {
  const [config] = protocolConfigPda(client.ids.core);
  await requireAccountMissing(client, config, "ProtocolConfig");

  client.debug("action.initializeProtocol.start", {
    authority: args.authority.publicKey.toBase58(),
    usdcMint: args.usdcMint.toBase58(),
  });

  const signature = await m(client.programs.core)
    .initializeProtocol({
      feeBpsYield: args.feeBpsYield,
      feeBpsCycleL1: args.feeBpsCycleL1,
      feeBpsCycleL2: args.feeBpsCycleL2,
      feeBpsCycleL3: args.feeBpsCycleL3,
      guaranteeFundBps: args.guaranteeFundBps,
    })
    .accounts({
      authority: args.authority.publicKey,
      config,
      usdcMint: args.usdcMint,
      treasury: args.treasury,
      metaplexCore: METAPLEX_CORE_ID,
      defaultYieldAdapter: args.defaultYieldAdapter ?? client.ids.yieldAdapter,
      reputationProgram: client.ids.reputation,
    })
    .signers([args.authority])
    .rpc();

  client.debug("action.initializeProtocol.ok", { signature, config: config.toBase58() });
  return {
    signature,
    context: { config, treasury: args.treasury, usdcMint: args.usdcMint },
  };
}

// ─── createPool ──────────────────────────────────────────────────────

export interface CreatePoolArgs {
  authority: Keypair;
  usdcMint: PublicKey;
  seedId: bigint;
  membersTarget: number;
  installmentAmount: bigint;
  creditAmount: bigint;
  cyclesTotal: number;
  cycleDurationSec: number | bigint;
  escrowReleaseBps: number;
  /** Yield adapter program ID. Defaults to client.ids.yieldAdapter. */
  yieldAdapter?: PublicKey;
}

export interface CreatePoolContext {
  pool: PublicKey;
  seedId: bigint;
  usdcMint: PublicKey;
  yieldAdapter: PublicKey;
  poolUsdcVault: PublicKey;
  escrowVault: PublicKey;
  solidarityVault: PublicKey;
  yieldVault: PublicKey;
  escrowVaultAuthority: PublicKey;
  solidarityVaultAuthority: PublicKey;
  yieldVaultAuthority: PublicKey;
}

export async function createPool(
  client: RoundFiClient,
  args: CreatePoolArgs,
): Promise<ActionResult<CreatePoolContext>> {
  if (args.membersTarget < 2 || args.membersTarget > 64) {
    throw new Error("createPool: membersTarget must be in [2, 64]");
  }
  if (args.cyclesTotal < 1 || args.cyclesTotal > 255) {
    throw new Error("createPool: cyclesTotal must be in [1, 255]");
  }

  const [config] = protocolConfigPda(client.ids.core);
  const [pool] = poolPda(client.ids.core, args.authority.publicKey, args.seedId);
  const [escrowVaultAuthority] = escrowVaultAuthorityPda(client.ids.core, pool);
  const [solidarityVaultAuthority] = solidarityVaultAuthorityPda(client.ids.core, pool);
  const [yieldVaultAuthority] = yieldVaultAuthorityPda(client.ids.core, pool);
  const yieldAdapter = args.yieldAdapter ?? client.ids.yieldAdapter;

  await requireAccountPresent(client, config, "ProtocolConfig");
  await requireAccountMissing(client, pool, "Pool");

  const poolUsdcVault = getAssociatedTokenAddressSync(args.usdcMint, pool, true);
  const escrowVault = getAssociatedTokenAddressSync(args.usdcMint, escrowVaultAuthority, true);
  const solidarityVault = getAssociatedTokenAddressSync(
    args.usdcMint,
    solidarityVaultAuthority,
    true,
  );
  const yieldVault = getAssociatedTokenAddressSync(args.usdcMint, yieldVaultAuthority, true);

  client.debug("action.createPool.start", {
    pool: pool.toBase58(),
    seedId: args.seedId.toString(),
    membersTarget: args.membersTarget,
  });

  const signature = await m(client.programs.core)
    .createPool({
      seedId: new BN(args.seedId.toString()),
      membersTarget: args.membersTarget,
      installmentAmount: new BN(args.installmentAmount.toString()),
      creditAmount: new BN(args.creditAmount.toString()),
      cyclesTotal: args.cyclesTotal,
      cycleDuration: new BN(args.cycleDurationSec.toString()),
      escrowReleaseBps: args.escrowReleaseBps,
    })
    .accounts({
      authority: args.authority.publicKey,
      config,
      pool,
      usdcMint: args.usdcMint,
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
    .signers([args.authority])
    .rpc();

  client.debug("action.createPool.ok", { signature, pool: pool.toBase58() });
  return {
    signature,
    context: {
      pool,
      seedId: args.seedId,
      usdcMint: args.usdcMint,
      yieldAdapter,
      poolUsdcVault,
      escrowVault,
      solidarityVault,
      yieldVault,
      escrowVaultAuthority,
      solidarityVaultAuthority,
      yieldVaultAuthority,
    },
  };
}

// ─── joinPool ────────────────────────────────────────────────────────

export interface JoinPoolArgs {
  pool: PublicKey;
  usdcMint: PublicKey;
  memberWallet: Keypair;
  slotIndex: number;
  reputationLevel: 1 | 2 | 3;
  metadataUri?: string;
  /**
   * Fresh asset keypair for Metaplex Core. Generated if omitted.
   *
   * **IMPORTANT (Adevar Labs SEV-017):** this keypair MUST be freshly
   * generated and discarded after the join_pool tx confirms. The
   * on-chain `nft_asset` account is declared as `UncheckedAccount` with
   * `signer = true` but does NOT validate that the address is freshly-
   * minted. If the caller passes an existing wallet keypair as
   * `nftAsset`, mpl-core's `CreateV2` CPI will fail at runtime
   * (account already initialized) — so this isn't a fund-loss risk,
   * but a malicious or careless caller could pass display-name-similar
   * keypairs to create UX-confusing assets. SDK consumers: never
   * reuse this slot for a long-lived signer.
   */
  nftAsset?: Keypair;
  /** Pre-existing USDC ATA for the member (must hold the stake). */
  memberUsdc?: PublicKey;
}

export interface JoinPoolContext {
  member: PublicKey;
  memberWallet: PublicKey;
  nftAsset: PublicKey;
  positionAuthority: PublicKey;
  slotIndex: number;
  reputationLevel: 1 | 2 | 3;
  memberUsdc: PublicKey;
}

export async function joinPool(
  client: RoundFiClient,
  args: JoinPoolArgs,
): Promise<ActionResult<JoinPoolContext>> {
  if (args.slotIndex < 0 || args.slotIndex >= 64) {
    throw new Error("joinPool: slotIndex must be in [0, 64)");
  }
  if (args.reputationLevel < 1 || args.reputationLevel > 3) {
    throw new Error("joinPool: reputationLevel must be 1, 2, or 3");
  }

  const [config] = protocolConfigPda(client.ids.core);
  const [member] = memberPda(client.ids.core, args.pool, args.memberWallet.publicKey);
  const [positionAuthority] = positionAuthorityPda(client.ids.core, args.pool, args.slotIndex);
  const [escrowVaultAuthority] = escrowVaultAuthorityPda(client.ids.core, args.pool);

  await requireAccountPresent(client, args.pool, "Pool");
  await requireAccountMissing(client, member, "Member");

  const nftAsset = args.nftAsset ?? Keypair.generate();
  const memberUsdc =
    args.memberUsdc ?? getAssociatedTokenAddressSync(args.usdcMint, args.memberWallet.publicKey);
  const escrowVault = getAssociatedTokenAddressSync(args.usdcMint, escrowVaultAuthority, true);

  // Step 4d audit close-out: trusted reputation level. Core reads the
  // ReputationProfile PDA owned by config.reputation_program and rejects
  // if `args.reputationLevel` doesn't match `profile.level`. A missing
  // profile (fresh wallet) is canonical level 1.
  const [reputationProfile] = reputationProfilePda(
    client.ids.reputation,
    args.memberWallet.publicKey,
  );

  const metadataUri = args.metadataUri ?? `https://roundfi.app/position/${args.slotIndex}`;
  const bumpCu = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });

  client.debug("action.joinPool.start", {
    pool: args.pool.toBase58(),
    slotIndex: args.slotIndex,
    reputationLevel: args.reputationLevel,
  });

  const signature = await m(client.programs.core)
    .joinPool({
      slotIndex: args.slotIndex,
      reputationLevel: args.reputationLevel,
      metadataUri,
    })
    .accounts({
      memberWallet: args.memberWallet.publicKey,
      config,
      pool: args.pool,
      member,
      usdcMint: args.usdcMint,
      memberUsdc,
      escrowVaultAuthority,
      escrowVault,
      positionAuthority,
      nftAsset: nftAsset.publicKey,
      metaplexCore: METAPLEX_CORE_ID,
      reputationProgram: client.ids.reputation,
      reputationProfile,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .preInstructions([bumpCu])
    .signers([args.memberWallet, nftAsset])
    .rpc();

  client.debug("action.joinPool.ok", { signature, member: member.toBase58() });
  return {
    signature,
    context: {
      member,
      memberWallet: args.memberWallet.publicKey,
      nftAsset: nftAsset.publicKey,
      positionAuthority,
      slotIndex: args.slotIndex,
      reputationLevel: args.reputationLevel,
      memberUsdc,
    },
  };
}

// ─── contribute ──────────────────────────────────────────────────────

export interface ContributeArgs {
  pool: PublicKey;
  usdcMint: PublicKey;
  memberWallet: Keypair;
  slotIndex: number;
  cycle: number;
  /** Payment=1 for on-time, Late=2 for overdue-but-within-grace. */
  schemaId?: number;
  identityRecord?: PublicKey;
}

export interface ContributeContext {
  pool: PublicKey;
  member: PublicKey;
  cycle: number;
  attestation: PublicKey;
}

export async function contribute(
  client: RoundFiClient,
  args: ContributeArgs,
): Promise<ActionResult<ContributeContext>> {
  const [config] = protocolConfigPda(client.ids.core);
  const [member] = memberPda(client.ids.core, args.pool, args.memberWallet.publicKey);
  const [reputationConfig] = reputationConfigPda(client.ids.reputation);
  const [reputationProfile] = reputationProfilePda(
    client.ids.reputation,
    args.memberWallet.publicKey,
  );
  const [escrowVaultAuthority] = escrowVaultAuthorityPda(client.ids.core, args.pool);
  const [solidarityVaultAuthority] = solidarityVaultAuthorityPda(client.ids.core, args.pool);

  await requireAccountPresent(client, args.pool, "Pool");
  await requireAccountPresent(client, member, "Member");

  const schemaId = args.schemaId ?? ATTESTATION_SCHEMA.Payment;
  const nonce = attestationNonce(args.cycle, args.slotIndex);
  const [attestation] = attestationPda(
    client.ids.reputation,
    args.pool,
    args.memberWallet.publicKey,
    schemaId,
    nonce,
  );

  const memberUsdc = getAssociatedTokenAddressSync(args.usdcMint, args.memberWallet.publicKey);
  const poolUsdcVault = getAssociatedTokenAddressSync(args.usdcMint, args.pool, true);
  const escrowVault = getAssociatedTokenAddressSync(args.usdcMint, escrowVaultAuthority, true);
  const solidarityVault = getAssociatedTokenAddressSync(
    args.usdcMint,
    solidarityVaultAuthority,
    true,
  );

  client.debug("action.contribute.start", {
    pool: args.pool.toBase58(),
    cycle: args.cycle,
    slotIndex: args.slotIndex,
    schemaId,
  });

  const signature = await m(client.programs.core)
    .contribute({ cycle: args.cycle })
    .accounts({
      memberWallet: args.memberWallet.publicKey,
      config,
      pool: args.pool,
      member,
      usdcMint: args.usdcMint,
      memberUsdc,
      poolUsdcVault,
      solidarityVaultAuthority,
      solidarityVault,
      escrowVaultAuthority,
      escrowVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      reputationProgram: client.ids.reputation,
      reputationConfig,
      reputationProfile,
      identityRecord: args.identityRecord ?? noIdentityRecord(client),
      attestation,
      systemProgram: SystemProgram.programId,
    })
    .signers([args.memberWallet])
    .rpc();

  client.debug("action.contribute.ok", { signature });
  return {
    signature,
    context: { pool: args.pool, member, cycle: args.cycle, attestation },
  };
}

// ─── claimPayout ─────────────────────────────────────────────────────

export interface ClaimPayoutArgs {
  pool: PublicKey;
  usdcMint: PublicKey;
  memberWallet: Keypair;
  slotIndex: number;
  cycle: number;
  identityRecord?: PublicKey;
}

export interface ClaimPayoutContext {
  pool: PublicKey;
  member: PublicKey;
  cycle: number;
  attestation: PublicKey;
}

export async function claimPayout(
  client: RoundFiClient,
  args: ClaimPayoutArgs,
): Promise<ActionResult<ClaimPayoutContext>> {
  const [config] = protocolConfigPda(client.ids.core);
  const [member] = memberPda(client.ids.core, args.pool, args.memberWallet.publicKey);
  const [reputationConfig] = reputationConfigPda(client.ids.reputation);
  const [reputationProfile] = reputationProfilePda(
    client.ids.reputation,
    args.memberWallet.publicKey,
  );

  await requireAccountPresent(client, args.pool, "Pool");
  await requireAccountPresent(client, member, "Member");

  const nonce = attestationNonce(args.cycle, args.slotIndex);
  const [attestation] = attestationPda(
    client.ids.reputation,
    args.pool,
    args.memberWallet.publicKey,
    ATTESTATION_SCHEMA.CycleComplete,
    nonce,
  );

  const memberUsdc = getAssociatedTokenAddressSync(args.usdcMint, args.memberWallet.publicKey);
  const poolUsdcVault = getAssociatedTokenAddressSync(args.usdcMint, args.pool, true);

  client.debug("action.claimPayout.start", {
    pool: args.pool.toBase58(),
    cycle: args.cycle,
    slotIndex: args.slotIndex,
  });

  const signature = await m(client.programs.core)
    .claimPayout({ cycle: args.cycle })
    .accounts({
      memberWallet: args.memberWallet.publicKey,
      config,
      pool: args.pool,
      member,
      usdcMint: args.usdcMint,
      memberUsdc,
      poolUsdcVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      reputationProgram: client.ids.reputation,
      reputationConfig,
      reputationProfile,
      identityRecord: args.identityRecord ?? noIdentityRecord(client),
      attestation,
      systemProgram: SystemProgram.programId,
    })
    .signers([args.memberWallet])
    .rpc();

  client.debug("action.claimPayout.ok", { signature });
  return {
    signature,
    context: { pool: args.pool, member, cycle: args.cycle, attestation },
  };
}

// ─── settleDefault ───────────────────────────────────────────────────

export interface SettleDefaultArgs {
  pool: PublicKey;
  usdcMint: PublicKey;
  /** Wallet of the member being settled (does NOT sign). */
  defaultedMemberWallet: PublicKey;
  slotIndex: number;
  cycle: number;
  /** Who pays for the reputation attestation init. Defaults to provider wallet. */
  caller?: Keypair;
  identityRecord?: PublicKey;
}

export interface SettleDefaultContext {
  pool: PublicKey;
  member: PublicKey;
  cycle: number;
  attestation: PublicKey;
}

export async function settleDefault(
  client: RoundFiClient,
  args: SettleDefaultArgs,
): Promise<ActionResult<SettleDefaultContext>> {
  const [config] = protocolConfigPda(client.ids.core);
  const [member] = memberPda(client.ids.core, args.pool, args.defaultedMemberWallet);
  const [reputationConfig] = reputationConfigPda(client.ids.reputation);
  const [reputationProfile] = reputationProfilePda(
    client.ids.reputation,
    args.defaultedMemberWallet,
  );
  const [escrowVaultAuthority] = escrowVaultAuthorityPda(client.ids.core, args.pool);
  const [solidarityVaultAuthority] = solidarityVaultAuthorityPda(client.ids.core, args.pool);

  await requireAccountPresent(client, args.pool, "Pool");
  await requireAccountPresent(client, member, "Member");

  const nonce = attestationNonce(args.cycle, args.slotIndex);
  const [attestation] = attestationPda(
    client.ids.reputation,
    args.pool,
    args.defaultedMemberWallet,
    ATTESTATION_SCHEMA.Default,
    nonce,
  );

  const poolUsdcVault = getAssociatedTokenAddressSync(args.usdcMint, args.pool, true);
  const escrowVault = getAssociatedTokenAddressSync(args.usdcMint, escrowVaultAuthority, true);
  const solidarityVault = getAssociatedTokenAddressSync(
    args.usdcMint,
    solidarityVaultAuthority,
    true,
  );

  client.debug("action.settleDefault.start", {
    pool: args.pool.toBase58(),
    defaultedMember: args.defaultedMemberWallet.toBase58(),
    cycle: args.cycle,
  });

  const builder = m(client.programs.core)
    .settleDefault({ cycle: args.cycle })
    .accounts({
      caller: (args.caller?.publicKey ?? client.provider.publicKey)!,
      config,
      pool: args.pool,
      member,
      defaultedMemberWallet: args.defaultedMemberWallet,
      usdcMint: args.usdcMint,
      poolUsdcVault,
      solidarityVaultAuthority,
      solidarityVault,
      escrowVaultAuthority,
      escrowVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      reputationProgram: client.ids.reputation,
      reputationConfig,
      reputationProfile,
      identityRecord: args.identityRecord ?? noIdentityRecord(client),
      attestation,
      systemProgram: SystemProgram.programId,
    });

  const signature = await (args.caller ? builder.signers([args.caller]).rpc() : builder.rpc());

  client.debug("action.settleDefault.ok", { signature });
  return {
    signature,
    context: { pool: args.pool, member, cycle: args.cycle, attestation },
  };
}

// ─── closePool ───────────────────────────────────────────────────────

export interface ClosePoolArgs {
  authority: Keypair;
  pool: PublicKey;
}

export interface ClosePoolContext {
  pool: PublicKey;
}

export async function closePool(
  client: RoundFiClient,
  args: ClosePoolArgs,
): Promise<ActionResult<ClosePoolContext>> {
  const [config] = protocolConfigPda(client.ids.core);
  await requireAccountPresent(client, args.pool, "Pool");

  client.debug("action.closePool.start", { pool: args.pool.toBase58() });

  const signature = await m(client.programs.core)
    .closePool()
    .accounts({
      config,
      authority: args.authority.publicKey,
      pool: args.pool,
    })
    .signers([args.authority])
    .rpc();

  client.debug("action.closePool.ok", { signature });
  return { signature, context: { pool: args.pool } };
}

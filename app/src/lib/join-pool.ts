/**
 * IDL-free encoder + sender for the `roundfi-core::join_pool` instruction,
 * callable from the browser via the wallet adapter. Sibling of
 * `contribute.ts` / `claim-payout.ts` / `escape-valve-buy.ts`.
 *
 * join_pool is the heaviest write path the app wires: it mints the member's
 * position NFT through a Metaplex-Core CreateV2 CPI, locks the
 * reputation-tiered stake in escrow, and inits the Member PDA. Two
 * consequences for the client:
 *   1. `nft_asset` is a FRESH keypair that must co-sign the tx — passed via
 *      the wallet adapter's `signers` option (the wallet itself signs as
 *      fee payer + member_wallet).
 *   2. The mpl-core mint CPI blows past the 200k-CU default, so the sender
 *      raises the compute-unit limit.
 *
 * `reputation_level` is an ASSERTION the program re-derives from the on-chain
 * `ReputationProfile` PDA (owned by `config.reputation_program`) and rejects
 * on mismatch — the audit Step-4d close-out. The sender reads the profile
 * (absent ≡ level 1) so the assertion is always correct.
 *
 * The discriminator + account ordering must match
 * `programs/roundfi-core/src/instructions/join_pool.rs` exactly (17 accounts).
 * Any drift surfaces immediately as `AccountNotInitialized` / `ConstraintSeeds`
 * from the program — diagnosable, not silent.
 *
 * Pre-conditions (program-enforced; surfaced by the modal so the user sees a
 * clean message instead of a runtime panic):
 *   - pool.status == Forming && members_joined < members_target,
 *   - slot_index is free (program marks it taken; reverts on InvalidSlot),
 *   - member's USDC ATA holds at least the tier stake,
 *   - wallet doesn't already own a Member PDA in this pool (Anchor `init`).
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import {
  escrowVaultAuthorityPda,
  memberPda,
  positionAuthorityPda,
  protocolConfigPda,
  reputationProfilePda,
} from "@roundfi/sdk/pda";

import { DEVNET_PROGRAM_IDS, DEVNET_USDC_MINT } from "./devnet";

// sha256("global:join_pool")[:8] — precomputed so the bundle needs no hash
// dep.  $ node -e 'console.log(require("crypto").createHash("sha256")
//          .update("global:join_pool").digest().subarray(0,8).toString("hex"))'
//        → 0e413e107411c36b
const JOIN_POOL_DISCRIMINATOR = Buffer.from([0x0e, 0x41, 0x3e, 0x10, 0x74, 0x11, 0xc3, 0x6b]);

// mpl-core program — fixed across clusters, constraint-checked on-chain
// against `config.metaplex_core`. Same constant as escape-valve-buy.ts.
const MPL_CORE_PROGRAM = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

// ReputationProfile layout: discriminator(8) + wallet(32) → `level` (u8) at
// offset 40. Source: programs/roundfi-reputation/src/state/profile.rs.
const PROFILE_LEVEL_OFFSET = 40;

export interface BuildJoinPoolIxArgs {
  /** Pool PDA (mutable). Must be in Forming status. */
  pool: PublicKey;
  /** Connected wallet — signs + pays. Becomes the new Member. */
  memberWallet: PublicKey;
  /** Fresh keypair pubkey that becomes the position NFT asset (co-signer). */
  nftAsset: PublicKey;
  /** Slot to occupy (0..members_target-1). Client picks the first free slot. */
  slotIndex: number;
  /** Reputation level assertion (1..=4) — MUST equal the on-chain profile
   *  level (absent ≡ 1) or the program rejects with ReputationLevelMismatch. */
  reputationLevel: number;
  /** Position NFT metadata URI. Scheme must be https:// / ipfs:// / ar://. */
  metadataUri: string;
  /** Optional program ID overrides — for bankrun tests. Production callers
   *  do NOT pass this; the encoder picks devnet by default. */
  programIds?: { core: PublicKey; reputation: PublicKey };
  /** Optional USDC mint override — pairs with programIds for tests. */
  usdcMint?: PublicKey;
}

/**
 * Build the raw `join_pool(slot_index, reputation_level, metadata_uri)`
 * instruction. Account order MUST match `JoinPool<'info>` in
 * `programs/roundfi-core/src/instructions/join_pool.rs` (17 accounts).
 */
export function buildJoinPoolIx(args: BuildJoinPoolIxArgs): TransactionInstruction {
  const core = args.programIds?.core ?? DEVNET_PROGRAM_IDS.core;
  const reputation = args.programIds?.reputation ?? DEVNET_PROGRAM_IDS.reputation;
  const usdcMint = args.usdcMint ?? DEVNET_USDC_MINT;

  const [config] = protocolConfigPda(core);
  const [member] = memberPda(core, args.pool, args.memberWallet);
  const [escrowAuth] = escrowVaultAuthorityPda(core, args.pool);
  const [positionAuth] = positionAuthorityPda(core, args.pool, args.slotIndex);
  const [repProfile] = reputationProfilePda(reputation, args.memberWallet);

  const memberUsdc = getAssociatedTokenAddressSync(usdcMint, args.memberWallet);
  const escrowVault = getAssociatedTokenAddressSync(usdcMint, escrowAuth, true);

  // [disc(8) | slot_index u8(1) | reputation_level u8(1) | metadata_uri
  //  (u32 LE length + utf8 bytes)] — Anchor String serialization.
  const uriBytes = Buffer.from(args.metadataUri, "utf8");
  const uriLen = Buffer.alloc(4);
  uriLen.writeUInt32LE(uriBytes.length, 0);
  const data = Buffer.concat([
    JOIN_POOL_DISCRIMINATOR,
    Buffer.from([args.slotIndex & 0xff, args.reputationLevel & 0xff]),
    uriLen,
    uriBytes,
  ]);

  return new TransactionInstruction({
    programId: core,
    data,
    keys: [
      { pubkey: args.memberWallet, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: args.pool, isSigner: false, isWritable: true },
      { pubkey: member, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: memberUsdc, isSigner: false, isWritable: true },
      { pubkey: escrowAuth, isSigner: false, isWritable: false },
      { pubkey: escrowVault, isSigner: false, isWritable: true },
      { pubkey: positionAuth, isSigner: false, isWritable: false },
      { pubkey: args.nftAsset, isSigner: true, isWritable: true },
      { pubkey: MPL_CORE_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: reputation, isSigner: false, isWritable: false },
      { pubkey: repProfile, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
  });
}

export interface SendJoinPoolArgs {
  connection: Connection;
  /** Wallet adapter callback — must support the `signers` option so the
   *  fresh nft_asset keypair can co-sign alongside the wallet. */
  sendTransaction: (
    tx: Transaction,
    connection: Connection,
    options?: { signers?: Keypair[] },
  ) => Promise<string>;
  pool: PublicKey;
  memberWallet: PublicKey;
  /** Slot to occupy — caller resolves the first free slot from usePoolMembers. */
  slotIndex: number;
  /** Optional metadata URI override; defaults to an https:// placeholder. */
  metadataUri?: string;
}

/**
 * Resolve the on-chain reputation level (absent profile ≡ level 1), mint a
 * fresh position-NFT keypair, build the join_pool ix, raise the CU limit for
 * the mpl-core mint CPI, dispatch via the wallet adapter (co-signing with the
 * NFT keypair), and return the confirmed signature (or throw — the caller
 * renders the program revert).
 */
export async function sendJoinPool(args: SendJoinPoolArgs): Promise<string> {
  const reputation = DEVNET_PROGRAM_IDS.reputation;

  // The program re-derives the trusted level from the ReputationProfile and
  // rejects `args.reputation_level` on mismatch — read it so our assertion is
  // always correct. A missing / too-short account is the fresh-wallet level-1
  // case (mirrors the program's own default).
  const [repProfile] = reputationProfilePda(reputation, args.memberWallet);
  const profileInfo = await args.connection.getAccountInfo(repProfile, "confirmed");
  const reputationLevel =
    !profileInfo || profileInfo.data.length <= PROFILE_LEVEL_OFFSET
      ? 1
      : Math.min(4, Math.max(1, profileInfo.data[PROFILE_LEVEL_OFFSET]!));

  const nftAsset = Keypair.generate();
  const metadataUri =
    args.metadataUri ??
    `https://roundfi.app/positions/${args.pool.toBase58()}/${args.slotIndex}.json`;

  const ix = buildJoinPoolIx({
    pool: args.pool,
    memberWallet: args.memberWallet,
    nftAsset: nftAsset.publicKey,
    slotIndex: args.slotIndex,
    reputationLevel,
    metadataUri,
  });

  // The mpl-core CreateV2 CPI (+ the stake token transfer) blows past the
  // 200k-CU default. 400k is a safe ceiling, well under the 1.4M per-tx cap.
  const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });

  const tx = new Transaction().add(cu, ix);
  const { blockhash, lastValidBlockHeight } = await args.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = args.memberWallet;

  // The NFT asset keypair co-signs (it's a fresh account the program inits via
  // the mpl-core CPI); the wallet signs as fee payer + member_wallet.
  const signature = await args.sendTransaction(tx, args.connection, { signers: [nftAsset] });
  await args.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return signature;
}

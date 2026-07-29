/**
 * IDL-free encoders + senders for the sealed free bid
 * (ADR 0012 Fase 3 — `place_bid_commit` / `place_bid_reveal`).
 *
 * Two instructions, one auction:
 *   - **commit** seals `sha256(amount ‖ salt ‖ bidder)` while bidding is
 *     open (`clock < pool.next_cycle_at`). No funds move.
 *   - **reveal** opens the envelope after the deadline, PAYS the bid as K
 *     whole installments through the normal `split_installment` partition,
 *     and adjudicates it with the Fase 2 rule — atomically.
 *
 * A losing reveal REVERTS (`EmbeddedBidTooShallow`), so the bidder's USDC
 * never leaves their wallet: there is no bid vault and no refund to build
 * a UI around. That is why this file has no `withdrawBid`.
 *
 * Account order MUST match `PlaceBidCommit<'info>` / `PlaceBidReveal<'info>`
 * in programs/roundfi-core/src/instructions/place_bid_{commit,reveal}.rs.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { ATTESTATION_SCHEMA } from "@roundfi/sdk/constants";
import {
  attestationNonce,
  attestationPda,
  bidPda,
  drawResultPda,
  escrowVaultAuthorityPda,
  memberPda,
  protocolConfigPda,
  reputationConfigPda,
  reputationProfilePda,
  solidarityVaultAuthorityPda,
} from "@roundfi/sdk/pda";

import { DEVNET_PROGRAM_IDS, DEVNET_USDC_MINT } from "./devnet";
import { confirmOrThrow, simulateOrThrow } from "./simulateTx";

// sha256("global:place_bid_commit")[:8] and ("global:place_bid_reveal")[:8].
//   $ node -e 'console.log(require("crypto").createHash("sha256")
//                .update("global:place_bid_commit").digest()
//                .subarray(0,8).toString("hex"))'
//   → ee9872a61472c0aa / 2644e1cb6a97a750
const PLACE_BID_COMMIT_DISCRIMINATOR = Buffer.from([
  0xee, 0x98, 0x72, 0xa6, 0x14, 0x72, 0xc0, 0xaa,
]);
const PLACE_BID_REVEAL_DISCRIMINATOR = Buffer.from([
  0x26, 0x44, 0xe1, 0xcb, 0x6a, 0x97, 0xa7, 0x50,
]);

export interface BuildPlaceBidCommitIxArgs {
  pool: PublicKey;
  bidder: PublicKey;
  /** Must equal `pool.current_cycle` — also a PDA seed. */
  cycle: number;
  /** 32 bytes: `sha256(amount_le ‖ salt_le ‖ bidder)`. */
  commitHash: Uint8Array;
  programIds?: { core: PublicKey };
}

/** Build `place_bid_commit(cycle, commit_hash)` — 6 accounts. */
export function buildPlaceBidCommitIx(args: BuildPlaceBidCommitIxArgs): TransactionInstruction {
  const core = args.programIds?.core ?? DEVNET_PROGRAM_IDS.core;
  if (args.commitHash.length !== 32) {
    throw new Error(`commitHash must be 32 bytes, got ${args.commitHash.length}`);
  }
  const [config] = protocolConfigPda(core);
  const [member] = memberPda(core, args.pool, args.bidder);
  const [bid] = bidPda(core, args.pool, args.cycle, args.bidder);

  // [discriminator (8) | cycle (u8) | commit_hash (32)] = 41 bytes.
  const data = Buffer.concat([
    PLACE_BID_COMMIT_DISCRIMINATOR,
    Buffer.from([args.cycle & 0xff]),
    Buffer.from(args.commitHash),
  ]);

  return new TransactionInstruction({
    programId: core,
    data,
    keys: [
      { pubkey: args.bidder, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: args.pool, isSigner: false, isWritable: false },
      { pubkey: member, isSigner: false, isWritable: false },
      { pubkey: bid, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

export interface BuildPlaceBidRevealIxArgs {
  pool: PublicKey;
  bidder: PublicKey;
  cycle: number;
  /** Installments the bid buys. The amount is derived as
   *  `parcels × installmentAmount`, which is the only way to satisfy the
   *  program's exact-multiple rule by construction. */
  parcels: number;
  installmentAmount: bigint;
  salt: bigint;
  /** `member.contributions_paid` BEFORE the reveal — drives the nonce. */
  contributionsPaid: number;
  /** `pool.cycles_total` — decides the PoolComplete escalation. */
  cyclesTotal: number;
  /** The bidder's seat (`member.slot_index`) — the nonce's low half. */
  slotIndex: number;
  programIds?: { core: PublicKey; reputation: PublicKey };
  usdcMint?: PublicKey;
}

/**
 * Build `place_bid_reveal(cycle, amount, salt)` — 20 accounts.
 *
 * The attestation PDA must match what the handler derives: ONE attestation
 * for the whole K-installment event, nonced on the LAST installment paid
 * (`contributions_paid + K − 1`), escalating to POOL_COMPLETE when the bid
 * pays through the pool's final installment. Deriving it any other way
 * fails with ConstraintSeeds — the same class of bug that once rejected
 * every pool's last `contribute`.
 */
export function buildPlaceBidRevealIx(args: BuildPlaceBidRevealIxArgs): TransactionInstruction {
  const core = args.programIds?.core ?? DEVNET_PROGRAM_IDS.core;
  const reputation = args.programIds?.reputation ?? DEVNET_PROGRAM_IDS.reputation;
  const usdcMint = args.usdcMint ?? DEVNET_USDC_MINT;

  const [config] = protocolConfigPda(core);
  const [member] = memberPda(core, args.pool, args.bidder);
  const [bid] = bidPda(core, args.pool, args.cycle, args.bidder);
  const [draw] = drawResultPda(core, args.pool);
  const [solidarityAuth] = solidarityVaultAuthorityPda(core, args.pool);
  const [escrowAuth] = escrowVaultAuthorityPda(core, args.pool);
  const [repConfig] = reputationConfigPda(reputation);
  const [repProfile] = reputationProfilePda(reputation, args.bidder);

  if (!Number.isInteger(args.parcels) || args.parcels < 1) {
    throw new Error(`parcels must be a positive integer, got ${args.parcels}`);
  }
  const amount = BigInt(args.parcels) * args.installmentAmount;
  const paidAfter = args.contributionsPaid + args.parcels;
  const schemaId =
    paidAfter === args.cyclesTotal ? ATTESTATION_SCHEMA.PoolComplete : ATTESTATION_SCHEMA.Payment;
  const nonce = attestationNonce(paidAfter - 1, args.slotIndex);
  const [attestation] = attestationPda(reputation, args.pool, args.bidder, schemaId, nonce);

  const bidderUsdc = getAssociatedTokenAddressSync(usdcMint, args.bidder);
  const poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, args.pool, true);
  const solidarityVault = getAssociatedTokenAddressSync(usdcMint, solidarityAuth, true);
  const escrowVault = getAssociatedTokenAddressSync(usdcMint, escrowAuth, true);

  // [discriminator (8) | cycle (u8) | amount (u64 LE) | salt (u64 LE)] = 25.
  const data = Buffer.alloc(25);
  PLACE_BID_REVEAL_DISCRIMINATOR.copy(data, 0);
  data.writeUInt8(args.cycle & 0xff, 8);
  data.writeBigUInt64LE(amount, 9);
  data.writeBigUInt64LE(args.salt, 17);

  return new TransactionInstruction({
    programId: core,
    data,
    keys: [
      { pubkey: args.bidder, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: args.pool, isSigner: false, isWritable: true },
      { pubkey: member, isSigner: false, isWritable: true },
      { pubkey: bid, isSigner: false, isWritable: true },
      { pubkey: draw, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: bidderUsdc, isSigner: false, isWritable: true },
      { pubkey: poolUsdcVault, isSigner: false, isWritable: true },
      { pubkey: solidarityAuth, isSigner: false, isWritable: false },
      { pubkey: solidarityVault, isSigner: false, isWritable: true },
      { pubkey: escrowAuth, isSigner: false, isWritable: false },
      { pubkey: escrowVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: reputation, isSigner: false, isWritable: false },
      { pubkey: repConfig, isSigner: false, isWritable: true },
      { pubkey: repProfile, isSigner: false, isWritable: true },
      // The reputation program itself signals "no identity linked".
      { pubkey: reputation, isSigner: false, isWritable: false },
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

export interface SendPlaceBidCommitArgs extends BuildPlaceBidCommitIxArgs {
  connection: Connection;
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
}

/** Simulate, sign and CONFIRM the commit. */
export async function sendPlaceBidCommit(args: SendPlaceBidCommitArgs): Promise<string> {
  const ix = buildPlaceBidCommitIx(args);
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await args.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = args.bidder;
  await simulateOrThrow(args.connection, tx);
  const signature = await args.sendTransaction(tx, args.connection);
  // Confirming matters more here than anywhere else: if the commit silently
  // failed, the bidder walks into the reveal window believing they have an
  // envelope, and the auction closes without them.
  await confirmOrThrow(args.connection, signature, blockhash, lastValidBlockHeight);
  return signature;
}

export interface SendPlaceBidRevealArgs extends BuildPlaceBidRevealIxArgs {
  connection: Connection;
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
}

/** Simulate, sign and CONFIRM the reveal. */
export async function sendPlaceBidReveal(args: SendPlaceBidRevealArgs): Promise<string> {
  const ix = buildPlaceBidRevealIx(args);
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await args.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = args.bidder;
  await simulateOrThrow(args.connection, tx);
  const signature = await args.sendTransaction(tx, args.connection);
  // Losing the auction between simulation and landing is the EXPECTED
  // failure (someone deeper revealed first), and it lands as a REVERT —
  // which `confirmTransaction` resolves happily. Without this the UI would
  // report a bid that never took the slot AND never charged the bidder.
  await confirmOrThrow(args.connection, signature, blockhash, lastValidBlockHeight);
  return signature;
}

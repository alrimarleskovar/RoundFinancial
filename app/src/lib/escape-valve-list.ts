/**
 * IDL-free encoder + sender for the `roundfi-core::escape_valve_list`
 * instruction. Symmetric to `contribute.ts` / `claim-payout.ts` /
 * `release-escrow.ts`. Part of issue #235 (app↔chain wiring).
 *
 * `escape_valve_list` is the seller-side call to list a position NFT
 * for sale on the secondary market. The protocol creates a `Listing`
 * PDA seeded by `(pool, slot_index)` with the price + seller pubkey.
 * A subsequent `escape_valve_buy` from any buyer triggers the atomic
 * NFT re-anchor + USDC transfer.
 *
 * Pre-conditions (caller's responsibility — surfaced by the modal):
 *   - wallet is connected to devnet,
 *   - wallet pubkey is a Member of the target pool's slot,
 *   - pool.status == Active,
 *   - !member.defaulted (defaulters can't list),
 *   - no existing Listing for the same (pool, slot_index) — Anchor's
 *     `init` constraint catches re-init.
 *
 * Failure modes the on-chain handler raises (caller renders):
 *   - `PoolNotActive` — pool is in Forming / Completed / Liquidated
 *   - `NotAMember` — wallet doesn't own a slot in this pool
 *   - `DefaultedMember` — slot is flagged defaulted
 *   - `ProtocolPaused` — emergency pause active
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { listingPda, memberPda, protocolConfigPda } from "@roundfi/sdk/pda";

import { DEVNET_PROGRAM_IDS } from "./devnet";
import { confirmOrThrow, simulateOrThrow } from "./simulateTx";

// sha256("global:escape_valve_list")[:8] = 3c15934956dc4fc3
const ESCAPE_VALVE_LIST_DISCRIMINATOR = Buffer.from([
  0x3c, 0x15, 0x93, 0x49, 0x56, 0xdc, 0x4f, 0xc3,
]);

export interface BuildEscapeValveListIxArgs {
  /** Pool PDA. */
  pool: PublicKey;
  /** Connected wallet's pubkey — must equal pool.member.wallet. */
  sellerWallet: PublicKey;
  /** Seller's slot_index — used to derive the Listing PDA seeds.
   *  Must match `member.slot_index` (program enforces). */
  slotIndex: number;
  /** Listing price in USDC base units (6 decimals). u64 LE on the wire. */
  priceUsdc: bigint | number;
  /** Optional program ID override — for tests against a bankrun-deployed
   *  program set. Defaults to `DEVNET_PROGRAM_IDS`. */
  programIds?: { core: PublicKey };
}

/**
 * Build the raw `escape_valve_list(price_usdc)` instruction.
 *
 * Account order MUST match `EscapeValveList<'info>` in
 * `programs/roundfi-core/src/instructions/escape_valve_list.rs` (6 accounts).
 */
export function buildEscapeValveListIx(args: BuildEscapeValveListIxArgs): TransactionInstruction {
  const core = args.programIds?.core ?? DEVNET_PROGRAM_IDS.core;

  const [config] = protocolConfigPda(core);
  const [member] = memberPda(core, args.pool, args.sellerWallet);
  const [listing] = listingPda(core, args.pool, args.slotIndex);

  // [discriminator (8) | price_usdc (u64 LE = 8)] = 16 bytes total.
  const priceBuf = Buffer.alloc(8);
  const priceBig = typeof args.priceUsdc === "bigint" ? args.priceUsdc : BigInt(args.priceUsdc);
  priceBuf.writeBigUInt64LE(priceBig, 0);
  const data = Buffer.concat([ESCAPE_VALVE_LIST_DISCRIMINATOR, priceBuf]);

  return new TransactionInstruction({
    programId: core,
    data,
    keys: [
      { pubkey: args.sellerWallet, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: args.pool, isSigner: false, isWritable: false },
      { pubkey: member, isSigner: false, isWritable: false },
      { pubkey: listing, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

export interface SendEscapeValveListArgs extends BuildEscapeValveListIxArgs {
  connection: Connection;
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
}

export async function sendEscapeValveList(args: SendEscapeValveListArgs): Promise<string> {
  const ix = buildEscapeValveListIx(args);
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await args.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = args.sellerWallet;

  // Dry-run before the wallet signs — never sign a tx that will fail
  // on-chain (frontend-security checklist §2.2).
  await simulateOrThrow(args.connection, tx);

  const signature = await args.sendTransaction(tx, args.connection);
  // Never report a listing as successful when the tx landed with an on-chain
  // error (a pool-state change between our dry-run and execution — e.g. the slot
  // got listed/taken in the interim): `confirmOrThrow` surfaces it like any
  // other revert, attaching the failed tx's logs so the SellShareModal
  // classifier maps a known reason (e.g. MemberNotBehind → "você precisa estar
  // em dia"). Otherwise the modal shows a success card linking a FAILED tx while
  // no Listing account exists — the "listei mas não apareceu para comprar" case.
  await confirmOrThrow(args.connection, signature, blockhash, lastValidBlockHeight);
  return signature;
}

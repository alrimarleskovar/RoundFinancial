/**
 * IDL-free encoder + sender for the `roundfi-core::escape_valve_buy`
 * instruction, callable from the browser via the wallet adapter.
 *
 * Sibling of `app/src/lib/contribute.ts` and `claim-payout.ts`. The
 * Escape Valve secondary-market mechanic lets a member who can't keep
 * paying their installments transfer their slot (membership + position
 * NFT + obligations) to a buyer, instead of defaulting and triggering
 * Triple Shield seizure. The buyer pays USDC straight to the seller;
 * the program atomically:
 *   - thaws the seller's frozen position NFT,
 *   - TransferV1's it to the buyer,
 *   - re-approves FreezeDelegate + TransferDelegate back to
 *     `position_authority` (the protocol's PDA — required because
 *     mpl-core's TransferV1 resets owner-managed plugin authorities;
 *     this gotcha was found + fixed in flight on PR #176),
 *   - re-freezes the asset under buyer ownership,
 *   - closes the seller's Member PDA, init's a new Member PDA at the
 *     buyer's pubkey carrying over all bookkeeping (slot_index,
 *     contributions_paid, on_time_count, escrow_balance, stake, NFT
 *     pubkey, joined_at — but resets `last_transferred_at` to now),
 *   - closes the listing PDA + refunds rent to the seller.
 *
 * 14 outer accounts; CPIs into mpl-core add their own implicit
 * accounts via the `metaplex_core` Program reference. The fee budget
 * for this ix is non-trivial — 600k CU is a safe ceiling.
 *
 * Pre-conditions (program-enforced):
 *   - listing.status == Active && listing.pool == pool
 *   - args.price_usdc == listing.price_usdc (commits buyer to the
 *     price they saw — rejects on race against a list-update)
 *   - !old_member.defaulted
 *   - buyer doesn't already have a Member PDA in this pool (init
 *     would conflict)
 *   - buyer's USDC ATA holds at least price_usdc
 */

import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

import {
  fetchListingRaw,
  listingPda,
  memberPda,
  positionAuthorityPda,
  protocolConfigPda,
} from "@roundfi/sdk";

import { DEVNET_PROGRAM_IDS, DEVNET_USDC_MINT } from "./devnet";

// sha256("global:escape_valve_buy")[:8] — precomputed.
//   $ node -e 'console.log(require("crypto").createHash("sha256")
//                .update("global:escape_valve_buy").digest()
//                .subarray(0,8).toString("hex"))'
//   → c48acf6a712d9c54
const ESCAPE_VALVE_BUY_DISCRIMINATOR = Buffer.from([
  0xc4, 0x8a, 0xcf, 0x6a, 0x71, 0x2d, 0x9c, 0x54,
]);

// mpl-core program ID — fixed across all clusters. Constraint-checked
// on-chain against `config.metaplex_core`.
const MPL_CORE_PROGRAM = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

export interface SendEscapeValveBuyArgs {
  connection: Connection;
  /** Wallet adapter callback — usually `wallet.sendTransaction`. */
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
  /** Pool PDA where the listing lives. */
  pool: PublicKey;
  /** Buyer wallet — must sign the tx. */
  buyerWallet: PublicKey;
  /** Listing slot index (0..members_target-1). The listing PDA
   *  derives from `[b"listing", pool, slot_index]`. */
  slotIndex: number;
  /** Optional: override the price the buyer commits to. Defaults to
   *  whatever the on-chain listing currently says. Pass when the UI
   *  has cached the price and wants a stable signing input across
   *  rerenders. */
  expectedPriceUsdc?: bigint;
}

/**
 * Fetch the listing + the old Member's NFT asset, build the ix,
 * dispatch via the wallet adapter, return the confirmed signature.
 *
 * Throws with a readable message when:
 *   - the listing PDA doesn't exist / has been closed,
 *   - the listing status is not Active,
 *   - `expectedPriceUsdc` mismatches what the chain reports.
 */
export async function sendEscapeValveBuy(args: SendEscapeValveBuyArgs): Promise<string> {
  const core = DEVNET_PROGRAM_IDS.core;
  const usdcMint = DEVNET_USDC_MINT;

  const [listingAddr] = listingPda(core, args.pool, args.slotIndex);
  const listing = await fetchListingRaw(args.connection, listingAddr);
  if (!listing) {
    throw new Error(`Listing not found at ${listingAddr.toBase58()} — already filled / cancelled?`);
  }
  if (listing.status !== "active") {
    throw new Error(`Listing status is ${listing.status} — only "active" can be bought.`);
  }
  if (args.expectedPriceUsdc != null && listing.priceUsdc !== args.expectedPriceUsdc) {
    throw new Error(
      `Listing price mismatch: chain=${listing.priceUsdc} expected=${args.expectedPriceUsdc}`,
    );
  }

  // The old Member carries the nft_asset pubkey — fetch it.
  const [oldMember] = memberPda(core, args.pool, listing.seller);
  const oldMemberInfo = await args.connection.getAccountInfo(oldMember, "confirmed");
  if (!oldMemberInfo) {
    throw new Error(
      `Seller's Member PDA missing at ${oldMember.toBase58()} — listing seems orphaned.`,
    );
  }
  // Member layout: nft_asset is at offset 72..104 (after 8 disc + 32 pool + 32 wallet).
  const nftAsset = new PublicKey(oldMemberInfo.data.subarray(72, 104));

  const [config] = protocolConfigPda(core);
  const [newMember] = memberPda(core, args.pool, args.buyerWallet);
  const [positionAuth] = positionAuthorityPda(core, args.pool, listing.slotIndex);

  const buyerUsdc = getAssociatedTokenAddressSync(usdcMint, args.buyerWallet);
  const sellerUsdc = getAssociatedTokenAddressSync(usdcMint, listing.seller);

  // [discriminator (8) | price_usdc (u64 = 8)] = 16 bytes total.
  const priceLe = Buffer.alloc(8);
  priceLe.writeBigUInt64LE(listing.priceUsdc);
  const data = Buffer.concat([ESCAPE_VALVE_BUY_DISCRIMINATOR, priceLe]);

  // Account order matches `EscapeValveBuy<'info>` in
  // programs/roundfi-core/src/instructions/escape_valve_buy.rs.
  const ix = new TransactionInstruction({
    programId: core,
    data,
    keys: [
      { pubkey: args.buyerWallet, isSigner: true, isWritable: true },
      { pubkey: listing.seller, isSigner: false, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: args.pool, isSigner: false, isWritable: true },
      { pubkey: listingAddr, isSigner: false, isWritable: true },
      { pubkey: oldMember, isSigner: false, isWritable: true },
      { pubkey: newMember, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: buyerUsdc, isSigner: false, isWritable: true },
      { pubkey: sellerUsdc, isSigner: false, isWritable: true },
      { pubkey: nftAsset, isSigner: false, isWritable: true },
      { pubkey: positionAuth, isSigner: false, isWritable: false },
      { pubkey: MPL_CORE_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });

  // The 5+ mpl-core CPIs (thaw, transfer, approve x2, freeze) blow
  // past the 200k-CU default. 600k matches the seed-default ceiling
  // and is well under the 1.4M per-tx limit.
  const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });

  const tx = new Transaction().add(cu, ix);
  const { blockhash, lastValidBlockHeight } = await args.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = args.buyerWallet;

  const signature = await args.sendTransaction(tx, args.connection);
  await args.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return signature;
}

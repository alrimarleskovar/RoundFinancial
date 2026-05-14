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
 * 15 outer accounts; CPIs into mpl-core add their own implicit
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

import { listingPda, memberPda, positionAuthorityPda, protocolConfigPda } from "@roundfi/sdk/pda";

// `fetchListingRaw` is loaded dynamically inside `sendEscapeValveBuy`
// (the only consumer) so the pure `buildEscapeValveBuyIx` builder can
// be tested under ts-mocha without dragging in `@roundfi/sdk/onchain-raw`
// — whose `.js`-suffixed internal imports trip the legacy ts-node 7
// CommonJS resolver used by the test runner. Same workaround pattern
// as `parity.spec.ts` documents at the import block.

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

export interface BuildEscapeValveBuyIxArgs {
  /** Pool PDA where the listing lives. */
  pool: PublicKey;
  /** Buyer wallet — must sign the tx. */
  buyerWallet: PublicKey;
  /** Seller wallet — taken straight from the on-chain listing record so
   *  the caller can't accidentally redirect the USDC transfer. */
  sellerWallet: PublicKey;
  /** Listing slot index (0..members_target-1). Drives both the listing
   *  PDA and the position_authority PDA. */
  slotIndex: number;
  /** Position NFT asset pubkey — lives on the seller's old Member PDA
   *  at offset [72..104]. Caller is responsible for resolving this
   *  before invoking the builder (see `sendEscapeValveBuy`). */
  nftAsset: PublicKey;
  /** Listing price in USDC base units (6 decimals). u64 LE on the wire.
   *  Must match what the chain currently reports — the on-chain handler
   *  rejects on price race against a list-update. */
  priceUsdc: bigint | number;
}

/**
 * Build the raw `escape_valve_buy(price_usdc)` instruction. Pure
 * function over pre-resolved inputs — no RPC. The caller (typically
 * `sendEscapeValveBuy` below) handles fetching the listing record and
 * the NFT asset pubkey from the old Member PDA.
 *
 * Account order MUST match `EscapeValveBuy<'info>` in
 * `programs/roundfi-core/src/instructions/escape_valve_buy.rs` (15
 * accounts).
 *
 * The pure-builder split lets us:
 *   1. Structurally test the encoder in `tests/app_encoders.spec.ts`
 *      without a live RPC fixture (issue #283),
 *   2. Reuse the same encoder from non-browser contexts in the future
 *      (orchestrator, scripts) if needed.
 */
export function buildEscapeValveBuyIx(args: BuildEscapeValveBuyIxArgs): TransactionInstruction {
  const core = DEVNET_PROGRAM_IDS.core;
  const usdcMint = DEVNET_USDC_MINT;

  const [config] = protocolConfigPda(core);
  const [listingAddr] = listingPda(core, args.pool, args.slotIndex);
  const [oldMember] = memberPda(core, args.pool, args.sellerWallet);
  const [newMember] = memberPda(core, args.pool, args.buyerWallet);
  const [positionAuth] = positionAuthorityPda(core, args.pool, args.slotIndex);

  const buyerUsdc = getAssociatedTokenAddressSync(usdcMint, args.buyerWallet);
  const sellerUsdc = getAssociatedTokenAddressSync(usdcMint, args.sellerWallet);

  // [discriminator (8) | price_usdc (u64 LE = 8)] = 16 bytes total.
  const priceBuf = Buffer.alloc(8);
  const priceBig = typeof args.priceUsdc === "bigint" ? args.priceUsdc : BigInt(args.priceUsdc);
  priceBuf.writeBigUInt64LE(priceBig, 0);
  const data = Buffer.concat([ESCAPE_VALVE_BUY_DISCRIMINATOR, priceBuf]);

  return new TransactionInstruction({
    programId: core,
    data,
    keys: [
      { pubkey: args.buyerWallet, isSigner: true, isWritable: true },
      { pubkey: args.sellerWallet, isSigner: false, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: args.pool, isSigner: false, isWritable: true },
      { pubkey: listingAddr, isSigner: false, isWritable: true },
      { pubkey: oldMember, isSigner: false, isWritable: true },
      { pubkey: newMember, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: buyerUsdc, isSigner: false, isWritable: true },
      { pubkey: sellerUsdc, isSigner: false, isWritable: true },
      { pubkey: args.nftAsset, isSigner: false, isWritable: true },
      { pubkey: positionAuth, isSigner: false, isWritable: false },
      { pubkey: MPL_CORE_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

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
 * Fetch the listing + the old Member's NFT asset, build the ix via
 * `buildEscapeValveBuyIx`, dispatch via the wallet adapter, return
 * the confirmed signature.
 *
 * Throws with a readable message when:
 *   - the listing PDA doesn't exist / has been closed,
 *   - the listing status is not Active,
 *   - `expectedPriceUsdc` mismatches what the chain reports.
 */
export async function sendEscapeValveBuy(args: SendEscapeValveBuyArgs): Promise<string> {
  const core = DEVNET_PROGRAM_IDS.core;

  // Dynamic import — see top-of-file note. The bundler resolves this at
  // build time the same as a static import; only the test runner's
  // module-load order is affected.
  const { fetchListingRaw } = await import("@roundfi/sdk/onchain-raw");

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

  const ix = buildEscapeValveBuyIx({
    pool: args.pool,
    buyerWallet: args.buyerWallet,
    sellerWallet: listing.seller,
    slotIndex: listing.slotIndex,
    nftAsset,
    priceUsdc: listing.priceUsdc,
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

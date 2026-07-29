/**
 * IDL-free encoder + sender for `roundfi-core::place_embedded_bid`
 * (ADR 0012 Fase 2 — lance embutido).
 *
 * The bid moves NO funds: its "price" was already paid through normal
 * `contribute` calls made AHEAD of the pool's clock (ADR 0012 Fase 1
 * prepayment). What this instruction does is swap two entries of the
 * pool's `DrawResult.order` — the bidder's seat takes the CURRENT cycle,
 * and the seat that held it inherits the bidder's original (future)
 * cycle. `order` stays a bijection, so every member is still
 * contemplated exactly once and the payout instructions need no change.
 *
 * Pre-conditions enforced on-chain (mirrored by `lib/lance.ts` so the UI
 * never fires a doomed tx):
 *   - pool.status == Active AND pool.ordering_policy == Sorteio
 *   - !member.defaulted && !member.paid_out
 *   - depth = contributions_paid − current_cycle − 1 >= 1
 *   - depth > pool.current_bid_depth (STRICTLY — ties lose)
 *   - the bidder's own drawn cycle is still in the future
 *
 * Account order MUST match `PlaceEmbeddedBid<'info>` in
 * programs/roundfi-core/src/instructions/place_embedded_bid.rs
 * (5 accounts, no args).
 */

import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";

import { drawResultPda, memberPda, protocolConfigPda } from "@roundfi/sdk/pda";

import { DEVNET_PROGRAM_IDS } from "./devnet";
import { confirmOrThrow, simulateOrThrow } from "./simulateTx";

// sha256("global:place_embedded_bid")[:8] — precomputed.
//   $ node -e 'console.log(require("crypto").createHash("sha256")
//                .update("global:place_embedded_bid").digest()
//                .subarray(0,8).toString("hex"))'
//   → 74f3af14730d08d6
const PLACE_EMBEDDED_BID_DISCRIMINATOR = Buffer.from([
  0x74, 0xf3, 0xaf, 0x14, 0x73, 0x0d, 0x08, 0xd6,
]);

export interface BuildPlaceEmbeddedBidIxArgs {
  /** Pool PDA — Active sorteio pool (mutable: `current_bid_depth`). */
  pool: PublicKey;
  /** Connected wallet — signs; must own the Member PDA for this pool. */
  memberWallet: PublicKey;
  /** Optional program ID override — for tests against a local program set. */
  programIds?: { core: PublicKey };
}

/** Build the raw `place_embedded_bid()` instruction (no args, 5 accounts). */
export function buildPlaceEmbeddedBidIx(args: BuildPlaceEmbeddedBidIxArgs): TransactionInstruction {
  const core = args.programIds?.core ?? DEVNET_PROGRAM_IDS.core;

  const [config] = protocolConfigPda(core);
  const [member] = memberPda(core, args.pool, args.memberWallet);
  const [draw] = drawResultPda(core, args.pool);

  return new TransactionInstruction({
    programId: core,
    data: PLACE_EMBEDDED_BID_DISCRIMINATOR,
    keys: [
      { pubkey: args.memberWallet, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: args.pool, isSigner: false, isWritable: true },
      { pubkey: member, isSigner: false, isWritable: false },
      // The DrawResult is a DECLARED account here (not a remaining one as
      // in claim_payout): the bid's entire effect is the swap it writes.
      { pubkey: draw, isSigner: false, isWritable: true },
    ],
  });
}

export interface SendPlaceEmbeddedBidArgs extends BuildPlaceEmbeddedBidIxArgs {
  connection: Connection;
  /** Wallet adapter callback — usually `wallet.sendTransaction`. */
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
}

/** Build, simulate, sign-via-wallet and CONFIRM the bid. Returns the signature. */
export async function sendPlaceEmbeddedBid(args: SendPlaceEmbeddedBidArgs): Promise<string> {
  const ix = buildPlaceEmbeddedBidIx(args);
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await args.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = args.memberWallet;

  // Dry-run before the wallet signs — never sign a tx that will fail.
  await simulateOrThrow(args.connection, tx);

  const signature = await args.sendTransaction(tx, args.connection);
  // A bid is the one action here that can lose a RACE it passed simulation
  // for (someone deeper landed first, or the contemplated member claimed
  // and the cycle advanced). `confirmTransaction` RESOLVES for a landed-
  // but-reverted tx, so without this the UI would celebrate a bid that
  // never took the slot.
  await confirmOrThrow(args.connection, signature, blockhash, lastValidBlockHeight);
  return signature;
}

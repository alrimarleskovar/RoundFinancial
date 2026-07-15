/**
 * IDL-free encoder + sender for `roundfi-core::finalize_draw` (ADR
 * pool_v2 — sorteio ordering policy).
 *
 * Permissionless, single-shot: when a sorteio pool fills, anyone can run
 * this to mint the pool's DrawResult PDA (the payout-order permutation).
 * Payouts on a sorteio pool are unreachable (`DrawRequired`) until it
 * runs; a second call collides on the PDA `init` — nobody re-rolls an
 * unfavorable order. Same trust model as `crank_payout`: no funds move.
 *
 * Account order MUST match `FinalizeDraw<'info>` in
 * programs/roundfi-core/src/instructions/finalize_draw.rs (4 accounts).
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { drawResultPda } from "@roundfi/sdk/pda";

import { DEVNET_PROGRAM_IDS } from "./devnet";
import { simulateOrThrow } from "./simulateTx";

// sha256("global:finalize_draw")[:8] — precomputed.
//   $ node -e 'console.log(require("crypto").createHash("sha256")
//                .update("global:finalize_draw").digest()
//                .subarray(0,8).toString("hex"))'
//   → 7009ea5e63b00cb5
const FINALIZE_DRAW_DISCRIMINATOR = Buffer.from([0x70, 0x09, 0xea, 0x5e, 0x63, 0xb0, 0x0c, 0xb5]);

export interface BuildFinalizeDrawIxArgs {
  /** Pool PDA — must be a full, Active sorteio pool. */
  pool: PublicKey;
  /** Permissionless caller — signs + pays the DrawResult rent. */
  caller: PublicKey;
}

/** Build the raw `finalize_draw()` instruction (no args, 4 accounts). */
export function buildFinalizeDrawIx(args: BuildFinalizeDrawIxArgs): TransactionInstruction {
  const core = DEVNET_PROGRAM_IDS.core;
  const [draw] = drawResultPda(core, args.pool);

  return new TransactionInstruction({
    programId: core,
    data: FINALIZE_DRAW_DISCRIMINATOR,
    keys: [
      { pubkey: args.caller, isSigner: true, isWritable: true },
      { pubkey: args.pool, isSigner: false, isWritable: true },
      { pubkey: draw, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

export interface SendFinalizeDrawArgs extends BuildFinalizeDrawIxArgs {
  connection: Connection;
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
}

/** Simulate-then-sign `finalize_draw`. Returns the tx signature. */
export async function sendFinalizeDraw(args: SendFinalizeDrawArgs): Promise<string> {
  const ix = buildFinalizeDrawIx(args);
  const tx = new Transaction().add(ix);
  tx.feePayer = args.caller;
  const { blockhash } = await args.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  await simulateOrThrow(args.connection, tx);
  return args.sendTransaction(tx, args.connection);
}

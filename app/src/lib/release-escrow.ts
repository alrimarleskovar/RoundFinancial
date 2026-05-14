/**
 * IDL-free encoder + sender for the `roundfi-core::release_escrow`
 * instruction. Symmetric to `contribute.ts` / `claim-payout.ts`.
 *
 * `release_escrow` is the user-side call to claim vested stake-refund
 * cashback after N on-time cycles. The on-chain math (linear vesting
 * with the final-checkpoint exact-principal rule) lives in
 * `crates/math/src/escrow_vesting.rs`; this file is just the tx
 * dispatcher.
 *
 * Pre-conditions (caller's responsibility — surfaced by the modal
 * before we ever build the tx):
 *   - wallet is connected to devnet,
 *   - wallet pubkey is the member of the target pool's slot,
 *   - pool.status == Active,
 *   - !member.defaulted (release_escrow is gated to non-defaulters),
 *   - checkpoint > member.last_released_checkpoint (monotonic),
 *   - checkpoint <= pool.current_cycle + 1 (no advance release).
 *
 * The on-chain `EscrowLocked` / `EscrowNothingToRelease` errors will
 * surface clearly if any of these slip through.
 */

import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { escrowVaultAuthorityPda, memberPda, protocolConfigPda } from "@roundfi/sdk/pda";

import { DEVNET_PROGRAM_IDS, DEVNET_USDC_MINT } from "./devnet";

// sha256("global:release_escrow")[:8] — precomputed via:
//   node -e 'console.log(require("crypto").createHash("sha256")
//              .update("global:release_escrow").digest()
//              .subarray(0,8).toString("hex"))'
//   → 92fd81e91491b5ce
const RELEASE_ESCROW_DISCRIMINATOR = Buffer.from([0x92, 0xfd, 0x81, 0xe9, 0x14, 0x91, 0xb5, 0xce]);

export interface BuildReleaseEscrowIxArgs {
  /** Pool PDA (mutable account). */
  pool: PublicKey;
  /** Connected wallet's pubkey — must equal pool.member.wallet. */
  memberWallet: PublicKey;
  /** Milestone index 1..=cycles_total. Must be strictly greater than
   *  `member.last_released_checkpoint` (the on-chain monotonic guard). */
  checkpoint: number;
  /** Optional program ID override — for tests against a bankrun-deployed
   *  program set. Defaults to `DEVNET_PROGRAM_IDS`. */
  programIds?: { core: PublicKey };
  /** Optional USDC mint override — pairs with `programIds` for tests. */
  usdcMint?: PublicKey;
}

/**
 * Build the raw `release_escrow(checkpoint)` instruction. All accounts
 * derive deterministically from the pool address + wallet pubkey + the
 * program IDs pinned in `devnet.ts`.
 *
 * Account order MUST match `ReleaseEscrow<'info>` in
 * programs/roundfi-core/src/instructions/release_escrow.rs (9 accounts).
 */
export function buildReleaseEscrowIx(args: BuildReleaseEscrowIxArgs): TransactionInstruction {
  const core = args.programIds?.core ?? DEVNET_PROGRAM_IDS.core;
  const usdcMint = args.usdcMint ?? DEVNET_USDC_MINT;

  const [config] = protocolConfigPda(core);
  const [member] = memberPda(core, args.pool, args.memberWallet);
  const [escrowAuth] = escrowVaultAuthorityPda(core, args.pool);

  const memberUsdc = getAssociatedTokenAddressSync(usdcMint, args.memberWallet);
  const escrowVault = getAssociatedTokenAddressSync(usdcMint, escrowAuth, true);

  // [discriminator (8) | checkpoint (u8 = 1)] = 9 bytes total.
  if (args.checkpoint < 1 || args.checkpoint > 255) {
    throw new Error(`release_escrow checkpoint must fit u8 (1..=255); got ${args.checkpoint}`);
  }
  const data = Buffer.concat([RELEASE_ESCROW_DISCRIMINATOR, Buffer.from([args.checkpoint & 0xff])]);

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
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}

export interface SendReleaseEscrowArgs extends BuildReleaseEscrowIxArgs {
  connection: Connection;
  /** Wallet adapter callback — usually `wallet.sendTransaction`. */
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
}

/**
 * One-shot helper: build the release_escrow instruction, wrap in a
 * Transaction with latest blockhash + member as fee payer, and dispatch
 * via the wallet adapter. Returns the confirmed signature.
 *
 * Failure modes (caller renders the error):
 *   - `EscrowLocked` — checkpoint out of range or pool not at the
 *     right cycle (advance release attempt)
 *   - `EscrowNothingToRelease` — checkpoint not greater than
 *     last_released_checkpoint (already released up to this point)
 *   - `DefaultedMember` — member is flagged defaulted; escrow is
 *     seized by Triple Shield, not releasable
 *   - `ProtocolPaused` — emergency pause active
 */
export async function sendReleaseEscrow(args: SendReleaseEscrowArgs): Promise<string> {
  const ix = buildReleaseEscrowIx(args);
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await args.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = args.memberWallet;

  const signature = await args.sendTransaction(tx, args.connection);
  await args.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return signature;
}

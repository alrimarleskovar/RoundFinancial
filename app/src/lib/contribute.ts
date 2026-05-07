/**
 * IDL-free encoder + sender for the `roundfi-core::contribute`
 * instruction, callable from the browser via the wallet adapter.
 *
 * Why hand-rolled? The Anchor 0.30.1 IDL build is broken on Rust 1.95 +
 * proc-macro2 1.0.106 (see scripts/devnet/init-protocol.ts), so
 * app/public/idls/* is empty. We can't construct an Anchor `Program`
 * client-side without the IDL — but we already encode reads via
 * `sdk/src/onchain-raw.ts`, so this file does the symmetric job for the
 * one write path the demo wires (paying an installment).
 *
 * The discriminator + account ordering must match
 * `programs/roundfi-core/src/instructions/contribute.rs` exactly. Any
 * drift will surface immediately as `AccountNotInitialized` /
 * `ConstraintSeeds` from the program — diagnosable, not silent.
 *
 * Pre-conditions (caller's responsibility, validated upstream in the
 * modal so we surface a clean message instead of a runtime panic):
 *   - wallet is connected to devnet,
 *   - wallet pubkey is the member of the target pool's slot,
 *   - pool.status == Active and !member.defaulted,
 *   - member's USDC ATA holds at least pool.installment_amount.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

import {
  ATTESTATION_SCHEMA,
  attestationNonce,
  attestationPda,
  escrowVaultAuthorityPda,
  memberPda,
  protocolConfigPda,
  reputationConfigPda,
  reputationProfilePda,
  solidarityVaultAuthorityPda,
} from "@roundfi/sdk";

import { DEVNET_PROGRAM_IDS, DEVNET_USDC_MINT } from "./devnet";

// sha256("global:contribute")[:8] — precomputed so the browser bundle
// doesn't need a hash dep. Verified against init-protocol.ts's
// anchorIxDiscriminator helper:
//   $ node -e 'console.log(require("crypto").createHash("sha256")
//                .update("global:contribute").digest()
//                .subarray(0,8).toString("hex"))'
//   → 522144832000cd5f
const CONTRIBUTE_DISCRIMINATOR = Buffer.from([0x52, 0x21, 0x44, 0x83, 0x20, 0x00, 0xcd, 0x5f]);

export interface BuildContributeIxArgs {
  /** Pool PDA (mutable account). */
  pool: PublicKey;
  /** Connected wallet's pubkey — must equal pool.member.wallet. */
  memberWallet: PublicKey;
  /** Cycle to pay, must equal pool.current_cycle (program enforces). */
  cycle: number;
  /** Optional override; defaults to ATTESTATION_SCHEMA.Payment (1). */
  schemaId?: number;
  /** Optional slot index for the attestation nonce. Defaults to 0
   *  because nonce only needs uniqueness within a cycle, and the
   *  contribute path uses (cycle, slot) without colliding with claim. */
  slotIndex?: number;
}

/**
 * Build the raw `contribute(cycle)` instruction. All accounts derive
 * from the pool address + wallet pubkey + program IDs in `devnet.ts`.
 *
 * Returns a fully populated `TransactionInstruction` ready to be added
 * to a `Transaction` and dispatched via the wallet adapter's
 * `sendTransaction`.
 */
export function buildContributeIx(args: BuildContributeIxArgs): TransactionInstruction {
  const core = DEVNET_PROGRAM_IDS.core;
  const reputation = DEVNET_PROGRAM_IDS.reputation;
  const usdcMint = DEVNET_USDC_MINT;

  const [config] = protocolConfigPda(core);
  const [member] = memberPda(core, args.pool, args.memberWallet);
  const [solidarityAuth] = solidarityVaultAuthorityPda(core, args.pool);
  const [escrowAuth] = escrowVaultAuthorityPda(core, args.pool);
  const [repConfig] = reputationConfigPda(reputation);
  const [repProfile] = reputationProfilePda(reputation, args.memberWallet);

  const schemaId = args.schemaId ?? ATTESTATION_SCHEMA.Payment;
  const slotIndex = args.slotIndex ?? 0;
  const nonce = attestationNonce(args.cycle, slotIndex);
  // The reputation program is its own "no identity linked" sentinel —
  // mirrors `noIdentityRecord(client)` in sdk/src/actions.ts so the
  // optional Identity account constraint succeeds.
  const identityRecord = reputation;
  const [attestation] = attestationPda(reputation, args.pool, args.memberWallet, schemaId, nonce);

  const memberUsdc = getAssociatedTokenAddressSync(usdcMint, args.memberWallet);
  const poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, args.pool, true);
  const solidarityVault = getAssociatedTokenAddressSync(usdcMint, solidarityAuth, true);
  const escrowVault = getAssociatedTokenAddressSync(usdcMint, escrowAuth, true);

  // [discriminator (8) | cycle (u8 = 1)] = 9 bytes total.
  const data = Buffer.concat([CONTRIBUTE_DISCRIMINATOR, Buffer.from([args.cycle & 0xff])]);

  // Account order MUST match `Contribute<'info>` in
  // programs/roundfi-core/src/instructions/contribute.rs declaration.
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
      { pubkey: poolUsdcVault, isSigner: false, isWritable: true },
      { pubkey: solidarityAuth, isSigner: false, isWritable: false },
      { pubkey: solidarityVault, isSigner: false, isWritable: true },
      { pubkey: escrowAuth, isSigner: false, isWritable: false },
      { pubkey: escrowVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: reputation, isSigner: false, isWritable: false },
      { pubkey: repConfig, isSigner: false, isWritable: true },
      { pubkey: repProfile, isSigner: false, isWritable: true },
      { pubkey: identityRecord, isSigner: false, isWritable: false },
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

export interface SendContributeArgs extends BuildContributeIxArgs {
  connection: Connection;
  /** Wallet adapter callback — usually `wallet.sendTransaction`. */
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
}

/**
 * One-shot helper: build the contribute instruction, wrap it in a
 * Transaction with the latest blockhash + member as fee payer, and
 * dispatch it via the wallet adapter's sendTransaction. Returns the
 * confirmed signature (or throws — caller renders the error).
 */
export async function sendContribute(args: SendContributeArgs): Promise<string> {
  const ix = buildContributeIx(args);
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

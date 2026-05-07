/**
 * IDL-free encoder + sender for the `roundfi-core::claim_payout`
 * instruction, callable from the browser via the wallet adapter.
 *
 * Sibling of `app/src/lib/contribute.ts`. Same hand-rolled pattern,
 * 14 accounts, args = `{ cycle: u8 }`. Pre-conditions enforced
 * on-chain:
 *   - pool.status == Active
 *   - args.cycle == pool.current_cycle == member.slot_index
 *   - !member.defaulted && !member.paid_out
 *   - pool.float >= pool.credit_amount (else `WaterfallUnderflow` —
 *     deployer top-up via `services/orchestrator` covers this in
 *     practice)
 *
 * The handler advances `pool.current_cycle` by 1 and stamps
 * `member.paid_out = true`, plus emits a `SCHEMA_CYCLE_COMPLETE`
 * attestation through the reputation CPI. The latter has a 6-day
 * per-subject cooldown (`MIN_CYCLE_COOLDOWN_SECS = 518_400`), so the
 * same wallet can't trigger this twice across pools within the
 * cooldown window — production anti-gaming protection.
 *
 * Demo note: Pool 3's slot-0 (member-3) was already claim_payout'd
 * via `seed-claim.ts` in the seed flow, so the wallet-adapter path
 * isn't directly testable on that pool from member-3. To exercise
 * this encoder end-to-end we'd need either a fresh wallet that
 * never received the cooldown attestation, or a new pool. The
 * encoder is shipped now as the foundation; UI-facing validation
 * follows in a later slice.
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
  memberPda,
  protocolConfigPda,
  reputationConfigPda,
  reputationProfilePda,
} from "@roundfi/sdk";

import { DEVNET_PROGRAM_IDS, DEVNET_USDC_MINT } from "./devnet";

// sha256("global:claim_payout")[:8] — precomputed.
//   $ node -e 'console.log(require("crypto").createHash("sha256")
//                .update("global:claim_payout").digest()
//                .subarray(0,8).toString("hex"))'
//   → 7ff0843ee3c69285
const CLAIM_PAYOUT_DISCRIMINATOR = Buffer.from([0x7f, 0xf0, 0x84, 0x3e, 0xe3, 0xc6, 0x92, 0x85]);

export interface BuildClaimPayoutIxArgs {
  /** Pool PDA (mutable account). */
  pool: PublicKey;
  /** Connected wallet — must equal pool.member.wallet for the slot. */
  memberWallet: PublicKey;
  /** Cycle to claim, must equal pool.current_cycle. */
  cycle: number;
  /** Slot index for the attestation nonce — usually equals cycle. */
  slotIndex: number;
}

/**
 * Build the raw `claim_payout(cycle)` instruction. 14 accounts in
 * the declaration order from `claim_payout.rs::ClaimPayout<'info>`.
 */
export function buildClaimPayoutIx(args: BuildClaimPayoutIxArgs): TransactionInstruction {
  const core = DEVNET_PROGRAM_IDS.core;
  const reputation = DEVNET_PROGRAM_IDS.reputation;
  const usdcMint = DEVNET_USDC_MINT;

  const [config] = protocolConfigPda(core);
  const [member] = memberPda(core, args.pool, args.memberWallet);
  const [repConfig] = reputationConfigPda(reputation);
  const [repProfile] = reputationProfilePda(reputation, args.memberWallet);

  // claim_payout always uses SCHEMA_CYCLE_COMPLETE (id=4) — there's no
  // on-time/late branch like contribute has. The 6-day per-subject
  // cooldown is enforced in the reputation program, not here.
  const schemaId = ATTESTATION_SCHEMA.CycleComplete;
  const nonce = attestationNonce(args.cycle, args.slotIndex);
  const identityRecord = reputation; // sentinel for "no identity linked"
  const [attestation] = attestationPda(reputation, args.pool, args.memberWallet, schemaId, nonce);

  const memberUsdc = getAssociatedTokenAddressSync(usdcMint, args.memberWallet);
  const poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, args.pool, true);

  // [discriminator (8) | cycle (u8 = 1)] = 9 bytes total.
  const data = Buffer.concat([CLAIM_PAYOUT_DISCRIMINATOR, Buffer.from([args.cycle & 0xff])]);

  // Account order matches `ClaimPayout<'info>` in claim_payout.rs.
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

export interface SendClaimPayoutArgs extends BuildClaimPayoutIxArgs {
  connection: Connection;
  /** Wallet adapter callback — usually `wallet.sendTransaction`. */
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
}

/** Build, sign-via-wallet, and confirm the claim_payout tx. */
export async function sendClaimPayout(args: SendClaimPayoutArgs): Promise<string> {
  const ix = buildClaimPayoutIx(args);
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

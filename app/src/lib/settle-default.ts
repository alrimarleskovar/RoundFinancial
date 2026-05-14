/**
 * IDL-free encoder + sender for the `roundfi-core::settle_default`
 * instruction. Permissionless crank — anyone can dispatch it after the
 * grace period elapses.
 *
 * `settle_default` is the protocol's recovery mechanism when a member
 * misses a contribution. Triggers the Triple Shield seizure cascade:
 *   1. Solidarity vault drain (up to `missed`)
 *   2. Member escrow seizure (capped by D/C invariant)
 *   3. Member stake seizure (remaining, capped by D/C)
 *
 * Pre-conditions (caller's responsibility):
 *   - pool.status == Active,
 *   - !member.defaulted (can't re-settle the same member),
 *   - member.contributions_paid < pool.current_cycle (member is behind),
 *   - clock.unix_timestamp >= pool.next_cycle_at + GRACE_PERIOD_SECS
 *     (7 days mainnet / 60s devnet patch).
 *
 * Failure modes:
 *   - `WrongCycle` — args.cycle != pool.current_cycle
 *   - `MemberNotBehind` — member is current, no default to settle
 *   - `GracePeriodNotElapsed` — too early to crank
 *   - `DefaultedMember` — already settled
 *   - `MathOverflow` — D/C invariant computation overflowed (defensive)
 *
 * Captured firing live on devnet Pool 3 (see
 * docs/security/self-audit.md §3.1 Shield 3 — D/C invariant held,
 * Solidarity drained $0.20, escrow + stake left intact).
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
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

// sha256("global:settle_default")[:8] = f6e47db45e35e989
const SETTLE_DEFAULT_DISCRIMINATOR = Buffer.from([0xf6, 0xe4, 0x7d, 0xb4, 0x5e, 0x35, 0xe9, 0x89]);

export interface BuildSettleDefaultIxArgs {
  /** Pool PDA. */
  pool: PublicKey;
  /** Crank wallet — anyone can dispatch; pays the tx fee. */
  caller: PublicKey;
  /** Defaulted member's wallet (must equal `member.wallet`). NOT a signer
   *  — `settle_default` is permissionless. */
  defaultedMemberWallet: PublicKey;
  /** Pool's current cycle — must match `pool.current_cycle` (program
   *  enforces). Caller commits to the exact scenario they computed
   *  off-chain. */
  cycle: number;
  /** Optional slot index for the attestation nonce. Defaults to 0 —
   *  same convention as `contribute.ts`. */
  slotIndex?: number;
}

/**
 * Build the raw `settle_default(cycle)` instruction.
 *
 * Account order MUST match `SettleDefault<'info>` in
 * `programs/roundfi-core/src/instructions/settle_default.rs` (17 accounts).
 */
export function buildSettleDefaultIx(args: BuildSettleDefaultIxArgs): TransactionInstruction {
  const core = DEVNET_PROGRAM_IDS.core;
  const reputation = DEVNET_PROGRAM_IDS.reputation;
  const usdcMint = DEVNET_USDC_MINT;

  const [config] = protocolConfigPda(core);
  const [member] = memberPda(core, args.pool, args.defaultedMemberWallet);
  const [solidarityAuth] = solidarityVaultAuthorityPda(core, args.pool);
  const [escrowAuth] = escrowVaultAuthorityPda(core, args.pool);
  const [repConfig] = reputationConfigPda(reputation);
  const [repProfile] = reputationProfilePda(reputation, args.defaultedMemberWallet);

  const slotIndex = args.slotIndex ?? 0;
  const schemaId = ATTESTATION_SCHEMA.Default;
  const nonce = attestationNonce(args.cycle, slotIndex);
  // The reputation program is its own "no identity linked" sentinel —
  // mirrors `noIdentityRecord(client)` in sdk/src/actions.ts.
  const identityRecord = reputation;
  const [attestation] = attestationPda(
    reputation,
    args.pool,
    args.defaultedMemberWallet,
    schemaId,
    nonce,
  );

  const poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, args.pool, true);
  const solidarityVault = getAssociatedTokenAddressSync(usdcMint, solidarityAuth, true);
  const escrowVault = getAssociatedTokenAddressSync(usdcMint, escrowAuth, true);

  if (args.cycle < 0 || args.cycle > 255) {
    throw new Error(`settle_default cycle must fit u8 (0..=255); got ${args.cycle}`);
  }

  // [discriminator (8) | cycle (u8 = 1)] = 9 bytes total.
  const data = Buffer.concat([SETTLE_DEFAULT_DISCRIMINATOR, Buffer.from([args.cycle & 0xff])]);

  return new TransactionInstruction({
    programId: core,
    data,
    keys: [
      { pubkey: args.caller, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: args.pool, isSigner: false, isWritable: true },
      { pubkey: member, isSigner: false, isWritable: true },
      { pubkey: args.defaultedMemberWallet, isSigner: false, isWritable: false },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: poolUsdcVault, isSigner: false, isWritable: true },
      { pubkey: solidarityAuth, isSigner: false, isWritable: false },
      { pubkey: solidarityVault, isSigner: false, isWritable: true },
      { pubkey: escrowAuth, isSigner: false, isWritable: false },
      { pubkey: escrowVault, isSigner: false, isWritable: true },
      { pubkey: reputation, isSigner: false, isWritable: false },
      { pubkey: repConfig, isSigner: false, isWritable: true },
      { pubkey: repProfile, isSigner: false, isWritable: true },
      { pubkey: identityRecord, isSigner: false, isWritable: false },
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

export interface SendSettleDefaultArgs extends BuildSettleDefaultIxArgs {
  connection: Connection;
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
}

export async function sendSettleDefault(args: SendSettleDefaultArgs): Promise<string> {
  const ix = buildSettleDefaultIx(args);
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await args.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = args.caller;

  const signature = await args.sendTransaction(tx, args.connection);
  await args.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return signature;
}

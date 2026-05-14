/**
 * IDL-free encoder + sender for the `roundfi-core::settle_default`
 * instruction, callable from the browser via the wallet adapter.
 *
 * Sibling of `app/src/lib/contribute.ts` / `claim-payout.ts`. The
 * `settle_default` instruction is a **permissionless crank** — anyone
 * can dispatch it against a member whose grace period has elapsed
 * without a contribution. The protocol's Triple Shield cascade then:
 *
 *   1. Drains `solidarity_vault` up to `missed` (Shield 1)
 *   2. If shortfall remains, drains `escrow_vault` capped by D/C (Shield 2)
 *   3. If shortfall still remains, drains `stake` capped by D/C (Shield 3)
 *
 * After the cascade: `member.defaulted = true`, `SCHEMA_DEFAULT` (id=3)
 * attestation written via reputation CPI. Caller pays for the
 * attestation init rent.
 *
 * Pre-conditions (program-enforced):
 *   - `clock.unix_timestamp >= pool.next_cycle_at + GRACE_PERIOD_SECS`
 *     (else: `SettleDefaultGracePeriodNotElapsed`)
 *   - `member.contributions_paid < args.cycle` (else: `AlreadyContributed`)
 *   - `!member.defaulted` (else: `AlreadyDefaulted`)
 *   - `args.cycle == pool.current_cycle.saturating_sub(1)` (else: `WrongCycle`)
 *
 * Failure modes the on-chain handler raises (caller renders):
 *   - `SettleDefaultGracePeriodNotElapsed` — too early
 *   - `AlreadyContributed` — member paid on time after all
 *   - `AlreadyDefaulted` — re-settle blocked
 *   - `WrongCycle` — cycle arg mismatched
 *   - `WaterfallUnderflow` / `WaterfallNotConserved` — invariant violation
 *
 * `settle_default` is **exempt from the `paused` gate** by design —
 * Triple Shield must remain executable during a pause to prevent a
 * defaulter from extracting value during freeze windows. The
 * exemption is documented in `programs/roundfi-core/src/instructions/pause.rs`.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { ATTESTATION_SCHEMA } from "@roundfi/sdk/constants";
import {
  attestationNonce,
  attestationPda,
  escrowVaultAuthorityPda,
  memberPda,
  protocolConfigPda,
  reputationConfigPda,
  reputationProfilePda,
  solidarityVaultAuthorityPda,
} from "@roundfi/sdk/pda";

import { DEVNET_PROGRAM_IDS, DEVNET_USDC_MINT } from "./devnet";

// sha256("global:settle_default")[:8] — precomputed.
//   $ node -e 'console.log(require("crypto").createHash("sha256")
//                .update("global:settle_default").digest()
//                .subarray(0,8).toString("hex"))'
//   → f6e47db45e35e989
const SETTLE_DEFAULT_DISCRIMINATOR = Buffer.from([0xf6, 0xe4, 0x7d, 0xb4, 0x5e, 0x35, 0xe9, 0x89]);

export interface BuildSettleDefaultIxArgs {
  /** Pool PDA (mutable account). */
  pool: PublicKey;
  /** Crank caller — pays for attestation init. NOT the defaulter. */
  caller: PublicKey;
  /** Wallet of the member being settled. Does NOT sign. */
  defaultedMemberWallet: PublicKey;
  /** Slot index of the defaulter — drives attestation nonce. Must
   *  match `member.slot_index` (program enforces via the Member PDA). */
  slotIndex: number;
  /** Cycle being settled — must equal `pool.current_cycle - 1` per the
   *  on-chain `WrongCycle` guard (the cracker settles the previous
   *  cycle's defaulter once `pool.current_cycle` has advanced). */
  cycle: number;
  /** Optional program ID override — for tests against a bankrun-deployed
   *  program set. Defaults to `DEVNET_PROGRAM_IDS`. */
  programIds?: { core: PublicKey; reputation: PublicKey };
  /** Optional USDC mint override — pairs with `programIds` for tests. */
  usdcMint?: PublicKey;
}

/**
 * Build the raw `settle_default(cycle)` instruction.
 *
 * Account order MUST match `SettleDefault<'info>` in
 * `programs/roundfi-core/src/instructions/settle_default.rs` (18 accounts).
 */
export function buildSettleDefaultIx(args: BuildSettleDefaultIxArgs): TransactionInstruction {
  const core = args.programIds?.core ?? DEVNET_PROGRAM_IDS.core;
  const reputation = args.programIds?.reputation ?? DEVNET_PROGRAM_IDS.reputation;
  const usdcMint = args.usdcMint ?? DEVNET_USDC_MINT;

  const [config] = protocolConfigPda(core);
  const [member] = memberPda(core, args.pool, args.defaultedMemberWallet);
  const [solidarityAuth] = solidarityVaultAuthorityPda(core, args.pool);
  const [escrowAuth] = escrowVaultAuthorityPda(core, args.pool);
  const [repConfig] = reputationConfigPda(reputation);
  const [repProfile] = reputationProfilePda(reputation, args.defaultedMemberWallet);

  const schemaId = ATTESTATION_SCHEMA.Default;
  const nonce = attestationNonce(args.cycle, args.slotIndex);
  // sentinel for "no identity linked" — pass the reputation program itself
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

  // [discriminator (8) | cycle (u8 = 1)] = 9 bytes total.
  if (args.cycle < 0 || args.cycle > 255) {
    throw new Error(`settle_default cycle must fit u8 (0..=255); got ${args.cycle}`);
  }
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

export interface SendSettleDefaultArgs extends BuildSettleDefaultIxArgs {
  connection: Connection;
  /** Wallet adapter callback — usually `wallet.sendTransaction`. */
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
}

/**
 * One-shot helper: build the settle_default instruction, wrap it in a
 * Transaction with the latest blockhash + caller as fee payer, and
 * dispatch via the wallet adapter's sendTransaction.
 *
 * The caller wallet must be the same as `args.caller`. The defaulted
 * member does NOT sign — the protocol is permissionless about who
 * cranks, gated only by the grace-period precondition.
 */
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

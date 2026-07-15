/**
 * IDL-free encoder + sender for `roundfi-core::crank_payout` — the
 * permissionless liveness twin of `claim_payout` (SEV-051).
 *
 * Unlike `claim_payout` (the member claims for themselves), ANY wallet can
 * call this to unstick a pool whose LIVE contemplated member never claimed:
 * the credit is delivered to the MEMBER's OWN USDC ATA (pinned on-chain to
 * `member.wallet`), never the caller's, so there's no theft vector. It's gated
 * on-chain to `now >= next_cycle_at + GRACE_PERIOD_SECS` (the member keeps
 * first dibs to self-claim); calling early reverts with `PayoutGraceActive`.
 *
 * 16 accounts in the declaration order from `crank_payout.rs::CrankPayout`
 * (15 + the SEV-053 `neglect_attestation` PDA). The caller signs + pays; the
 * contemplated member does NOT sign.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { ATTESTATION_SCHEMA } from "@roundfi/sdk/constants";
import {
  attestationNonce,
  attestationPda,
  memberPda,
  protocolConfigPda,
  reputationConfigPda,
  reputationProfilePda,
} from "@roundfi/sdk/pda";

import { DEVNET_PROGRAM_IDS, DEVNET_USDC_MINT } from "./devnet";
import { simulateOrThrow } from "./simulateTx";

// sha256("global:crank_payout")[:8] — precomputed.
//   $ node -e 'console.log(require("crypto").createHash("sha256")
//                .update("global:crank_payout").digest()
//                .subarray(0,8).toString("hex"))'
//   → 82b362f386f8c951
const CRANK_PAYOUT_DISCRIMINATOR = Buffer.from([0x82, 0xb3, 0x62, 0xf3, 0x86, 0xf8, 0xc9, 0x51]);

export interface BuildCrankPayoutIxArgs {
  /** Pool PDA (mutable). */
  pool: PublicKey;
  /** Sorteio pools (ADR pool_v2): the pool's DrawResult PDA, appended as
   *  the first remaining account so the on-chain seat→cycle translation
   *  runs. Omit for ArrivalOrder pools — call shape unchanged. */
  drawResult?: PublicKey;
  /** Permissionless caller — signs + pays. Need NOT be a member. */
  caller: PublicKey;
  /** The contemplated member's wallet (slot == current_cycle). Does NOT sign;
   *  used to derive the member PDA + the payout-destination ATA. */
  contemplatedMemberWallet: PublicKey;
  /** Cycle to crank, must equal pool.current_cycle. */
  cycle: number;
  /** Slot index for the attestation nonce — equals cycle at the contemplated slot. */
  slotIndex: number;
  /** Optional program ID override — for tests. Defaults to `DEVNET_PROGRAM_IDS`. */
  programIds?: { core: PublicKey; reputation: PublicKey };
  /** Optional USDC mint override — pairs with `programIds` for tests. */
  usdcMint?: PublicKey;
}

/** Build the raw `crank_payout(cycle)` instruction (15 accounts). */
export function buildCrankPayoutIx(args: BuildCrankPayoutIxArgs): TransactionInstruction {
  const core = args.programIds?.core ?? DEVNET_PROGRAM_IDS.core;
  const reputation = args.programIds?.reputation ?? DEVNET_PROGRAM_IDS.reputation;
  const usdcMint = args.usdcMint ?? DEVNET_USDC_MINT;

  const [config] = protocolConfigPda(core);
  const [member] = memberPda(core, args.pool, args.contemplatedMemberWallet);
  const [repConfig] = reputationConfigPda(reputation);
  const [repProfile] = reputationProfilePda(reputation, args.contemplatedMemberWallet);

  const schemaId = ATTESTATION_SCHEMA.PayoutClaimed;
  const nonce = attestationNonce(args.cycle, args.slotIndex);
  const identityRecord = reputation; // sentinel for "no identity linked"
  const [attestation] = attestationPda(
    reputation,
    args.pool,
    args.contemplatedMemberWallet,
    schemaId,
    nonce,
  );
  // SEV-053 option B: crank_payout also mints a CLAIM_NEGLECT attestation
  // (schema 7) on the contemplated member — same nonce, distinct schema seed.
  const [neglectAttestation] = attestationPda(
    reputation,
    args.pool,
    args.contemplatedMemberWallet,
    ATTESTATION_SCHEMA.ClaimNeglect,
    nonce,
  );

  const memberUsdc = getAssociatedTokenAddressSync(usdcMint, args.contemplatedMemberWallet);
  const poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, args.pool, true);

  const data = Buffer.concat([CRANK_PAYOUT_DISCRIMINATOR, Buffer.from([args.cycle & 0xff])]);

  // Account order matches `CrankPayout<'info>` in crank_payout.rs.
  return new TransactionInstruction({
    programId: core,
    data,
    keys: [
      { pubkey: args.caller, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: args.pool, isSigner: false, isWritable: true },
      { pubkey: member, isSigner: false, isWritable: true },
      { pubkey: args.contemplatedMemberWallet, isSigner: false, isWritable: false },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: memberUsdc, isSigner: false, isWritable: true },
      { pubkey: poolUsdcVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: reputation, isSigner: false, isWritable: false },
      { pubkey: repConfig, isSigner: false, isWritable: true },
      { pubkey: repProfile, isSigner: false, isWritable: true },
      { pubkey: identityRecord, isSigner: false, isWritable: false },
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: neglectAttestation, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      // Sorteio pools (ADR pool_v2): the pool's DrawResult PDA rides as a
      // REMAINING account (not part of the declared struct) so ArrivalOrder
      // pools keep their exact 16-account call shape. Omit for arrival pools.
      ...(args.drawResult ? [{ pubkey: args.drawResult, isSigner: false, isWritable: false }] : []),
    ],
  });
}

export interface SendCrankPayoutArgs extends BuildCrankPayoutIxArgs {
  connection: Connection;
  /** Wallet adapter callback — usually `wallet.sendTransaction`. */
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
}

/** Build, sign-via-wallet, and confirm the crank_payout tx. */
export async function sendCrankPayout(args: SendCrankPayoutArgs): Promise<string> {
  const ix = buildCrankPayoutIx(args);
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await args.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = args.caller;

  // Dry-run before the wallet signs — never sign a tx that will fail
  // on-chain (frontend-security checklist §2.2). Surfaces PayoutGraceActive
  // (too early), WaterfallUnderflow (pool float short), etc. before signing.
  await simulateOrThrow(args.connection, tx);

  const signature = await args.sendTransaction(tx, args.connection);
  await args.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return signature;
}

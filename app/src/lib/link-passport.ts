/**
 * IDL-free encoder + sender for the devnet Human Passport verification flow,
 * callable from the browser via the wallet adapter. Symmetric to
 * `contribute.ts` (ADR 0002 / 0006 — the app ships no IDL).
 *
 * One transaction, ONE wallet signature, two instructions:
 *   1. `devnet_issue_attestation(ttl)` — mints the caller's 83-byte
 *      attestation PDA (gated behind the program's `devnet-identity-shim`
 *      feature; DEVNET ONLY).
 *   2. `link_passport_identity()` — the REAL, unchanged handler validates
 *      that PDA byte-for-byte and writes a Verified `IdentityRecord`.
 *
 * Mirrors the real bridge → link production flow (bridge issues the
 * attestation, user links it) collapsed into one self-service devnet tx.
 * On mainnet the issue instruction does not exist, so this whole path is
 * devnet-only by construction; callers gate the button on network !=
 * mainnet-beta.
 *
 * Pre-condition (operator's one-time responsibility): the reputation program
 * was upgraded with the shim feature and `devnet_seed_passport_authority` was
 * run, repointing `passport_attestation_authority` at the program. Until then
 * the link sub-instruction reverts with InvalidIdentityProof (owner mismatch)
 * — surfaced as a clean simulation error, never a silent failure.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";

import { devnetPassportPda, identityPda, reputationConfigPda } from "@roundfi/sdk/pda";

import { DEVNET_PROGRAM_IDS } from "./devnet";
import { simulateOrThrow } from "./simulateTx";

// sha256("global:devnet_issue_attestation")[:8]
const ISSUE_DISCRIMINATOR = Buffer.from([0xf6, 0x94, 0xd0, 0x91, 0x01, 0x4b, 0x4c, 0x8b]);
// sha256("global:link_passport_identity")[:8]
const LINK_DISCRIMINATOR = Buffer.from([0x10, 0xda, 0xac, 0xca, 0x55, 0xe7, 0x73, 0x7c]);

// 90-day attestation TTL — the bridge's documented default, well within the
// 180-day on-chain horizon ceiling (MAX_PASSPORT_HORIZON_SECS).
const TTL_SECONDS = 90 * 24 * 60 * 60;

function i64le(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(n));
  return b;
}

export interface BuildVerifyPassportIxsArgs {
  /** Connected wallet — pays + signs; is both the attestation subject and
   *  the identity being linked. */
  wallet: PublicKey;
  /** Optional program-id override (tests); defaults to devnet. */
  reputationProgram?: PublicKey;
  /** Optional TTL override in seconds (default 90d). */
  ttlSeconds?: number;
}

/**
 * Build the two instructions `[devnet_issue_attestation, link_passport_identity]`.
 * Account orders MUST match `DevnetIssueAttestation` and `LinkPassportIdentity`
 * in programs/roundfi-reputation/src/instructions/*.rs.
 */
export function buildVerifyPassportIxs(args: BuildVerifyPassportIxsArgs): TransactionInstruction[] {
  const reputation = args.reputationProgram ?? DEVNET_PROGRAM_IDS.reputation;
  const ttl = args.ttlSeconds ?? TTL_SECONDS;

  const [config] = reputationConfigPda(reputation);
  const [attestation] = devnetPassportPda(reputation, args.wallet);
  const [identity] = identityPda(reputation, args.wallet);

  // 1. devnet_issue_attestation(ttl_seconds) — DevnetIssueAttestation:
  //    [subject(signer,mut), config, attestation(mut), system_program]
  const issueIx = new TransactionInstruction({
    programId: reputation,
    data: Buffer.concat([ISSUE_DISCRIMINATOR, i64le(ttl)]),
    keys: [
      { pubkey: args.wallet, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });

  // 2. link_passport_identity() — LinkPassportIdentity:
  //    [wallet(signer,mut), config, identity(mut), gateway_token, system_program]
  const linkIx = new TransactionInstruction({
    programId: reputation,
    data: LINK_DISCRIMINATOR,
    keys: [
      { pubkey: args.wallet, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: identity, isSigner: false, isWritable: true },
      { pubkey: attestation, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });

  return [issueIx, linkIx];
}

export interface SendVerifyPassportArgs extends BuildVerifyPassportIxsArgs {
  connection: Connection;
  /** Wallet adapter callback — usually `wallet.sendTransaction`. */
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
}

/**
 * One-shot: build the issue+link tx, set blockhash + fee payer, dry-run,
 * dispatch via the wallet adapter, and confirm. Returns the signature, or
 * throws (caller renders the error).
 */
export async function sendVerifyPassport(args: SendVerifyPassportArgs): Promise<string> {
  const ixs = buildVerifyPassportIxs(args);
  const tx = new Transaction().add(...ixs);
  const { blockhash, lastValidBlockHeight } = await args.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = args.wallet;

  // Dry-run before the wallet signs — never sign a tx that will fail on-chain.
  await simulateOrThrow(args.connection, tx);

  const signature = await args.sendTransaction(tx, args.connection);
  await args.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return signature;
}

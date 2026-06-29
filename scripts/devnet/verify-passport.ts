/**
 * DEVNET-ONLY self-test for the Human Passport identity shim.
 *
 * Sends ONE transaction `[devnet_issue_attestation, link_passport_identity]`
 * signed by a single wallet, then reads back the on-chain IdentityRecord to
 * confirm it is Verified. This is exactly what the app's "Conectar Human
 * Passport" button does — use it to prove the end-to-end flow on devnet
 * before redeploying the app.
 *
 * Prereqs (one-time):
 *   DEVNET_IDENTITY_SHIM=1 pnpm run devnet:deploy     # upgrade reputation
 *   pnpm run devnet:seed-passport-shim                # repoint authority
 *
 * Usage:
 *   pnpm run devnet:verify-passport                   # uses ~/.config/solana/id.json
 *   pnpm run devnet:verify-passport ./some-wallet.json
 *
 * IDL-free hand-rolled encoding (ADR 0002), same wire format as init-protocol.ts.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { loadCluster, requireProgram } from "../../config/clusters.js";
import { devnetPassportPda, identityPda, reputationConfigPda } from "@roundfi/sdk/pda";
import { fetchIdentityRecordRaw } from "@roundfi/sdk/onchain-raw";

// 90-day attestation TTL — the bridge's documented default, well within the
// 180-day on-chain horizon ceiling (MAX_PASSPORT_HORIZON_SECS).
const TTL_SECONDS = 90 * 24 * 60 * 60;

const STATUS_LABEL = ["Unverified", "Verified", "Expired", "Revoked"];

function loadKeypair(path: string): Keypair {
  if (!existsSync(path)) throw new Error(`keypair not found at ${path}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf-8"))));
}

function disc(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function i64le(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(n));
  return b;
}

async function main() {
  const cluster = loadCluster();
  if (cluster.name === "mainnet-beta")
    throw new Error("Refusing to run the devnet shim on mainnet.");
  console.log(`\n━━━ RoundFi verify-passport → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);

  const rep = requireProgram(cluster, "reputation");
  const walletPath =
    process.argv[2] ?? process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  const subject = loadKeypair(walletPath);
  const connection = new Connection(cluster.rpcUrl, "confirmed");

  const [config] = reputationConfigPda(rep);
  const [attestation] = devnetPassportPda(rep, subject.publicKey);
  const [identity] = identityPda(rep, subject.publicKey);

  console.log(`→ Reputation prog : ${rep.toBase58()}`);
  console.log(`→ Subject wallet  : ${subject.publicKey.toBase58()}`);
  console.log(`→ Attestation PDA : ${attestation.toBase58()}`);
  console.log(`→ Identity PDA    : ${identity.toBase58()}\n`);

  const bal = await connection.getBalance(subject.publicKey);
  if (bal < 0.01 * 1e9) {
    throw new Error(`Subject has < 0.01 SOL (${subject.publicKey.toBase58()}); fund it first.`);
  }

  // ix1 — devnet_issue_attestation(ttl_seconds): mint the 83-byte PDA.
  const issueIx = new TransactionInstruction({
    programId: rep,
    keys: [
      { pubkey: subject.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("devnet_issue_attestation"), i64le(TTL_SECONDS)]),
  });

  // ix2 — link_passport_identity(): the REAL, unchanged handler validates the
  // PDA byte-for-byte and writes a Verified IdentityRecord.
  const linkIx = new TransactionInstruction({
    programId: rep,
    keys: [
      { pubkey: subject.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: identity, isSigner: false, isWritable: true },
      { pubkey: attestation, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: disc("link_passport_identity"),
  });

  const sig = await connection.sendTransaction(new Transaction().add(issueIx, linkIx), [subject], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");
  console.log(`✓ issue + link confirmed`);
  console.log(`  signature: ${sig}`);
  console.log(`  https://solscan.io/tx/${sig}?cluster=devnet\n`);

  const rec = await fetchIdentityRecordRaw(connection, rep, subject.publicKey);
  if (!rec) {
    console.log("✗ IdentityRecord not found after link — unexpected.");
    process.exit(1);
  }
  const expiresAt = Number(rec.expiresAt);
  console.log(`→ IdentityRecord:`);
  console.log(`    status      : ${rec.status} (${STATUS_LABEL[rec.status] ?? "?"})`);
  console.log(`    provider    : ${rec.provider} (2 = HumanPassport)`);
  console.log(
    `    expires_at  : ${expiresAt} (${expiresAt ? new Date(expiresAt * 1000).toISOString() : "never"})`,
  );
  console.log(`    attestation : ${rec.gatewayToken.toBase58()}\n`);
  console.log(
    rec.status === 1
      ? "✓ VERIFIED on-chain — the real link flow works.\n"
      : "⚠ Not Verified — check the logs above.\n",
  );
}

main().catch((e) => {
  console.error("\n✗ verify-passport failed:");
  console.error(e);
  process.exit(1);
});

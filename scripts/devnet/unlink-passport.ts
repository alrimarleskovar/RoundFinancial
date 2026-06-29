/**
 * DEVNET reverse path for the Human Passport flow: unlink a wallet's
 * identity. Calls the REAL `unlink_identity` instruction (unchanged, audited)
 * — closes the IdentityRecord (rent back to the wallet) and re-caps the
 * stored reputation level to the identity floor (SEV-E). Proves the
 * verified → Unverified transition on-chain.
 *
 * Usage:
 *   pnpm run devnet:unlink-passport                  # uses ~/.config/solana/id.json
 *   pnpm run devnet:unlink-passport ./some-wallet.json
 *
 * Note: this needs the wallet's KEYPAIR (it signs its own unlink), so it
 * only works for wallets you hold a keypair file for — not a browser wallet.
 *
 * IDL-free hand-rolled encoding (ADR 0002).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { loadCluster, requireProgram } from "../../config/clusters.js";
import { identityGatePda, identityPda, reputationProfilePda } from "@roundfi/sdk/pda";
import { fetchIdentityRecordRaw } from "@roundfi/sdk/onchain-raw";

const STATUS_LABEL = ["Unverified", "Verified", "Expired", "Revoked"];

function loadKeypair(path: string): Keypair {
  if (!existsSync(path)) throw new Error(`keypair not found at ${path}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf-8"))));
}

function disc(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

async function main() {
  const cluster = loadCluster();
  if (cluster.name === "mainnet-beta")
    throw new Error("Refusing to run the devnet shim on mainnet.");
  console.log(`\n━━━ RoundFi unlink-passport → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);

  const rep = requireProgram(cluster, "reputation");
  const walletPath =
    process.argv[2] ?? process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  const wallet = loadKeypair(walletPath);
  const connection = new Connection(cluster.rpcUrl, "confirmed");

  const [identity] = identityPda(rep, wallet.publicKey);
  const [identityGate] = identityGatePda(rep);
  const [profile] = reputationProfilePda(rep, wallet.publicKey);

  console.log(`→ Wallet        : ${wallet.publicKey.toBase58()}`);
  console.log(`→ Identity PDA  : ${identity.toBase58()}`);
  console.log(`→ Identity gate : ${identityGate.toBase58()}\n`);

  // Pre-flight: nothing to unlink if there's no IdentityRecord.
  const before = await fetchIdentityRecordRaw(connection, rep, wallet.publicKey);
  if (!before) {
    console.log("→ No IdentityRecord for this wallet — already Unverified. Nothing to do.\n");
    return;
  }
  console.log(`→ Current status: ${before.status} (${STATUS_LABEL[before.status] ?? "?"})\n`);

  // `unlink_identity` REQUIRES the identity-gate singleton (SEV-047). If it
  // was never initialized on this cluster the tx can't load it.
  const gateInfo = await connection.getAccountInfo(identityGate, "confirmed");
  if (!gateInfo) {
    throw new Error(
      `identity-gate not initialized at ${identityGate.toBase58()}. ` +
        `Run "pnpm run devnet:set-identity-gate 0" first (initializes the singleton).`,
    );
  }

  // profile is an OPTIONAL account: pass the real PDA when it exists, else the
  // program id as Anchor's "None" sentinel.
  const profileInfo = await connection.getAccountInfo(profile, "confirmed");
  const profileAccount = profileInfo ? profile : rep;
  const profileWritable = Boolean(profileInfo);

  // Accounts mirror `UnlinkIdentity`: [wallet(signer,mut), identity(mut,close),
  // identity_gate, profile(optional)].
  const ix = new TransactionInstruction({
    programId: rep,
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: identity, isSigner: false, isWritable: true },
      { pubkey: identityGate, isSigner: false, isWritable: false },
      { pubkey: profileAccount, isSigner: false, isWritable: profileWritable },
    ],
    data: disc("unlink_identity"),
  });

  const sig = await connection.sendTransaction(new Transaction().add(ix), [wallet], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");
  console.log(`✓ unlink confirmed`);
  console.log(`  signature: ${sig}`);
  console.log(`  https://solscan.io/tx/${sig}?cluster=devnet\n`);

  const after = await fetchIdentityRecordRaw(connection, rep, wallet.publicKey);
  if (after) {
    console.log(`⚠ IdentityRecord still present (status ${after.status}) — unexpected.\n`);
    process.exit(1);
  }
  console.log("✓ UNLINKED — IdentityRecord closed; wallet is now Unverified on-chain.");
  console.log("  (In the app, its Human Passport card will show 'Não verificado'.)\n");
}

main().catch((e) => {
  console.error("\n✗ unlink-passport failed:");
  console.error(e);
  process.exit(1);
});

/**
 * DEVNET-ONLY: one-time setup for the Human Passport identity shim.
 *
 * Calls `roundfi_reputation.devnet_seed_passport_authority`, which repoints
 * the (prod-frozen) `ReputationConfig.passport_attestation_authority` to the
 * reputation program itself — so the program-owned attestation PDAs minted by
 * `devnet_issue_attestation` validate inside the REAL `link_passport_identity`.
 *
 * Prereq: deploy the reputation program WITH the shim feature first:
 *   DEVNET_IDENTITY_SHIM=1 pnpm run devnet:deploy
 * Then run this once:
 *   pnpm run devnet:seed-passport-shim
 *
 * The instruction is admin-gated (config.authority must sign) and the whole
 * code path is compiled out of mainnet artifacts. Manual instruction encoding,
 * same hand-rolled wire format as `init-protocol.ts` (IDL-free, ADR 0002).
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

function loadKeypair(path: string): Keypair {
  if (!existsSync(path)) throw new Error(`keypair not found at ${path}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf-8"))));
}

function anchorIxDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

async function main() {
  const cluster = loadCluster();
  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to run the devnet identity shim on mainnet.");
  }
  console.log(`\n━━━ RoundFi seed-passport-shim → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);

  const reputationProgram = requireProgram(cluster, "reputation");
  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  const authority = loadKeypair(walletPath);
  const connection = new Connection(cluster.rpcUrl, "confirmed");

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("rep-config")],
    reputationProgram,
  );

  console.log(`→ Reputation prog : ${reputationProgram.toBase58()}`);
  console.log(`→ Authority       : ${authority.publicKey.toBase58()}`);
  console.log(`→ ReputationConfig: ${configPda.toBase58()}\n`);

  const cfg = await connection.getAccountInfo(configPda, "confirmed");
  if (!cfg) {
    throw new Error(
      `ReputationConfig not initialized at ${configPda.toBase58()}. Run "pnpm run devnet:init" first.`,
    );
  }
  // passport_attestation_authority lives at offset 72 (8 disc + 32 authority + 32 core).
  const currentAuthority = new PublicKey(cfg.data.subarray(72, 104));
  console.log(`→ current passport_attestation_authority: ${currentAuthority.toBase58()}`);
  if (currentAuthority.equals(reputationProgram)) {
    console.log(`\n✓ Already repointed to the reputation program — nothing to do.\n`);
    return;
  }

  // Accounts mirror `DevnetSeedPassportAuthority`: [authority(signer), config(mut)].
  const ix = new TransactionInstruction({
    programId: reputationProgram,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: true },
    ],
    data: anchorIxDiscriminator("devnet_seed_passport_authority"),
  });

  const sig = await connection.sendTransaction(new Transaction().add(ix), [authority], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");

  console.log(`\n✓ passport_attestation_authority repointed to ${reputationProgram.toBase58()}`);
  console.log(`  signature: ${sig}`);
  console.log(`  https://solscan.io/tx/${sig}?cluster=devnet\n`);
  console.log(`Next: each teammate clicks "Conectar Human Passport" in the app (one signature),`);
  console.log(`or run "pnpm run devnet:verify-passport" to self-test the issue+link flow.\n`);
}

main().catch((e) => {
  console.error("\n✗ seed-passport-shim failed:");
  console.error(e);
  process.exit(1);
});

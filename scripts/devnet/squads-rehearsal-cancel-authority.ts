/**
 * Squads rehearsal — submit `cancel_new_authority()`.
 *
 * Aborts a pending authority rotation before its 7-day eta fires. Used:
 *   - When the proposed pubkey was wrong (typo, wrong PDA derivation)
 *   - When community spots a malicious proposal pre-commit
 *   - As precondition for re-proposing (propose handler refuses to
 *     overwrite an existing pending eta)
 *
 * Signer must be the current `config.authority`. Live `config.authority`
 * is never touched — only `pending_authority` + `pending_authority_eta`
 * get reset to defaults.
 *
 * Closes part of Fase B of the Squads ceremony preparation track.
 *
 * ## Usage
 *
 * ```bash
 * pnpm tsx scripts/devnet/squads-rehearsal-cancel-authority.ts
 * ```
 *
 * No flags — operates on whatever proposal is currently pending. If
 * none is pending, the on-chain `NoPendingAuthorityChange` error fires
 * and the script reports the failure.
 *
 * Refuses to run on mainnet.
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
  if (!existsSync(path)) {
    throw new Error(`keypair not found at ${path}`);
  }
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

function anchorIxDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

async function main(): Promise<void> {
  const cluster = loadCluster();
  console.log(`\n━━━ Squads rehearsal · cancel → ${cluster.name} ━━━\n`);

  if (cluster.name === "mainnet-beta") {
    throw new Error(
      "Refusing to cancel authority rotation on mainnet via this script. " +
        "Mainnet operations go through Squads web UI + hardware wallets.",
    );
  }

  const coreProgram = requireProgram(cluster, "core");
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);

  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  const authority = loadKeypair(walletPath);

  console.log(`→ Cluster        : ${cluster.name}`);
  console.log(`→ Core program   : ${coreProgram.toBase58()}`);
  console.log(`→ Config PDA     : ${configPda.toBase58()}`);
  console.log(`→ Signer (auth.) : ${authority.publicKey.toBase58()}\n`);

  // ix.data = [discriminator (8)] — no args
  const data = anchorIxDiscriminator("cancel_new_authority");

  // Account list mirrors `CancelNewAuthority`:
  //   1. config    (PDA, mut; constraint authority == config.authority)
  //   2. authority (signer)
  const ix = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    data,
  });

  const connection = new Connection(cluster.rpcUrl, "confirmed");
  const tx = new Transaction().add(ix);
  const signature = await connection.sendTransaction(tx, [authority], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");

  console.log(`✓ cancel_new_authority confirmed`);
  console.log(`  signature : ${signature}`);
  if (cluster.name === "devnet") {
    console.log(`  solscan   : https://solscan.io/tx/${signature}?cluster=devnet`);
  }
  console.log("");
  console.log("`pending_authority` reset to default; a fresh");
  console.log("`squads-rehearsal-propose-authority.ts` can now run.");
  console.log("");
}

main().catch((e) => {
  console.error("\n✗ squads-rehearsal-cancel-authority failed:");
  console.error(e);
  process.exit(1);
});

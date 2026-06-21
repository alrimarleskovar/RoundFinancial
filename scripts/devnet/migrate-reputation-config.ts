/**
 * Migrate the `ReputationConfig` singleton to the current struct layout.
 *
 * **Why this exists.** `ReputationConfig` grew over time (notably the
 * SEV-021 authority-rotation fields). Anchor sizes accounts at create
 * time, so a config PDA created by an older program build is too short
 * for the current struct — every instruction that loads it reverts with
 * `AccountDidNotDeserialize` (0xbbb). `migrate_reputation_config`
 * (authority-gated) reallocs the account up to the current LEN in place.
 * Idempotent — a no-op once the account is already current.
 *
 * Run this on any cluster whose `ReputationConfig` predates the current
 * build (the devnet singleton, for example) BEFORE other reputation
 * instructions (attest, promote_level, set_identity_gate) will work.
 *
 * Manual instruction encoding (no Anchor TS client), same rationale as
 * `init-protocol.ts` (IDL-free by design, ADR 0002; hand-rolled, not
 * blocked).
 *
 * Usage:
 *   pnpm devnet:migrate-reputation-config
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

// Current ReputationConfig size including the 8-byte discriminator —
// mirrors `ReputationConfig::LEN` (8 + 32*4 + 1 + 1 + 32 + 8).
const REPUTATION_CONFIG_LEN = 8 + 32 * 4 + 1 + 1 + 32 + 8;

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

async function main() {
  const cluster = loadCluster();
  console.log(
    `\n━━━ RoundFi migrate-reputation-config → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`,
  );

  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to run on mainnet — use a deliberate process.");
  }

  const reputationProgram = requireProgram(cluster, "reputation");

  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  const authority = loadKeypair(walletPath);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("rep-config")],
    reputationProgram,
  );

  console.log(`→ Cluster          : ${cluster.name}`);
  console.log(`→ Authority        : ${authority.publicKey.toBase58()}`);
  console.log(`→ Reputation prog  : ${reputationProgram.toBase58()}`);
  console.log(`→ ReputationConfig : ${configPda.toBase58()}`);
  console.log(`→ Target LEN       : ${REPUTATION_CONFIG_LEN} bytes\n`);

  const connection = new Connection(cluster.rpcUrl, "confirmed");

  const info = await connection.getAccountInfo(configPda, "confirmed");
  if (!info) {
    throw new Error(
      `ReputationConfig not found at ${configPda.toBase58()} — run 'pnpm devnet:init' first.`,
    );
  }
  console.log(`→ Current size     : ${info.data.length} bytes`);
  if (info.data.length >= REPUTATION_CONFIG_LEN) {
    console.log(`✓ already at current layout — nothing to migrate.\n`);
    return;
  }
  console.log(`→ needs migration  : ${info.data.length} → ${REPUTATION_CONFIG_LEN}\n`);

  const balance = await connection.getBalance(authority.publicKey);
  console.log(`→ Authority balance: ${(balance / 1e9).toFixed(4)} SOL`);
  if (balance < 0.01 * 1e9) {
    throw new Error(`Insufficient SOL on authority (${authority.publicKey.toBase58()}).`);
  }

  // ix.data = discriminator only (no args)
  const data = anchorIxDiscriminator("migrate_reputation_config");

  // Accounts (mirror `MigrateReputationConfig`):
  //   1. authority      (signer, mut)
  //   2. config         (PDA [rep-config]; mut — realloc target)
  //   3. system_program (read; rent top-up CPI)
  const ix = new TransactionInstruction({
    programId: reputationProgram,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const signature = await connection.sendTransaction(tx, [authority], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");

  const after = await connection.getAccountInfo(configPda, "confirmed");
  console.log(`✓ migrate_reputation_config confirmed`);
  console.log(`  new size  : ${after?.data.length} bytes`);
  console.log(`  signature : ${signature}\n`);

  console.log(`━━━ done ━━━\n`);
  console.log(`Solscan (devnet):`);
  console.log(`  https://solscan.io/tx/${signature}?cluster=devnet\n`);
}

main().catch((e) => {
  console.error("\n✗ migrate-reputation-config failed:");
  console.error(e);
  process.exit(1);
});

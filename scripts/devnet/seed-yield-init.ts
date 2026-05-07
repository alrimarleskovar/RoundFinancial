/**
 * Initialize the yield_mock vault state for a given pool.
 *
 * Calls `roundfi_yield_mock.init_vault()` once per pool — creates the
 * `YieldVaultState` PDA at seeds `[b"yield-state", pool]` and the
 * vault ATA whose authority is that state PDA.
 *
 * After this runs, `roundfi_core.deposit_idle_to_yield` and
 * `roundfi_core.harvest_yield` can target this pool's adapter.
 *
 * Idempotent: short-circuits if the state PDA already exists.
 *
 * Env: POOL_SEED_ID (default 1) — must match the pool you want to bind.
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
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { loadCluster, requireProgram } from "../../config/clusters.js";

const POOL_SEED_ID = process.env.POOL_SEED_ID ? BigInt(process.env.POOL_SEED_ID) : 1n;
const DEPLOYMENT_CONFIG_PATH = resolve(process.cwd(), "config/program-ids.devnet.json");

function loadKeypair(path: string): Keypair {
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

function anchorIxDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function poolPda(coreProgram: PublicKey, deployer: PublicKey, seedId: bigint): PublicKey {
  const seedIdLe = Buffer.alloc(8);
  seedIdLe.writeBigUInt64LE(seedId, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), deployer.toBuffer(), seedIdLe],
    coreProgram,
  )[0];
}

async function main() {
  const cluster = loadCluster();
  console.log(`\n━━━ RoundFi seed-yield-init → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);
  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to seed yield on mainnet — use a deliberate process.");
  }

  const coreProgram = requireProgram(cluster, "core");
  const yieldMock = requireProgram(cluster, "yieldMock");
  const usdcMint = cluster.usdcMint;

  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  if (!existsSync(walletPath)) {
    throw new Error(
      `Deployer keypair not found at ${walletPath}. init_vault is payer-signed by the deployer.`,
    );
  }
  const deployer = loadKeypair(walletPath);
  let deployerPubkeyForPool: PublicKey;
  if (existsSync(DEPLOYMENT_CONFIG_PATH)) {
    const cfg = JSON.parse(readFileSync(DEPLOYMENT_CONFIG_PATH, "utf-8")) as { deployer?: string };
    deployerPubkeyForPool = cfg.deployer ? new PublicKey(cfg.deployer) : deployer.publicKey;
  } else {
    deployerPubkeyForPool = deployer.publicKey;
  }
  const pool = poolPda(coreProgram, deployerPubkeyForPool, POOL_SEED_ID);

  const [statePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("yield-state"), pool.toBuffer()],
    yieldMock,
  );
  const yieldVault = getAssociatedTokenAddressSync(usdcMint, statePda, true);

  console.log(`→ Cluster        : ${cluster.name}`);
  console.log(`→ Deployer       : ${deployer.publicKey.toBase58()}`);
  console.log(`→ Pool seed id   : ${POOL_SEED_ID}`);
  console.log(`→ Pool PDA       : ${pool.toBase58()}`);
  console.log(`→ Yield mock ID  : ${yieldMock.toBase58()}`);
  console.log(`→ State PDA      : ${statePda.toBase58()}`);
  console.log(`→ Yield vault    : ${yieldVault.toBase58()}\n`);

  const connection = new Connection(cluster.rpcUrl, "confirmed");

  const existing = await connection.getAccountInfo(statePda, "confirmed");
  if (existing) {
    console.log(`✓ State PDA already exists — yield vault initialized for pool ${POOL_SEED_ID}.`);
    return;
  }

  // ix: init_vault — no args
  const data = anchorIxDiscriminator("init_vault");

  // Account order matches `InitVault` in
  // programs/roundfi-yield-mock/src/lib.rs:
  //   1. payer (signer, mut)
  //   2. pool  (UncheckedAccount)
  //   3. mint  (read)
  //   4. state (PDA, init)
  //   5. vault (ATA, init)
  //   6. system_program
  //   7. token_program
  //   8. associated_token_program
  //   9. rent
  const ix = new TransactionInstruction({
    programId: yieldMock,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: statePda, isSigner: false, isWritable: true },
      { pubkey: yieldVault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [deployer], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");

  console.log(`✓ init_vault landed`);
  console.log(`    signature: ${sig}\n`);
  console.log(`Solscan (devnet):`);
  console.log(`  init tx     : https://solscan.io/tx/${sig}?cluster=devnet`);
  console.log(`  state PDA   : https://solscan.io/account/${statePda.toBase58()}?cluster=devnet`);
  console.log(`  yield vault : https://solscan.io/account/${yieldVault.toBase58()}?cluster=devnet`);
  console.log("");
}

main().catch((e) => {
  console.error("\n✗ seed-yield-init failed:");
  console.error(e);
  process.exit(1);
});

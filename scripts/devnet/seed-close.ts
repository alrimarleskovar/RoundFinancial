/**
 * Finalize a Completed pool via `roundfi_core.close_pool()`.
 *
 * Preconditions (enforced on chain):
 *   - `pool.status == Completed` (terminal state from claim_payout's
 *     last cycle advance)
 *   - `pool.defaulted_members == 0` OR `pool.escrow_balance == 0`
 *     (no dangling default with retained escrow)
 *   - Caller is `pool.authority` (creator) OR `config.authority`
 *
 * The handler currently emits a summary log with final balances —
 * vault-close + rent-return is deferred per the file header in
 * close_pool.rs. For the devnet demo, "Completed + close_pool emitted"
 * is the protocol's final lifecycle state.
 *
 * Env:
 *   POOL_SEED_ID         (default 1 — pool 1 is Completed; pool 2 is Active)
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

/**
 * Pool layout — read status (offset 145) + a few summary fields for
 * pre-call display. See seed-claim.ts for the full layout snapshot.
 */
function decodePoolStatus(data: Buffer): number {
  return data.readUInt8(145);
}

async function main() {
  const cluster = loadCluster();
  console.log(`\n━━━ RoundFi seed-close → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);
  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to close pool on mainnet — use a deliberate process.");
  }

  const coreProgram = requireProgram(cluster, "core");

  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  if (!existsSync(walletPath)) {
    throw new Error(`Authority keypair not found at ${walletPath}.`);
  }
  const authority = loadKeypair(walletPath);

  let cfgDeployer: PublicKey = authority.publicKey;
  if (existsSync(DEPLOYMENT_CONFIG_PATH)) {
    const cfg = JSON.parse(readFileSync(DEPLOYMENT_CONFIG_PATH, "utf-8")) as { deployer?: string };
    if (cfg.deployer) cfgDeployer = new PublicKey(cfg.deployer);
  }
  const pool = poolPda(coreProgram, cfgDeployer, POOL_SEED_ID);
  const [protocolConfig] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);

  console.log(`→ Cluster      : ${cluster.name}`);
  console.log(`→ Authority    : ${authority.publicKey.toBase58()}`);
  console.log(`→ Pool seed id : ${POOL_SEED_ID}`);
  console.log(`→ Pool PDA     : ${pool.toBase58()}`);

  const connection = new Connection(cluster.rpcUrl, "confirmed");

  const poolInfo = await connection.getAccountInfo(pool, "confirmed");
  if (!poolInfo) {
    throw new Error(`Pool not found at ${pool.toBase58()}.`);
  }
  const status = decodePoolStatus(poolInfo.data);
  const statusName =
    status === 0
      ? "Forming"
      : status === 1
        ? "Active"
        : status === 2
          ? "Completed"
          : status === 3
            ? "Liquidated"
            : `Unknown(${status})`;
  console.log(`→ Pool status  : ${statusName} (${status})\n`);

  if (status !== 2) {
    throw new Error(
      `Pool is not Completed (status=${status}). close_pool requires status=2 (Completed). ` +
        `Drive cycles to completion first via seed-cycle + seed-claim.`,
    );
  }

  // ix: close_pool — no args
  const data = anchorIxDiscriminator("close_pool");

  // Account order matches `ClosePool` in
  // programs/roundfi-core/src/instructions/close_pool.rs:
  //   1. config    (PDA, read)
  //   2. authority (signer)
  //   3. pool      (PDA, mut)
  const ix = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: true },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [authority], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");

  console.log(`✓ close_pool landed`);
  console.log(`    signature: ${sig}\n`);

  // Pull the on-chain log to surface the summary msg!.
  const txDetail = await connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (txDetail?.meta?.logMessages) {
    const summary = txDetail.meta.logMessages.find((l) => l.includes("close_pool"));
    if (summary) console.log(`On-chain summary log:\n  ${summary}`);
  }

  console.log(`\n━━━ done ━━━\n`);
  console.log(`Solscan (devnet):`);
  console.log(`  close tx: https://solscan.io/tx/${sig}?cluster=devnet`);
  console.log(`  pool    : https://solscan.io/account/${pool.toBase58()}?cluster=devnet`);
  console.log("");
}

main().catch((e) => {
  console.error("\n✗ seed-close failed:");
  console.error(e);
  process.exit(1);
});

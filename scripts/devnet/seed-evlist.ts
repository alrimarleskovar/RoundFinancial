/**
 * List a pool member's position on the Escape Valve secondary market.
 *
 * Calls `roundfi_core.escape_valve_list(price_usdc)` signed by the
 * seller (a current member of the pool). Creates the
 * `EscapeValveListing` PDA at seeds `[b"listing", pool, slot_index]`
 * with `status = Active` and the asking price.
 *
 * Eligibility (enforced on chain):
 *   - Pool is Active
 *   - Member is not defaulted
 *   - Member is not behind on contributions
 *     (`contributions_paid >= pool.current_cycle`)
 *   - No active listing already exists for this slot
 *
 * Env:
 *   POOL_SEED_ID         (default 1)
 *   EVLIST_SLOT_INDEX    (default 1 — slot 1 / member 1 lists by default;
 *                          slot 0 was the cycle-0 winner in pool 1, slot 2
 *                          is the last slot in a 3-member pool)
 *   EVLIST_PRICE_USDC    (default 14 — slight discount vs $15 stake)
 *
 * Manual ix encoding (Anchor IDL gen still blocked).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { loadCluster, requireProgram } from "../../config/clusters.js";

const POOL_SEED_ID = process.env.POOL_SEED_ID ? BigInt(process.env.POOL_SEED_ID) : 1n;
const SLOT_INDEX = Number(process.env.EVLIST_SLOT_INDEX ?? 1);
const PRICE_USDC = process.env.EVLIST_PRICE_USDC
  ? BigInt(Math.round(Number(process.env.EVLIST_PRICE_USDC) * 1e6))
  : 14_000_000n; // 14 USDC default
const KEYPAIRS_DIR = resolve(process.cwd(), "keypairs");
const DEPLOYMENT_CONFIG_PATH = resolve(process.cwd(), "config/program-ids.devnet.json");

function loadKeypair(path: string): Keypair {
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

function loadMemberKeypair(slot: number): Keypair {
  const path = resolve(KEYPAIRS_DIR, `member-${slot}.json`);
  if (!existsSync(path)) {
    throw new Error(`Missing keypairs/member-${slot}.json — run 'pnpm devnet:seed-members' first.`);
  }
  return loadKeypair(path);
}

function anchorIxDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function encodeU64LE(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value, 0);
  return buf;
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
  console.log(`\n━━━ RoundFi seed-evlist → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);
  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to seed escape-valve listing on mainnet.");
  }

  const coreProgram = requireProgram(cluster, "core");

  let cfgDeployer: PublicKey;
  if (existsSync(DEPLOYMENT_CONFIG_PATH)) {
    const cfg = JSON.parse(readFileSync(DEPLOYMENT_CONFIG_PATH, "utf-8")) as { deployer?: string };
    cfgDeployer = cfg.deployer
      ? new PublicKey(cfg.deployer)
      : (() => {
          const walletPath =
            process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
          if (!existsSync(walletPath)) {
            throw new Error(`No deployer keypair found at ${walletPath}.`);
          }
          return loadKeypair(walletPath).publicKey;
        })();
  } else {
    const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
    cfgDeployer = loadKeypair(walletPath).publicKey;
  }

  const pool = poolPda(coreProgram, cfgDeployer, POOL_SEED_ID);
  const seller = loadMemberKeypair(SLOT_INDEX);
  const [memberPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), pool.toBuffer(), seller.publicKey.toBuffer()],
    coreProgram,
  );
  const [protocolConfig] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);
  const [listingPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("listing"), pool.toBuffer(), Uint8Array.of(SLOT_INDEX)],
    coreProgram,
  );

  console.log(`→ Cluster      : ${cluster.name}`);
  console.log(`→ Pool seed id : ${POOL_SEED_ID}`);
  console.log(`→ Pool PDA     : ${pool.toBase58()}`);
  console.log(`→ Seller slot  : ${SLOT_INDEX}`);
  console.log(`→ Seller pubkey: ${seller.publicKey.toBase58()}`);
  console.log(`→ Member PDA   : ${memberPda.toBase58()}`);
  console.log(`→ Listing PDA  : ${listingPda.toBase58()}`);
  console.log(`→ Price        : ${(Number(PRICE_USDC) / 1e6).toFixed(6)} USDC`);

  const connection = new Connection(cluster.rpcUrl, "confirmed");

  // Idempotency: if listing already exists, just print and exit.
  const existing = await connection.getAccountInfo(listingPda, "confirmed");
  if (existing) {
    console.log(
      `\n✓ Listing PDA already exists for slot ${SLOT_INDEX} — skipping (cancel + re-list separately if needed).`,
    );
    return;
  }

  // Pre-flight: confirm pool exists, seller is a member.
  const poolInfo = await connection.getAccountInfo(pool, "confirmed");
  if (!poolInfo) {
    throw new Error(`Pool not found at ${pool.toBase58()}. Wrong POOL_SEED_ID?`);
  }
  const memberInfo = await connection.getAccountInfo(memberPda, "confirmed");
  if (!memberInfo) {
    throw new Error(
      `Seller's Member PDA missing for pool ${POOL_SEED_ID}, slot ${SLOT_INDEX}. ` +
        `Run 'POOL_SEED_ID=${POOL_SEED_ID} pnpm devnet:seed-members' first.`,
    );
  }

  // ix: escape_valve_list(price_usdc: u64)
  const data = Buffer.concat([anchorIxDiscriminator("escape_valve_list"), encodeU64LE(PRICE_USDC)]);

  // Account order matches `EscapeValveList` in
  // programs/roundfi-core/src/instructions/escape_valve_list.rs:
  //   1. seller_wallet (signer, mut)
  //   2. config        (PDA, read)
  //   3. pool          (PDA, read)
  //   4. member        (PDA, read)
  //   5. listing       (PDA, init, mut)
  //   6. system_program
  const ix = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: seller.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: memberPda, isSigner: false, isWritable: false },
      { pubkey: listingPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });
  const tx = new Transaction().add(cu, ix);
  const sig = await connection.sendTransaction(tx, [seller], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");

  console.log(`\n✓ escape_valve_list landed`);
  console.log(`    signature: ${sig}\n`);
  console.log(`Solscan (devnet):`);
  console.log(`  list tx    : https://solscan.io/tx/${sig}?cluster=devnet`);
  console.log(`  listing PDA: https://solscan.io/account/${listingPda.toBase58()}?cluster=devnet`);
  console.log(`  pool       : https://solscan.io/account/${pool.toBase58()}?cluster=devnet`);
  console.log("");
}

main().catch((e) => {
  console.error("\n✗ seed-evlist failed:");
  console.error(e);
  process.exit(1);
});

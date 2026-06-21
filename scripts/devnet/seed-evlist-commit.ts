/**
 * Escape Valve commit-reveal listing (#232 MEV mitigation).
 *
 * The anti-front-running variant of `seed-evlist`. Runs both halves of
 * the commit-reveal flow for one slot:
 *
 *   1. `escape_valve_list_commit(commit_hash)` — creates the listing in
 *      `Pending` status storing only `SHA-256(price_le ‖ salt_le)`.
 *      Searchers see a listing exists but can't derive the price.
 *   2. `escape_valve_list_reveal(price_usdc, salt)` — recomputes the
 *      hash, asserts it matches, publishes the price, flips the listing
 *      to `Active`, and arms `buyable_after = now + REVEAL_COOLDOWN_SECS`
 *      (30s). `escape_valve_buy` enforces `now >= buyable_after`, so the
 *      legitimate buyer (who already knows price+salt off-chain) gets a
 *      head-start over any searcher reacting to the now-public price.
 *
 * After this lands, wait ~30s then run `seed-evbuy` (matching
 * EVBUY_SLOT_INDEX) — the buy reverts with `ListingNotBuyableYet` if
 * run inside the cooldown.
 *
 * Eligibility (on commit): pool Active, member not defaulted,
 * `contributions_paid >= pool.current_cycle`, no existing listing for
 * the slot.
 *
 * Salt is cryptographically random (`randomBytes(8)`), non-zero — the
 * reveal handler rejects `salt = 0` (SEV-013).
 *
 * Env:
 *   POOL_SEED_ID         (default 1)
 *   EVLIST_SLOT_INDEX    (default 0 — seller = member-0.json)
 *   EVLIST_PRICE_USDC    (default 2 — sized for a credit=4 demo pool)
 *
 * Manual ix encoding (IDL-free by design — ADR 0002; hand-rolled, not blocked).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";

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
const SLOT_INDEX = Number(process.env.EVLIST_SLOT_INDEX ?? 0);
const PRICE_USDC = process.env.EVLIST_PRICE_USDC
  ? BigInt(Math.round(Number(process.env.EVLIST_PRICE_USDC) * 1e6))
  : 2_000_000n; // 2 USDC default (credit=4 demo pool)
const MEMBER_INDEX_OFFSET = process.env.MEMBER_INDEX_OFFSET
  ? Number(process.env.MEMBER_INDEX_OFFSET)
  : 0;
const KEYPAIRS_DIR = resolve(process.cwd(), "keypairs");
const DEPLOYMENT_CONFIG_PATH = resolve(process.cwd(), "config/program-ids.devnet.json");

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf-8"))));
}

function loadMemberKeypair(slot: number): Keypair {
  const path = resolve(KEYPAIRS_DIR, `member-${slot + MEMBER_INDEX_OFFSET}.json`);
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

function resolveDeployerPubkey(): PublicKey {
  if (existsSync(DEPLOYMENT_CONFIG_PATH)) {
    const cfg = JSON.parse(readFileSync(DEPLOYMENT_CONFIG_PATH, "utf-8")) as { deployer?: string };
    if (cfg.deployer) return new PublicKey(cfg.deployer);
  }
  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  if (!existsSync(walletPath)) throw new Error(`No deployer keypair found at ${walletPath}.`);
  return loadKeypair(walletPath).publicKey;
}

/** Random non-zero u64 salt (SEV-013: salt=0 is rejected on reveal). */
function randomSalt(): bigint {
  let salt = 0n;
  while (salt === 0n) salt = randomBytes(8).readBigUInt64LE(0);
  return salt;
}

/** commit_hash = SHA-256(price_usdc.to_le_bytes() ‖ salt.to_le_bytes()). */
function commitHash(price: bigint, salt: bigint): Buffer {
  const preimage = Buffer.concat([encodeU64LE(price), encodeU64LE(salt)]);
  return createHash("sha256").update(preimage).digest();
}

async function main() {
  const cluster = loadCluster();
  console.log(`\n━━━ RoundFi seed-evlist-commit → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);
  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to seed escape-valve listing on mainnet.");
  }

  const coreProgram = requireProgram(cluster, "core");
  const cfgDeployer = resolveDeployerPubkey();
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

  const salt = randomSalt();
  const hash = commitHash(PRICE_USDC, salt);

  console.log(`→ Pool seed id : ${POOL_SEED_ID}`);
  console.log(`→ Pool PDA     : ${pool.toBase58()}`);
  console.log(`→ Seller slot  : ${SLOT_INDEX} (${seller.publicKey.toBase58()})`);
  console.log(`→ Listing PDA  : ${listingPda.toBase58()}`);
  console.log(`→ Price        : ${(Number(PRICE_USDC) / 1e6).toFixed(6)} USDC`);
  console.log(`→ Salt         : ${salt} (random, non-zero)`);
  console.log(`→ commit_hash  : ${hash.toString("hex")}`);

  const connection = new Connection(cluster.rpcUrl, "confirmed");

  const existing = await connection.getAccountInfo(listingPda, "confirmed");
  if (existing) {
    console.log(
      `\n✓ Listing PDA already exists for slot ${SLOT_INDEX} — skipping. ` +
        `Cancel it (cancel_pending_listing) before re-committing.`,
    );
    return;
  }
  const memberInfo = await connection.getAccountInfo(memberPda, "confirmed");
  if (!memberInfo) {
    throw new Error(
      `Seller Member PDA missing (pool ${POOL_SEED_ID}, slot ${SLOT_INDEX}). Run seed-members first.`,
    );
  }

  // ── Step 1: commit ──────────────────────────────────────────────────
  // Accounts match `EscapeValveListCommit`:
  //   1. seller_wallet (signer, mut)  2. config (read)  3. pool (read)
  //   4. member (read)  5. listing (init, mut)  6. system_program
  const commitIx = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: seller.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: memberPda, isSigner: false, isWritable: false },
      { pubkey: listingPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([anchorIxDiscriminator("escape_valve_list_commit"), hash]),
  });

  console.log(`\nStep 1/2 — escape_valve_list_commit (listing → Pending, price hidden)`);
  const commitTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    commitIx,
  );
  const commitSig = await connection.sendTransaction(commitTx, [seller], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(commitSig, "confirmed");
  console.log(`  ✓ committed — sig ${commitSig}`);

  // ── Step 2: reveal ──────────────────────────────────────────────────
  // Accounts match `EscapeValveListReveal`:
  //   1. seller_wallet (signer, mut)  2. config (read)  3. pool (read)
  //   4. listing (mut)
  const revealIx = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: seller.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: listingPda, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([
      anchorIxDiscriminator("escape_valve_list_reveal"),
      encodeU64LE(PRICE_USDC),
      encodeU64LE(salt),
    ]),
  });

  console.log(`\nStep 2/2 — escape_valve_list_reveal (listing → Active, arms 30s cooldown)`);
  const revealTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    revealIx,
  );
  const revealSig = await connection.sendTransaction(revealTx, [seller], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(revealSig, "confirmed");
  console.log(`  ✓ revealed — sig ${revealSig}`);

  const buyableAt = Math.floor(Date.now() / 1000) + 30;
  console.log(`\n━━━ done — listing Active, buyable in ~30s ━━━\n`);
  console.log(`Next: wait ~30s, then buy (must match the slot):`);
  console.log(
    `  EVBUY_SLOT_INDEX=${SLOT_INDEX} POOL_SEED_ID=${POOL_SEED_ID} pnpm devnet:seed-evbuy`,
  );
  console.log(`  (buyable_after ≈ ${buyableAt}; earlier buys revert with ListingNotBuyableYet)\n`);
  console.log(`Solscan (devnet):`);
  console.log(`  commit tx  : https://solscan.io/tx/${commitSig}?cluster=devnet`);
  console.log(`  reveal tx  : https://solscan.io/tx/${revealSig}?cluster=devnet`);
  console.log(
    `  listing PDA: https://solscan.io/account/${listingPda.toBase58()}?cluster=devnet\n`,
  );
}

main().catch((e) => {
  console.error("\n✗ seed-evlist-commit failed:");
  console.error(e);
  process.exit(1);
});

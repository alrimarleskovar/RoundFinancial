/**
 * Buy a listed Escape Valve position.
 *
 * Calls `roundfi_core.escape_valve_buy(price_usdc)` signed by the
 * buyer (a fresh wallet generated + persisted to
 * `keypairs/evbuy-pool{N}-slot{S}.json`). The handler:
 *   1. Transfers `price_usdc` buyer → seller
 *   2. Closes seller's Member PDA, creates buyer's new Member PDA
 *      with the seller's snapshot (contributions_paid, escrow_balance,
 *      etc. carry over verbatim)
 *   3. Thaws → transfers NFT seller → buyer → re-freezes (3 mpl-core
 *      CPIs signed by the slot's `position_authority` PDA)
 *   4. Closes the listing
 *
 * Pre-flight requirements:
 *   - Listing PDA exists with `status = Active` (run seed-evlist first)
 *   - Buyer wallet has ≥ price USDC in their ATA (script enforces and
 *     prints faucet URL if not)
 *
 * Env:
 *   POOL_SEED_ID         (default 1)
 *   EVBUY_SLOT_INDEX     (default 1 — must match the listing's slot)
 *
 * Manual ix encoding (Anchor IDL gen still blocked).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
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
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { loadCluster, requireProgram } from "../../config/clusters.js";

const POOL_SEED_ID = process.env.POOL_SEED_ID ? BigInt(process.env.POOL_SEED_ID) : 1n;
const SLOT_INDEX = Number(process.env.EVBUY_SLOT_INDEX ?? 1);
const KEYPAIRS_DIR = resolve(process.cwd(), "keypairs");
const DEPLOYMENT_CONFIG_PATH = resolve(process.cwd(), "config/program-ids.devnet.json");
const METAPLEX_CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

// Buyer SOL budget — covers tx fee + new Member PDA rent (~0.003) +
// USDC ATA rent (~0.002) with comfortable buffer.
const BUYER_SOL_BUDGET_LAMPORTS = 80_000_000n; // 0.08 SOL

function loadKeypair(path: string): Keypair {
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

function saveKeypair(path: string, kp: Keypair): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), "utf-8");
}

function loadOrCreateBuyer(poolSeedId: bigint, slotIndex: number): Keypair {
  const path = resolve(KEYPAIRS_DIR, `evbuy-pool${poolSeedId}-slot${slotIndex}.json`);
  if (existsSync(path)) return loadKeypair(path);
  const kp = Keypair.generate();
  saveKeypair(path, kp);
  console.log(`  + generated keypairs/evbuy-pool${poolSeedId}-slot${slotIndex}.json`);
  return kp;
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

/**
 * EscapeValveListing layout (after 8-byte Anchor disc):
 *   off  8: pool          Pubkey  (32)
 *   off 40: seller        Pubkey  (32)
 *   off 72: slot_index    u8      ( 1)
 *   off 73: price_usdc    u64     ( 8)
 *   off 81: status        u8      ( 1)
 *   off 82: listed_at     i64     ( 8)
 *   off 90: bump          u8      ( 1)
 */
interface ListingView {
  seller: PublicKey;
  slotIndex: number;
  priceUsdc: bigint;
  status: number;
}

function decodeListing(data: Buffer): ListingView {
  return {
    seller: new PublicKey(data.subarray(40, 72)),
    slotIndex: data.readUInt8(72),
    priceUsdc: data.readBigUInt64LE(73),
    status: data.readUInt8(81),
  };
}

/**
 * Member layout — we read nft_asset (offset 72) for cross-check.
 */
function decodeMemberNftAsset(data: Buffer): PublicKey {
  return new PublicKey(data.subarray(72, 104));
}

async function ensureBuyerSol(
  connection: Connection,
  deployer: Keypair,
  buyer: PublicKey,
): Promise<void> {
  const balance = await connection.getBalance(buyer, "confirmed");
  if (BigInt(balance) >= BUYER_SOL_BUDGET_LAMPORTS) return;

  const topUp = BUYER_SOL_BUDGET_LAMPORTS - BigInt(balance);
  console.log(
    `  → top-up buyer SOL: has ${(balance / 1e9).toFixed(4)} SOL, ` +
      `transferring ${(Number(topUp) / 1e9).toFixed(4)} from deployer`,
  );
  const ix = SystemProgram.transfer({
    fromPubkey: deployer.publicKey,
    toPubkey: buyer,
    lamports: Number(topUp),
  });
  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [deployer], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");
}

async function ensureBuyerUsdcAta(
  connection: Connection,
  deployer: Keypair,
  buyer: PublicKey,
  usdcMint: PublicKey,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(usdcMint, buyer);
  const ataInfo = await connection.getAccountInfo(ata, "confirmed");
  if (ataInfo) return ata;

  console.log(`  → creating buyer USDC ATA ${ata.toBase58()}`);
  const ix = createAssociatedTokenAccountIdempotentInstruction(
    deployer.publicKey,
    ata,
    buyer,
    usdcMint,
  );
  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [deployer], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");
  return ata;
}

async function main() {
  const cluster = loadCluster();
  console.log(`\n━━━ RoundFi seed-evbuy → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);
  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to seed escape-valve buy on mainnet.");
  }

  const coreProgram = requireProgram(cluster, "core");
  const usdcMint = cluster.usdcMint;

  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  if (!existsSync(walletPath)) {
    throw new Error(`Deployer keypair not found at ${walletPath}.`);
  }
  const deployer = loadKeypair(walletPath);

  let cfgDeployer: PublicKey = deployer.publicKey;
  if (existsSync(DEPLOYMENT_CONFIG_PATH)) {
    const cfg = JSON.parse(readFileSync(DEPLOYMENT_CONFIG_PATH, "utf-8")) as { deployer?: string };
    if (cfg.deployer) cfgDeployer = new PublicKey(cfg.deployer);
  }

  const pool = poolPda(coreProgram, cfgDeployer, POOL_SEED_ID);
  const [protocolConfig] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);
  const [listingPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("listing"), pool.toBuffer(), Uint8Array.of(SLOT_INDEX)],
    coreProgram,
  );

  // Find seller via the on-chain listing.
  const listingInfo = await new Connection(cluster.rpcUrl, "confirmed").getAccountInfo(
    listingPda,
    "confirmed",
  );
  if (!listingInfo) {
    throw new Error(
      `Listing PDA not found at ${listingPda.toBase58()} for pool ${POOL_SEED_ID} slot ${SLOT_INDEX}. ` +
        `Run 'POOL_SEED_ID=${POOL_SEED_ID} EVLIST_SLOT_INDEX=${SLOT_INDEX} pnpm devnet:seed-evlist' first.`,
    );
  }
  const listingView = decodeListing(listingInfo.data);
  if (listingView.status !== 0) {
    throw new Error(`Listing status is ${listingView.status} (not Active). Cannot buy.`);
  }
  const seller = listingView.seller;

  const connection = new Connection(cluster.rpcUrl, "confirmed");

  console.log(`→ Cluster        : ${cluster.name}`);
  console.log(`→ Pool seed id   : ${POOL_SEED_ID}`);
  console.log(`→ Pool PDA       : ${pool.toBase58()}`);
  console.log(`→ Slot           : ${SLOT_INDEX}`);
  console.log(`→ Listing PDA    : ${listingPda.toBase58()}`);
  console.log(`→ Seller (NFT)   : ${seller.toBase58()}`);
  console.log(`→ Listing price  : ${(Number(listingView.priceUsdc) / 1e6).toFixed(6)} USDC`);

  // Buyer keypair (fresh, persisted for idempotency).
  const buyer = loadOrCreateBuyer(POOL_SEED_ID, SLOT_INDEX);
  console.log(`→ Buyer pubkey   : ${buyer.publicKey.toBase58()}`);

  // Resolve seller pieces — we need their USDC ATA + their old Member PDA + the NFT asset.
  const sellerUsdc = getAssociatedTokenAddressSync(usdcMint, seller);
  const [oldMemberPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), pool.toBuffer(), seller.toBuffer()],
    coreProgram,
  );
  const oldMemberInfo = await connection.getAccountInfo(oldMemberPda, "confirmed");
  if (!oldMemberInfo) {
    throw new Error(
      `Seller's Member PDA missing at ${oldMemberPda.toBase58()}. The pool/listing data may be corrupted.`,
    );
  }
  const nftAsset = decodeMemberNftAsset(oldMemberInfo.data);
  console.log(`→ NFT asset      : ${nftAsset.toBase58()}`);

  const [newMemberPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), pool.toBuffer(), buyer.publicKey.toBuffer()],
    coreProgram,
  );
  const [positionAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), pool.toBuffer(), Uint8Array.of(SLOT_INDEX)],
    coreProgram,
  );

  // Idempotency: if buyer already has a Member PDA for this pool, skip.
  const existingNew = await connection.getAccountInfo(newMemberPda, "confirmed");
  if (existingNew) {
    console.log(
      `\n✓ Buyer already owns a Member PDA at ${newMemberPda.toBase58()} — listing was filled.`,
    );
    return;
  }

  // ─── Step 1: ensure buyer SOL + USDC ATA + balance ──────────────────────
  console.log(`\nStep 1/2 — fund buyer wallet:`);
  await ensureBuyerSol(connection, deployer, buyer.publicKey);
  const buyerUsdcAta = await ensureBuyerUsdcAta(connection, deployer, buyer.publicKey, usdcMint);
  let buyerUsdcAcct = await getAccount(connection, buyerUsdcAta, "confirmed");
  console.log(
    `  buyer USDC pre : ${(Number(buyerUsdcAcct.amount) / 1e6).toFixed(6)} USDC ` +
      `(need ${(Number(listingView.priceUsdc) / 1e6).toFixed(6)})`,
  );

  // If buyer still short, top them up from the deployer (cheaper than
  // making the user faucet a third address).
  if (buyerUsdcAcct.amount < listingView.priceUsdc) {
    const gap = listingView.priceUsdc - buyerUsdcAcct.amount;
    const deployerAta = getAssociatedTokenAddressSync(usdcMint, deployer.publicKey);
    const deployerAcct = await getAccount(connection, deployerAta, "confirmed").catch(() => null);
    if (!deployerAcct || deployerAcct.amount < gap) {
      throw new Error(
        `Buyer needs ${(Number(gap) / 1e6).toFixed(6)} more USDC and the deployer can't cover it. ` +
          `Faucet ${(Number(gap) / 1e6).toFixed(2)} USDC to ${buyer.publicKey.toBase58()} via https://faucet.circle.com.`,
      );
    }
    console.log(`  → topping up buyer USDC from deployer: ${(Number(gap) / 1e6).toFixed(6)} USDC`);
    const transferIx = createTransferInstruction(
      deployerAta,
      buyerUsdcAta,
      deployer.publicKey,
      Number(gap),
    );
    const transferTx = new Transaction().add(transferIx);
    const transferSig = await connection.sendTransaction(transferTx, [deployer], {
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(transferSig, "confirmed");
    buyerUsdcAcct = await getAccount(connection, buyerUsdcAta, "confirmed");
    console.log(`  buyer USDC post: ${(Number(buyerUsdcAcct.amount) / 1e6).toFixed(6)} USDC`);
  }

  // ─── Step 2: escape_valve_buy ───────────────────────────────────────────
  console.log(`\nStep 2/2 — escape_valve_buy(${(Number(listingView.priceUsdc) / 1e6).toFixed(2)})`);
  const data = Buffer.concat([
    anchorIxDiscriminator("escape_valve_buy"),
    encodeU64LE(listingView.priceUsdc),
  ]);

  // Account order matches `EscapeValveBuy` in
  // programs/roundfi-core/src/instructions/escape_valve_buy.rs:
  //   1.  buyer_wallet        (signer, mut)
  //   2.  seller_wallet       (UncheckedAccount, mut, receives lamports)
  //   3.  config              (PDA, read)
  //   4.  pool                (PDA, read)
  //   5.  listing             (PDA, mut, close=seller_wallet)
  //   6.  old_member          (PDA, mut, close=seller_wallet)
  //   7.  new_member          (PDA, init)
  //   8.  usdc_mint           (read)
  //   9.  buyer_usdc          (mut, TokenAccount)
  //  10.  seller_usdc         (mut, TokenAccount)
  //  11.  nft_asset           (UncheckedAccount, mut)
  //  12.  position_authority  (PDA, read)
  //  13.  metaplex_core       (UncheckedAccount, read; pinned to config.metaplex_core)
  //  14.  token_program
  //  15.  system_program
  const ix = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
      { pubkey: seller, isSigner: false, isWritable: true },
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: listingPda, isSigner: false, isWritable: true },
      { pubkey: oldMemberPda, isSigner: false, isWritable: true },
      { pubkey: newMemberPda, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: buyerUsdcAta, isSigner: false, isWritable: true },
      { pubkey: sellerUsdc, isSigner: false, isWritable: true },
      { pubkey: nftAsset, isSigner: false, isWritable: true },
      { pubkey: positionAuthority, isSigner: false, isWritable: false },
      { pubkey: METAPLEX_CORE_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  // Heavy ix — 3 Metaplex Core CPIs (UpdatePlugin thaw + TransferV1 +
  // UpdatePlugin freeze) plus close-old / init-new / SPL transfer.
  const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 });
  const tx = new Transaction().add(cu, ix);
  void ASSOCIATED_TOKEN_PROGRAM_ID;
  const sig = await connection.sendTransaction(tx, [buyer], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");

  console.log(`  ✓ escape_valve_buy landed`);
  console.log(`    signature: ${sig}`);

  const buyerUsdcPost = await getAccount(connection, buyerUsdcAta, "confirmed");
  const sellerUsdcInfo = await getAccount(connection, sellerUsdc, "confirmed");
  console.log(
    `\n  buyer USDC : ${(Number(buyerUsdcAcct.amount) / 1e6).toFixed(6)} → ` +
      `${(Number(buyerUsdcPost.amount) / 1e6).toFixed(6)}`,
  );
  console.log(`  seller USDC: ${(Number(sellerUsdcInfo.amount) / 1e6).toFixed(6)} (post)`);

  console.log(`\n━━━ done ━━━\n`);
  console.log(`Solscan (devnet):`);
  console.log(`  buy tx        : https://solscan.io/tx/${sig}?cluster=devnet`);
  console.log(`  pool          : https://solscan.io/account/${pool.toBase58()}?cluster=devnet`);
  console.log(
    `  new Member PDA: https://solscan.io/account/${newMemberPda.toBase58()}?cluster=devnet`,
  );
  console.log(`  NFT asset     : https://solscan.io/account/${nftAsset.toBase58()}?cluster=devnet`);
  console.log("");
}

main().catch((e) => {
  console.error("\n✗ seed-evbuy failed:");
  console.error(e);
  process.exit(1);
});

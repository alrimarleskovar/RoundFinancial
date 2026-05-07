/**
 * Seed a demo pool on Devnet via `roundfi_core.create_pool(...)`.
 *
 * This script is the create_pool half of the original "Step 4/8 seed"
 * stub — full join_pool seeding (with NFT mints + USDC stakes per
 * member) is staged behind this. Reasons to split:
 *
 *   1. create_pool has no SPL token movement requirement → idempotent
 *      and cheap to run (~0.04 SOL for the four ATA inits).
 *   2. join_pool requires per-member USDC stake (Lv2 = 30% of credit),
 *      which means Circle's devnet USDC faucet hits + SPL transfers.
 *      Cleaner as a separate `seed-members.ts` script.
 *   3. With just create_pool, Solscan already shows the Pool PDA + the
 *      three vault ATAs — strong evidence the protocol can mutate
 *      state, not just init singletons.
 *
 * Manual instruction encoding (no Anchor SDK runtime — IDL gen is
 * blocked on the toolchain bump documented in `init-protocol.ts`).
 *
 * Pool params are sized for an end-to-end demo:
 *   - 3 members target (smallest viable)
 *   - $30 credit / 3 cycles → $10 installment
 *   - 60s cycle duration (MIN_CYCLE_DURATION on the chain side)
 *   - Lv2 stake @ 30% = $9 per member → fits in one Circle faucet hit
 *
 * Idempotent: derives the Pool PDA with `seed_id = 1` against the
 * deployer authority. Re-running prints "skipping" if the PDA already
 * exists. Bump `POOL_SEED_ID` to create additional pools.
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
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { loadCluster, requireProgram } from "../../config/clusters.js";

// Demo pool sizing — see file header for rationale.
const POOL_SEED_ID = 1n;
const MEMBERS_TARGET = 3;
const CREDIT_AMOUNT = 30_000_000n; // 30 USDC (×1e6 base units)
const INSTALLMENT_AMOUNT = 10_000_000n; // 10 USDC = credit / cycles
const CYCLES_TOTAL = 3;
const CYCLE_DURATION = 60n; // seconds — MIN_CYCLE_DURATION on chain
const ESCROW_RELEASE_BPS = 2_500; // 25% per checkpoint (default)

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

function encodeU64LE(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value, 0);
  return buf;
}

function encodeI64LE(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(value, 0);
  return buf;
}

function encodeU16LE(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value, 0);
  return buf;
}

function encodeU8(value: number): Buffer {
  return Buffer.from([value & 0xff]);
}

async function callCreatePool(
  connection: Connection,
  authority: Keypair,
  coreProgram: PublicKey,
  yieldAdapter: PublicKey,
  usdcMint: PublicKey,
): Promise<{ signature: string; poolPda: PublicKey } | { skipped: true; poolPda: PublicKey }> {
  // Pool PDA seeds = [SEED_POOL, authority, seed_id_le].
  const seedIdLe = Buffer.alloc(8);
  seedIdLe.writeBigUInt64LE(POOL_SEED_ID, 0);
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), authority.publicKey.toBuffer(), seedIdLe],
    coreProgram,
  );

  const existing = await connection.getAccountInfo(poolPda, "confirmed");
  if (existing) {
    console.log(`→ Pool already exists at ${poolPda.toBase58()} — skipping`);
    return { skipped: true, poolPda };
  }

  const [protocolConfig] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);
  const [escrowAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), poolPda.toBuffer()],
    coreProgram,
  );
  const [solidarityAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("solidarity"), poolPda.toBuffer()],
    coreProgram,
  );
  const [yieldAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("yield"), poolPda.toBuffer()],
    coreProgram,
  );

  // ATAs for the four token accounts. Authority is the PDA, mint is USDC.
  const poolUsdcVault = await deriveAta(usdcMint, poolPda);
  const escrowVault = await deriveAta(usdcMint, escrowAuthority);
  const solidarityVault = await deriveAta(usdcMint, solidarityAuthority);
  const yieldVault = await deriveAta(usdcMint, yieldAuthority);

  // ix.data = [discriminator (8) | u64 seed_id | u8 members_target |
  //            u64 installment | u64 credit | u8 cycles_total |
  //            i64 cycle_duration | u16 escrow_release_bps]
  const data = Buffer.concat([
    anchorIxDiscriminator("create_pool"),
    encodeU64LE(POOL_SEED_ID),
    encodeU8(MEMBERS_TARGET),
    encodeU64LE(INSTALLMENT_AMOUNT),
    encodeU64LE(CREDIT_AMOUNT),
    encodeU8(CYCLES_TOTAL),
    encodeI64LE(CYCLE_DURATION),
    encodeU16LE(ESCROW_RELEASE_BPS),
  ]);

  // Account list — order MUST match `CreatePool` in
  // programs/roundfi-core/src/instructions/create_pool.rs:
  //   1. authority                  (signer, mut)
  //   2. config                     (PDA, read)
  //   3. pool                       (PDA, mut, init)
  //   4. usdc_mint                  (read)
  //   5. yield_adapter              (executable program, read)
  //   6. escrow_vault_authority     (PDA, read)
  //   7. solidarity_vault_authority (PDA, read)
  //   8. yield_vault_authority      (PDA, read)
  //   9. pool_usdc_vault            (mut, init ATA)
  //  10. escrow_vault               (mut, init ATA)
  //  11. solidarity_vault           (mut, init ATA)
  //  12. yield_vault                (mut, init ATA)
  //  13. token_program              (read)
  //  14. associated_token_program   (read)
  //  15. system_program             (read)
  //  16. rent sysvar                (read)
  const ix = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: yieldAdapter, isSigner: false, isWritable: false },
      { pubkey: escrowAuthority, isSigner: false, isWritable: false },
      { pubkey: solidarityAuthority, isSigner: false, isWritable: false },
      { pubkey: yieldAuthority, isSigner: false, isWritable: false },
      { pubkey: poolUsdcVault, isSigner: false, isWritable: true },
      { pubkey: escrowVault, isSigner: false, isWritable: true },
      { pubkey: solidarityVault, isSigner: false, isWritable: true },
      { pubkey: yieldVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });

  // Bump compute budget — create_pool inits 4 ATAs in one tx (~270k CU).
  const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
  const tx = new Transaction().add(cu, ix);
  const signature = await connection.sendTransaction(tx, [authority], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");
  return { signature, poolPda };
}

async function deriveAta(mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
  // Mirrors `getAssociatedTokenAddressSync` but inline so we don't have
  // to thread `allowOwnerOffCurve` for PDA-owned ATAs.
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

async function main() {
  const cluster = loadCluster();
  console.log(`\n━━━ RoundFi seed-pool → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);

  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to seed on mainnet — use a deliberate process.");
  }

  const coreProgram = requireProgram(cluster, "core");
  const yieldAdapter = requireProgram(cluster, "yieldMock");
  const usdcMint = cluster.usdcMint;

  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  const authority = loadKeypair(walletPath);

  console.log(`→ Cluster      : ${cluster.name}`);
  console.log(`→ Authority    : ${authority.publicKey.toBase58()}`);
  console.log(`→ Core program : ${coreProgram.toBase58()}`);
  console.log(`→ Yield adapter: ${yieldAdapter.toBase58()}`);
  console.log(`→ USDC mint    : ${usdcMint.toBase58()}\n`);

  console.log(`Pool params (demo):`);
  console.log(`  members_target    : ${MEMBERS_TARGET}`);
  console.log(`  credit_amount     : ${(Number(CREDIT_AMOUNT) / 1e6).toFixed(2)} USDC`);
  console.log(`  installment_amount: ${(Number(INSTALLMENT_AMOUNT) / 1e6).toFixed(2)} USDC`);
  console.log(`  cycles_total      : ${CYCLES_TOTAL}`);
  console.log(`  cycle_duration    : ${CYCLE_DURATION}s`);
  console.log(`  escrow_release_bps: ${ESCROW_RELEASE_BPS}\n`);

  const connection = new Connection(cluster.rpcUrl, "confirmed");

  const balance = await connection.getBalance(authority.publicKey);
  console.log(`→ Authority balance: ${(balance / 1e9).toFixed(4)} SOL\n`);
  if (balance < 0.05 * 1e9) {
    throw new Error(
      `Insufficient SOL on authority. Need ≥ 0.05 SOL for create_pool ` +
        `(four ATA inits land ~0.04 SOL of rent + fee).`,
    );
  }

  console.log(`→ calling roundfi_core.create_pool(...)`);
  const result = await callCreatePool(connection, authority, coreProgram, yieldAdapter, usdcMint);
  if ("skipped" in result) {
    console.log(`  Pool PDA: ${result.poolPda.toBase58()} (existing)\n`);
  } else {
    console.log(`✓ create_pool confirmed`);
    console.log(`  Pool PDA  : ${result.poolPda.toBase58()}`);
    console.log(`  signature : ${result.signature}\n`);
  }

  console.log(`━━━ done ━━━\n`);
  console.log(`Solscan (devnet):`);
  console.log(`  https://solscan.io/account/${result.poolPda.toBase58()}?cluster=devnet`);
  if (!("skipped" in result)) {
    console.log(`  https://solscan.io/tx/${result.signature}?cluster=devnet`);
  }
  console.log(`\nNext step: join the pool via the (TBD) seed-members.ts script —`);
  console.log(`           creates ${MEMBERS_TARGET} member wallets, faucets USDC, and runs`);
  console.log(`           init_profile + join_pool for each. Each member needs`);
  console.log(`           ${(Number(CREDIT_AMOUNT) / 1e6) * 0.3} USDC at Lv2 (30% stake).\n`);
}

main().catch((e) => {
  console.error("\n✗ seed-pool failed:");
  console.error(e);
  process.exit(1);
});

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
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { loadCluster, requireProgram } from "../../config/clusters.js";

// Demo pool sizing — see file header for rationale.
// Override via env: POOL_SEED_ID, CYCLE_DURATION_SEC.
const POOL_SEED_ID = process.env.POOL_SEED_ID ? BigInt(process.env.POOL_SEED_ID) : 1n;
const MEMBERS_TARGET = 3;
const CREDIT_AMOUNT = 30_000_000n; // 30 USDC (×1e6 base units)
const INSTALLMENT_AMOUNT = 10_000_000n; // 10 USDC = credit / cycles
const CYCLES_TOTAL = 3;
const CYCLE_DURATION = process.env.CYCLE_DURATION_SEC
  ? BigInt(process.env.CYCLE_DURATION_SEC)
  : 60n; // default 60s — MIN_CYCLE_DURATION on chain
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

  // Account list — order matches `CreatePool` in
  // programs/roundfi-core/src/instructions/create_pool.rs (post-split):
  //   1. authority                  (signer, mut)
  //   2. config                     (PDA, read)
  //   3. pool                       (PDA, mut, init)
  //   4. usdc_mint                  (read)
  //   5. yield_adapter              (executable program, read)
  //   6. escrow_vault_authority     (PDA, read)
  //   7. solidarity_vault_authority (PDA, read)
  //   8. yield_vault_authority      (PDA, read)
  //   9. system_program             (read)
  // Vault ATAs are created in a follow-up `init_pool_vaults` ix —
  // see header for the stack-frame split rationale.
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
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  // 200k CU is enough for create_pool now (only 1 init).
  const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 });
  const tx = new Transaction().add(cu, ix);
  const signature = await connection.sendTransaction(tx, [authority], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");
  return { signature, poolPda };
}

async function callInitPoolVaults(
  connection: Connection,
  authority: Keypair,
  coreProgram: PublicKey,
  usdcMint: PublicKey,
  poolPda: PublicKey,
): Promise<{ signature: string } | { skipped: true }> {
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

  const poolUsdcVault = await deriveAta(usdcMint, poolPda);
  const escrowVault = await deriveAta(usdcMint, escrowAuthority);
  const solidarityVault = await deriveAta(usdcMint, solidarityAuthority);
  const yieldVault = await deriveAta(usdcMint, yieldAuthority);

  // Idempotency check: if the four ATAs already exist with the right
  // mint + authority, skip. (`create_idempotent` on chain does the same
  // — this is just to keep the script output legible on retries.)
  const allExist = await Promise.all(
    [poolUsdcVault, escrowVault, solidarityVault, yieldVault].map((a) =>
      connection.getAccountInfo(a, "confirmed"),
    ),
  );
  if (allExist.every((info) => info != null)) {
    console.log(`→ all four vault ATAs already exist — skipping init_pool_vaults`);
    return { skipped: true };
  }

  // Account list — order matches `InitPoolVaults` in
  // programs/roundfi-core/src/instructions/init_pool_vaults.rs:
  //   1. authority                  (signer, mut)
  //   2. config                     (PDA, mut — TVL caps committed total)
  //   3. pool                       (PDA, read)
  //   4. usdc_mint                  (read)
  //   5. escrow_vault_authority     (PDA, read)
  //   6. solidarity_vault_authority (PDA, read)
  //   7. yield_vault_authority      (PDA, read)
  //   8. pool_usdc_vault            (mut)
  //   9. escrow_vault               (mut)
  //  10. solidarity_vault           (mut)
  //  11. yield_vault                (mut)
  //  12. token_program              (read)
  //  13. associated_token_program   (read)
  //  14. system_program             (read)
  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    coreProgram,
  );
  const ix = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocolConfig, isSigner: false, isWritable: true },
      { pubkey: poolPda, isSigner: false, isWritable: false },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
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
    ],
    data: anchorIxDiscriminator("init_pool_vaults"),
  });

  // 4 sequential SPL associated_token CPIs ~80k CU each at most.
  const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
  const tx = new Transaction().add(cu, ix);
  const signature = await connection.sendTransaction(tx, [authority], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");
  return { signature };
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

  // Step 1 — create the Pool PDA + record vault-authority bumps.
  console.log(`→ calling roundfi_core.create_pool(...)`);
  const poolResult = await callCreatePool(
    connection,
    authority,
    coreProgram,
    yieldAdapter,
    usdcMint,
  );
  if ("skipped" in poolResult) {
    console.log(`  Pool PDA: ${poolResult.poolPda.toBase58()} (existing)\n`);
  } else {
    console.log(`✓ create_pool confirmed`);
    console.log(`  Pool PDA  : ${poolResult.poolPda.toBase58()}`);
    console.log(`  signature : ${poolResult.signature}\n`);
  }

  // Step 2 — initialize the four USDC vault ATAs via sequential CPIs.
  // (Split out of create_pool to keep stack frame depth manageable on
  // Solana 3.x — see init_pool_vaults.rs header.)
  console.log(`→ calling roundfi_core.init_pool_vaults(...)`);
  const vaultsResult = await callInitPoolVaults(
    connection,
    authority,
    coreProgram,
    usdcMint,
    poolResult.poolPda,
  );
  if ("skipped" in vaultsResult) {
    console.log(`  (4 vault ATAs already initialized)\n`);
  } else {
    console.log(`✓ init_pool_vaults confirmed`);
    console.log(`  signature : ${vaultsResult.signature}\n`);
  }

  console.log(`━━━ done ━━━\n`);
  console.log(`Solscan (devnet):`);
  console.log(`  https://solscan.io/account/${poolResult.poolPda.toBase58()}?cluster=devnet`);
  if (!("skipped" in poolResult)) {
    console.log(`  https://solscan.io/tx/${poolResult.signature}?cluster=devnet`);
  }
  if (!("skipped" in vaultsResult)) {
    console.log(`  https://solscan.io/tx/${vaultsResult.signature}?cluster=devnet`);
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

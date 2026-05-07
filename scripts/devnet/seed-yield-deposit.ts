/**
 * Move idle USDC from the pool float into the yield_mock vault.
 *
 * 1. Calls `roundfi_core.deposit_idle_to_yield(amount)` — the pool PDA
 *    signs an SPL transfer from `pool_usdc_vault` → `yield_vault`.
 *    `pool.yield_principal_deposited` is incremented by the actual delta.
 * 2. (Optional) Pre-funds the yield vault with `YIELD_PREFUND_USDC` extra
 *    USDC from the deployer's ATA — simulates yield accruing inside the
 *    adapter so a subsequent `harvest_yield` call has a realized surplus
 *    to distribute. yield_mock is a stub adapter (no time-based accrual);
 *    this pre-fund stands in for what a real adapter would have earned.
 *
 * Pool state requires `status = Active` and `yield_adapter` set
 * (configured at create_pool time). Run after at least one cycle's
 * contributes have landed so the pool has float to spare.
 *
 * Env:
 *   POOL_SEED_ID            (default 1)
 *   YIELD_DEPOSIT_USDC      (default 5)
 *   YIELD_PREFUND_USDC      (default 0.5; set 0 to skip pre-fund)
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
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { loadCluster, requireProgram } from "../../config/clusters.js";

const POOL_SEED_ID = process.env.POOL_SEED_ID ? BigInt(process.env.POOL_SEED_ID) : 1n;
const DEPLOYMENT_CONFIG_PATH = resolve(process.cwd(), "config/program-ids.devnet.json");

const DEPOSIT_USDC = process.env.YIELD_DEPOSIT_USDC
  ? BigInt(Math.round(Number(process.env.YIELD_DEPOSIT_USDC) * 1e6))
  : 5_000_000n; // 5 USDC default
const PREFUND_USDC = process.env.YIELD_PREFUND_USDC
  ? BigInt(Math.round(Number(process.env.YIELD_PREFUND_USDC) * 1e6))
  : 500_000n; // 0.5 USDC default — simulates ~10% APY over a few weeks on $5

function loadKeypair(path: string): Keypair {
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
  console.log(`\n━━━ RoundFi seed-yield-deposit → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);
  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to seed yield deposit on mainnet.");
  }

  const coreProgram = requireProgram(cluster, "core");
  const yieldMock = requireProgram(cluster, "yieldMock");
  const usdcMint = cluster.usdcMint;

  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  if (!existsSync(walletPath)) {
    throw new Error(`Deployer keypair not found at ${walletPath}.`);
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

  const [protocolConfig] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);
  const poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, pool, true);
  const [yieldStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("yield-state"), pool.toBuffer()],
    yieldMock,
  );
  const yieldVault = getAssociatedTokenAddressSync(usdcMint, yieldStatePda, true);

  console.log(`→ Cluster       : ${cluster.name}`);
  console.log(`→ Deployer      : ${deployer.publicKey.toBase58()}`);
  console.log(`→ Pool seed id  : ${POOL_SEED_ID}`);
  console.log(`→ Pool PDA      : ${pool.toBase58()}`);
  console.log(`→ Yield state   : ${yieldStatePda.toBase58()}`);
  console.log(`→ Deposit       : ${(Number(DEPOSIT_USDC) / 1e6).toFixed(6)} USDC`);
  console.log(`→ Pre-fund APY  : ${(Number(PREFUND_USDC) / 1e6).toFixed(6)} USDC\n`);

  const connection = new Connection(cluster.rpcUrl, "confirmed");

  // Sanity reads
  const yieldStateInfo = await connection.getAccountInfo(yieldStatePda, "confirmed");
  if (!yieldStateInfo) {
    throw new Error(
      `Yield state PDA missing for pool ${POOL_SEED_ID}. Run 'pnpm devnet:seed-yield-init' first.`,
    );
  }
  const poolVaultBefore = await getAccount(connection, poolUsdcVault, "confirmed");
  console.log(`→ Pool float pre : ${(Number(poolVaultBefore.amount) / 1e6).toFixed(6)} USDC`);

  // ─── Step 1: deposit_idle_to_yield ───────────────────────────────────────
  console.log(`\nStep 1/2 — deposit_idle_to_yield(${(Number(DEPOSIT_USDC) / 1e6).toFixed(2)})`);
  const depositData = Buffer.concat([
    anchorIxDiscriminator("deposit_idle_to_yield"),
    encodeU64LE(DEPOSIT_USDC),
  ]);

  // Account order — Box<>'d in #-yield-pr but order unchanged:
  //   1. caller (signer)
  //   2. config
  //   3. pool
  //   4. usdc_mint
  //   5. pool_usdc_vault
  //   6. yield_vault (UncheckedAccount, mut)
  //   7. yield_adapter_program (= yield_mock program ID)
  //   8. token_program
  //   remaining_accounts: [yield_mock state PDA] (the adapter expects this
  //   in the 5th slot of its own Deposit struct).
  const depositIx = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: poolUsdcVault, isSigner: false, isWritable: true },
      { pubkey: yieldVault, isSigner: false, isWritable: true },
      { pubkey: yieldMock, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      // remaining: yield_mock state PDA (writable for tracked_principal update)
      { pubkey: yieldStatePda, isSigner: false, isWritable: true },
    ],
    data: depositData,
  });

  const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
  const depositTx = new Transaction().add(cu, depositIx);
  const depositSig = await connection.sendTransaction(depositTx, [deployer], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(depositSig, "confirmed");
  console.log(`  ✓ deposit landed`);
  console.log(`    signature: ${depositSig}`);

  const poolVaultAfterDeposit = await getAccount(connection, poolUsdcVault, "confirmed");
  const yieldVaultAfterDeposit = await getAccount(connection, yieldVault, "confirmed");
  console.log(
    `  pool float : ${(Number(poolVaultBefore.amount) / 1e6).toFixed(6)} → ` +
      `${(Number(poolVaultAfterDeposit.amount) / 1e6).toFixed(6)}`,
  );
  console.log(
    `  yield vault: 0.000000 → ${(Number(yieldVaultAfterDeposit.amount) / 1e6).toFixed(6)}`,
  );

  // ─── Step 2: pre-fund the yield vault to simulate APY ──────────────────
  if (PREFUND_USDC > 0n) {
    console.log(
      `\nStep 2/2 — pre-fund yield vault with ${(Number(PREFUND_USDC) / 1e6).toFixed(2)} USDC ` +
        `(simulates accrued yield)`,
    );
    const deployerAta = getAssociatedTokenAddressSync(usdcMint, deployer.publicKey);
    const deployerAtaInfo = await getAccount(connection, deployerAta, "confirmed").catch(
      () => null,
    );
    if (!deployerAtaInfo) {
      throw new Error(
        `Deployer USDC ATA missing. Faucet to ${deployer.publicKey.toBase58()} first.`,
      );
    }
    if (deployerAtaInfo.amount < PREFUND_USDC) {
      throw new Error(
        `Deployer has ${(Number(deployerAtaInfo.amount) / 1e6).toFixed(2)} USDC; need ` +
          `${(Number(PREFUND_USDC) / 1e6).toFixed(2)} for pre-fund. Faucet more first.`,
      );
    }

    const prefundIx = createTransferInstruction(
      deployerAta,
      yieldVault,
      deployer.publicKey,
      Number(PREFUND_USDC),
    );
    const prefundTx = new Transaction().add(prefundIx);
    const prefundSig = await connection.sendTransaction(prefundTx, [deployer], {
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(prefundSig, "confirmed");
    console.log(`  ✓ pre-fund landed`);
    console.log(`    signature: ${prefundSig}`);

    const yieldVaultFinal = await getAccount(connection, yieldVault, "confirmed");
    console.log(
      `  yield vault: ${(Number(yieldVaultAfterDeposit.amount) / 1e6).toFixed(6)} → ` +
        `${(Number(yieldVaultFinal.amount) / 1e6).toFixed(6)} ` +
        `(tracked_principal stays at ${(Number(DEPOSIT_USDC) / 1e6).toFixed(6)} ⇒ ` +
        `harvest will realize ${(Number(PREFUND_USDC) / 1e6).toFixed(6)})`,
    );

    console.log(`\n━━━ done ━━━\n`);
    console.log(`Solscan (devnet):`);
    console.log(`  pool        : https://solscan.io/account/${pool.toBase58()}?cluster=devnet`);
    console.log(`  deposit tx  : https://solscan.io/tx/${depositSig}?cluster=devnet`);
    console.log(`  pre-fund tx : https://solscan.io/tx/${prefundSig}?cluster=devnet`);
    console.log(
      `  yield vault : https://solscan.io/account/${yieldVault.toBase58()}?cluster=devnet`,
    );
    console.log("");
    return;
  }

  console.log(`\n━━━ done ━━━\n`);
  console.log(`Solscan (devnet):`);
  console.log(`  pool        : https://solscan.io/account/${pool.toBase58()}?cluster=devnet`);
  console.log(`  deposit tx  : https://solscan.io/tx/${depositSig}?cluster=devnet`);
  console.log(`  yield vault : https://solscan.io/account/${yieldVault.toBase58()}?cluster=devnet`);
  console.log("");
}

main().catch((e) => {
  console.error("\n✗ seed-yield-deposit failed:");
  console.error(e);
  process.exit(1);
});

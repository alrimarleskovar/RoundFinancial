/**
 * Realize accrued yield from the yield_mock adapter and run it through
 * the PDF-canonical waterfall:
 *   1. Protocol fee   → treasury_usdc (FIRST on gross)
 *   2. Guarantee Fund → logical earmark on `pool.guarantee_fund_balance`
 *   3. LP slice       → logical earmark on `pool.lp_distribution_balance`
 *   4. Participants   → residual stays in `pool_usdc_vault` ("prêmio de paciência")
 *
 * This driver assumes:
 *   - The yield_mock state PDA is initialized for this pool (run
 *     seed-yield-init first).
 *   - There's surplus inside the yield vault above tracked_principal
 *     (run seed-yield-deposit with a non-zero pre-fund first).
 *
 * Pool state requires `status = Active` and `yield_adapter` set.
 *
 * Env:
 *   POOL_SEED_ID         (default 1)
 *   YIELD_LP_SHARE_BPS   (default 6500 = 65% — DEFAULT_LP_SHARE_BPS)
 *   YIELD_MIN_REALIZED   (default 0 — opt out of slippage guard)
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
import { TOKEN_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { loadCluster, requireProgram } from "../../config/clusters.js";

const POOL_SEED_ID = process.env.POOL_SEED_ID ? BigInt(process.env.POOL_SEED_ID) : 1n;
const DEPLOYMENT_CONFIG_PATH = resolve(process.cwd(), "config/program-ids.devnet.json");
const LP_SHARE_BPS = Number(process.env.YIELD_LP_SHARE_BPS ?? 6_500);
const MIN_REALIZED_USDC = process.env.YIELD_MIN_REALIZED
  ? BigInt(Math.round(Number(process.env.YIELD_MIN_REALIZED) * 1e6))
  : 0n;

function loadKeypair(path: string): Keypair {
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

function anchorIxDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function encodeU16LE(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value, 0);
  return buf;
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
  console.log(`\n━━━ RoundFi seed-yield-harvest → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);
  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to harvest yield on mainnet.");
  }

  const coreProgram = requireProgram(cluster, "core");
  const yieldMock = requireProgram(cluster, "yieldMock");
  const usdcMint = cluster.usdcMint;

  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  if (!existsSync(walletPath)) {
    throw new Error(`Deployer keypair not found at ${walletPath}.`);
  }
  const deployer = loadKeypair(walletPath);

  let cfgDeployer: PublicKey = deployer.publicKey;
  let treasuryAta: PublicKey | null = null;
  if (existsSync(DEPLOYMENT_CONFIG_PATH)) {
    const cfg = JSON.parse(readFileSync(DEPLOYMENT_CONFIG_PATH, "utf-8")) as {
      deployer?: string;
      initialized?: { treasuryAta?: string };
    };
    if (cfg.deployer) cfgDeployer = new PublicKey(cfg.deployer);
    if (cfg.initialized?.treasuryAta) treasuryAta = new PublicKey(cfg.initialized.treasuryAta);
  }
  if (!treasuryAta) {
    // Treasury ATA defaults to deployer's USDC ATA (config.treasury == deployer
    // for the bootstrap deploy — see init-protocol.ts).
    treasuryAta = getAssociatedTokenAddressSync(usdcMint, cfgDeployer);
  }

  const pool = poolPda(coreProgram, cfgDeployer, POOL_SEED_ID);
  const [protocolConfig] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);
  const poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, pool, true);
  const [yieldStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("yield-state"), pool.toBuffer()],
    yieldMock,
  );
  const yieldVault = getAssociatedTokenAddressSync(usdcMint, yieldStatePda, true);

  console.log(`→ Cluster        : ${cluster.name}`);
  console.log(`→ Pool seed id   : ${POOL_SEED_ID}`);
  console.log(`→ Pool PDA       : ${pool.toBase58()}`);
  console.log(`→ Yield state    : ${yieldStatePda.toBase58()}`);
  console.log(`→ Treasury ATA   : ${treasuryAta.toBase58()}`);
  console.log(`→ lp_share_bps   : ${LP_SHARE_BPS} (${(LP_SHARE_BPS / 100).toFixed(2)}%)`);
  console.log(`→ min_realized   : ${(Number(MIN_REALIZED_USDC) / 1e6).toFixed(6)} USDC\n`);

  const connection = new Connection(cluster.rpcUrl, "confirmed");

  // Pre-flight reads — show the realized-yield expectation before sending.
  const yieldStateInfo = await connection.getAccountInfo(yieldStatePda, "confirmed");
  if (!yieldStateInfo) {
    throw new Error(
      `Yield state PDA missing for pool ${POOL_SEED_ID}. Run 'pnpm devnet:seed-yield-init' first.`,
    );
  }
  // YieldVaultState layout: 8 disc + 32 pool + 32 mint + 32 vault + 8 tracked_principal + 1 bump
  const trackedPrincipal = yieldStateInfo.data.readBigUInt64LE(8 + 32 + 32 + 32);
  const yieldVaultAcct = await getAccount(connection, yieldVault, "confirmed");
  const expectedRealized =
    yieldVaultAcct.amount > trackedPrincipal ? yieldVaultAcct.amount - trackedPrincipal : 0n;
  const poolVaultBefore = await getAccount(connection, poolUsdcVault, "confirmed");
  console.log(`→ tracked_principal  : ${(Number(trackedPrincipal) / 1e6).toFixed(6)} USDC`);
  console.log(`→ yield_vault.amount : ${(Number(yieldVaultAcct.amount) / 1e6).toFixed(6)} USDC`);
  console.log(`→ expected realized  : ${(Number(expectedRealized) / 1e6).toFixed(6)} USDC`);
  console.log(`→ pool float pre     : ${(Number(poolVaultBefore.amount) / 1e6).toFixed(6)} USDC\n`);
  if (expectedRealized === 0n && MIN_REALIZED_USDC === 0n) {
    console.log(
      `⚠  Yield vault has no surplus and min_realized=0; harvest will short-circuit. ` +
        `Set YIELD_PREFUND_USDC > 0 in seed-yield-deposit, or accept the no-op.`,
    );
  }

  // ix: harvest_yield(lp_share_bps: u16, min_realized_usdc: u64)
  const data = Buffer.concat([
    anchorIxDiscriminator("harvest_yield"),
    encodeU16LE(LP_SHARE_BPS),
    encodeU64LE(MIN_REALIZED_USDC),
  ]);

  // Account order — Box<>'d struct, order unchanged:
  //   1. caller (signer)
  //   2. config
  //   3. pool
  //   4. usdc_mint
  //   5. pool_usdc_vault
  //   6. treasury_usdc
  //   7. yield_vault (UncheckedAccount)
  //   8. yield_adapter_program
  //   9. token_program
  //   remaining: yield_mock state PDA
  const ix = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: poolUsdcVault, isSigner: false, isWritable: true },
      { pubkey: treasuryAta, isSigner: false, isWritable: true },
      { pubkey: yieldVault, isSigner: false, isWritable: true },
      { pubkey: yieldMock, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      // remaining: yield_mock state PDA (read-only — the adapter's harvest
      // doesn't mutate state; only the SPL transfer does the work).
      { pubkey: yieldStatePda, isSigner: false, isWritable: false },
    ],
    data,
  });

  const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
  const tx = new Transaction().add(cu, ix);
  const sig = await connection.sendTransaction(tx, [deployer], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");

  // Post-flight: read pool_usdc_vault delta to see the actual realized.
  const poolVaultAfter = await getAccount(connection, poolUsdcVault, "confirmed");
  const realizedActual =
    poolVaultAfter.amount > poolVaultBefore.amount
      ? poolVaultAfter.amount - poolVaultBefore.amount
      : 0n;
  console.log(`✓ harvest_yield landed`);
  console.log(`    signature: ${sig}\n`);
  console.log(
    `→ pool float : ${(Number(poolVaultBefore.amount) / 1e6).toFixed(6)} → ` +
      `${(Number(poolVaultAfter.amount) / 1e6).toFixed(6)} (Δ +${(Number(realizedActual) / 1e6).toFixed(6)} from harvest, ` +
      `pre-protocol-fee transfer accounted for in the same tx)`,
  );
  console.log(`\n━━━ done ━━━\n`);
  console.log(`Solscan (devnet):`);
  console.log(`  pool       : https://solscan.io/account/${pool.toBase58()}?cluster=devnet`);
  console.log(`  harvest tx : https://solscan.io/tx/${sig}?cluster=devnet`);
  console.log(`  yield vault: https://solscan.io/account/${yieldVault.toBase58()}?cluster=devnet`);
  console.log("");
}

main().catch((e) => {
  console.error("\n✗ seed-yield-harvest failed:");
  console.error(e);
  process.exit(1);
});

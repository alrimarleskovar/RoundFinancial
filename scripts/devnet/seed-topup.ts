/**
 * Top up a pool's `pool_usdc_vault` from the deployer's USDC ATA so a
 * subsequent `claim_payout` can satisfy the protocol's
 * `WaterfallUnderflow` guard (`spendable >= credit_amount`). Standalone
 * companion to `seed-claim.ts`'s embedded top-up logic — useful when
 * the user wants to top up but trigger the claim from a different
 * surface (e.g. the front-end's PayInstallmentModal `Receber` button).
 *
 * In production this gap is bridged by the Yield Cascade (LP
 * distribution → pool float). The manual top-up here is the demo
 * stand-in until the harvest_yield → distribute path closes the
 * loop end-to-end.
 *
 * Env:
 *   POOL_SEED_ID   (default 1; pass 3 for the canonical demo pool)
 *   ANCHOR_WALLET  (path to deployer keypair; default ~/.config/solana/id.json)
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { loadCluster, requireProgram } from "../../config/clusters.js";

const POOL_SEED_ID = process.env.POOL_SEED_ID ? BigInt(process.env.POOL_SEED_ID) : 1n;
const DEPLOYMENT_CONFIG_PATH = resolve(process.cwd(), "config/program-ids.devnet.json");
// Same cushion the seed-claim driver uses — adds ~0.5 USDC slack so
// the top-up + claim survive blockhash drift / fee swings.
const TOPUP_CUSHION_BASE = 500_000n;

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf-8"))));
}

function poolPda(coreProgram: PublicKey, deployer: PublicKey, seedId: bigint): PublicKey {
  const seedIdLe = Buffer.alloc(8);
  seedIdLe.writeBigUInt64LE(seedId, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), deployer.toBuffer(), seedIdLe],
    coreProgram,
  )[0];
}

interface PoolView {
  creditAmount: bigint;
  guaranteeFundBalance: bigint;
}

function decodePoolMinimal(data: Buffer): PoolView {
  return {
    creditAmount: data.readBigUInt64LE(121),
    guaranteeFundBalance: data.readBigUInt64LE(203),
  };
}

async function main(): Promise<void> {
  const cluster = loadCluster();
  console.log(`\n━━━ RoundFi seed-topup → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);
  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to top-up on mainnet — production should use the Yield Cascade.");
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
  const poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, pool, true);

  const connection = new Connection(cluster.rpcUrl, "confirmed");

  console.log(`→ Cluster        : ${cluster.name}`);
  console.log(`→ Pool seed id   : ${POOL_SEED_ID}`);
  console.log(`→ Pool PDA       : ${pool.toBase58()}`);
  console.log(`→ Pool USDC vault: ${poolUsdcVault.toBase58()}`);
  console.log(`→ Deployer       : ${deployer.publicKey.toBase58()}`);

  const poolInfo = await connection.getAccountInfo(pool, "confirmed");
  if (!poolInfo) {
    throw new Error(`Pool not found at ${pool.toBase58()}. Wrong POOL_SEED_ID?`);
  }
  const poolView = decodePoolMinimal(poolInfo.data);

  const vaultAcct = await getAccount(connection, poolUsdcVault, "confirmed");
  const vaultAmount = vaultAcct.amount;
  const spendable =
    vaultAmount > poolView.guaranteeFundBalance ? vaultAmount - poolView.guaranteeFundBalance : 0n;

  console.log(
    `→ Vault balance  : ${(Number(vaultAmount) / 1e6).toFixed(2)} USDC` +
      ` (gf=${(Number(poolView.guaranteeFundBalance) / 1e6).toFixed(2)},` +
      ` spendable=${(Number(spendable) / 1e6).toFixed(2)})`,
  );
  console.log(`→ Credit amount  : ${(Number(poolView.creditAmount) / 1e6).toFixed(2)} USDC`);

  if (spendable >= poolView.creditAmount) {
    console.log(`\n✓ Pool float already OK (spendable >= credit). No top-up needed.\n`);
    return;
  }

  const gap = poolView.creditAmount - spendable + TOPUP_CUSHION_BASE;
  console.log(
    `\n→ Gap            : ${(Number(gap) / 1e6).toFixed(6)} USDC (incl. ${
      Number(TOPUP_CUSHION_BASE) / 1e6
    } cushion)`,
  );

  const deployerAta = getAssociatedTokenAddressSync(usdcMint, deployer.publicKey);
  const deployerAcct = await getAccount(connection, deployerAta, "confirmed").catch(() => null);
  if (!deployerAcct) {
    throw new Error(
      `Deployer USDC ATA ${deployerAta.toBase58()} does not exist.\n` +
        `Faucet USDC to ${deployer.publicKey.toBase58()} via https://faucet.circle.com (devnet) and re-run.`,
    );
  }
  if (deployerAcct.amount < gap) {
    throw new Error(
      `Deployer has only ${(Number(deployerAcct.amount) / 1e6).toFixed(2)} USDC; need ${(
        Number(gap) / 1e6
      ).toFixed(6)} for the top-up.\n` +
        `Faucet more to ${deployer.publicKey.toBase58()} via https://faucet.circle.com (devnet) and re-run.`,
    );
  }

  const transferIx = createTransferInstruction(
    deployerAta,
    poolUsdcVault,
    deployer.publicKey,
    Number(gap),
  );
  const tx = new Transaction().add(transferIx);
  const sig = await connection.sendTransaction(tx, [deployer], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");

  console.log(`\n✓ Top-up landed`);
  console.log(`    signature : ${sig}`);
  console.log(`    Solscan   : https://solscan.io/tx/${sig}?cluster=devnet\n`);
}

main().catch((e) => {
  console.error("\n✗ seed-topup failed:");
  console.error(e);
  process.exit(1);
});

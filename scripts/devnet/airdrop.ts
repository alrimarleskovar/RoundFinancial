/**
 * Airdrop SOL to a wallet on Devnet or Localnet.
 *
 * Usage:
 *   pnpm run devnet:airdrop                         # 2 SOL to ANCHOR_WALLET
 *   pnpm run devnet:airdrop -- ./keypairs/crank.json 5
 */

import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { loadCluster } from "../../config/clusters.js";

const DEFAULT_WALLET =
  process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
const DEFAULT_AMOUNT_SOL = 2;
const MAX_AMOUNT_SOL = 5; // Devnet faucet cap per request

async function main() {
  const cluster = loadCluster();
  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to airdrop on mainnet.");
  }

  const walletPath = process.argv[2] ?? DEFAULT_WALLET;
  if (!existsSync(walletPath)) {
    throw new Error(
      `Wallet keypair not found at ${walletPath}. ` +
        `Create one with: solana-keygen new -o ${walletPath}`,
    );
  }

  const secret = Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf-8")));
  const wallet = Keypair.fromSecretKey(secret);

  const requested = Number(process.argv[3] ?? DEFAULT_AMOUNT_SOL);
  const amountSol = Math.min(requested, MAX_AMOUNT_SOL);
  if (amountSol !== requested) {
    console.warn(`! Clamped request from ${requested} → ${amountSol} SOL (faucet cap)`);
  }

  console.log(`→ Cluster     : ${cluster.name} (${cluster.rpcUrl})`);
  console.log(`→ Recipient   : ${wallet.publicKey.toBase58()}`);
  console.log(`→ Amount      : ${amountSol} SOL`);

  const connection = new Connection(cluster.rpcUrl, "confirmed");
  const sig = await connection.requestAirdrop(
    wallet.publicKey,
    amountSol * LAMPORTS_PER_SOL,
  );
  await connection.confirmTransaction(sig, "confirmed");

  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`✓ Signature   : ${sig}`);
  console.log(`✓ Balance     : ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`  Explorer    : ${cluster.explorerBase}${cluster.explorerBase.includes("?") ? "&" : "?"}tx=${sig}`);
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * Emergency / cleanup unpause — sets `ProtocolConfig.paused = false`.
 *
 * Idempotent and safe: reads the current flag first, no-ops if already
 * unpaused, otherwise sends `pause(false)` signed by the protocol
 * authority and verifies on-chain. Use this if `pause-rehearsal` exited
 * after pausing but before its unpause step (e.g. Ctrl-C at the unpause
 * prompt), leaving devnet frozen.
 *
 * Wallet resolution matches the deployer keypair the rest of the devnet
 * flow uses:
 *   SOLANA_WALLET ?? ANCHOR_WALLET ?? keypairs/deployer.json ?? CLI default
 * The authority MUST equal `config.authority` (the deployer 64XM177V…)
 * or the ix reverts with Unauthorized (6023).
 *
 *   pnpm devnet:unpause
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

const RPC_URL = process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com";
const ROUNDFI_CORE_PROGRAM_ID = new PublicKey("8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw");
const SEED_CONFIG = Buffer.from("config");

function resolveWalletPath(): string {
  if (process.env.SOLANA_WALLET) return process.env.SOLANA_WALLET;
  if (process.env.ANCHOR_WALLET) return process.env.ANCHOR_WALLET;
  const repoDeployer = resolve(process.cwd(), "keypairs/deployer.json");
  if (existsSync(repoDeployer)) return repoDeployer;
  return resolve(homedir(), ".config/solana/id.json");
}

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function anchorIxDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

async function readPausedFlag(connection: Connection, configPda: PublicKey): Promise<boolean> {
  const info = await connection.getAccountInfo(configPda, "confirmed");
  if (!info) throw new Error(`ProtocolConfig PDA ${configPda.toBase58()} not found`);
  // paused byte lives at offset 8 + 32×6 + 2×5 = 210 (see pause-rehearsal.ts).
  return info.data[210] === 1;
}

async function main(): Promise<void> {
  const walletPath = resolveWalletPath();
  const authority = loadKeypair(walletPath);
  const connection = new Connection(RPC_URL, "confirmed");
  const [configPda] = PublicKey.findProgramAddressSync([SEED_CONFIG], ROUNDFI_CORE_PROGRAM_ID);

  console.log(`\n━━━ RoundFi unpause → devnet (${RPC_URL}) ━━━\n`);
  console.log(`  Wallet    : ${walletPath}`);
  console.log(`  Authority : ${authority.publicKey.toBase58()}`);
  console.log(`  Config PDA: ${configPda.toBase58()}`);

  const pausedNow = await readPausedFlag(connection, configPda);
  console.log(`  Current paused state: ${pausedNow}\n`);

  if (!pausedNow) {
    console.log(`✓ Protocol is already unpaused. Nothing to do.\n`);
    return;
  }

  console.log(`→ Protocol is PAUSED — sending pause(false)…`);
  const data = Buffer.concat([anchorIxDiscriminator("pause"), Buffer.from([0])]);
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    programId: ROUNDFI_CORE_PROGRAM_ID,
    data,
  });

  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = authority.publicKey;
  tx.sign(authority);

  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );

  const pausedAfter = await readPausedFlag(connection, configPda);
  if (pausedAfter) {
    throw new Error("UNPAUSE FAILED — paused flag still true after tx confirmation");
  }

  console.log(`  ✓ tx: ${sig}`);
  console.log(`     https://solscan.io/tx/${sig}?cluster=devnet`);
  console.log(`  ✓ ProtocolConfig.paused = false (verified on-chain)\n`);
}

main().catch((err) => {
  console.error("\n✗ unpause failed:");
  console.error(err);
  process.exit(1);
});

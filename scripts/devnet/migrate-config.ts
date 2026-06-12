/**
 * One-shot devnet rescue: bring the existing `ProtocolConfig` PDA up to
 * the current `ProtocolConfig::SIZE` after the program was redeployed
 * with a larger struct.
 *
 * Calls the `migrate_protocol_config` ix on the core program; the
 * handler is idempotent (no-op if the account is already at the target
 * size), so re-running is safe.
 *
 * Authority MUST be the on-chain `config.authority` (the deployer key
 * for devnet, `64XM177...`). The script defaults to `keypairs/deployer.json`
 * and falls back to `~/.config/solana/id.json`.
 *
 * The ix:
 *   1. Verifies the discriminator + authority on the raw bytes
 *      (Anchor can't deserialize the old layout yet).
 *   2. Reallocates the account to the current size, zero-init tail.
 *   3. Tops up rent from the authority's SOL balance.
 *   4. Writes `DEFAULT_LP_SHARE_BPS` (the only new field where zero is
 *      a bad default — would route nothing to LPs in the Yield Cascade).
 *
 * Usage:
 *   pnpm devnet:migrate-config
 *
 * Env (optional):
 *   SOLANA_RPC_URL           default https://api.devnet.solana.com
 *   ROUNDFI_CORE_PROGRAM_ID  default 8LVrgxKw... (the canonical devnet ID)
 *   AUTHORITY_KEYPAIR        default keypairs/deployer.json
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

const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const DEFAULT_CORE_PROGRAM_ID = "8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw";

function loadKeypair(path: string): Keypair {
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

function resolveAuthorityKeypair(): Keypair {
  const explicit = process.env.AUTHORITY_KEYPAIR;
  if (explicit && existsSync(explicit)) return loadKeypair(explicit);

  const deployer = resolve(process.cwd(), "keypairs/deployer.json");
  if (existsSync(deployer)) return loadKeypair(deployer);

  const cliWallet = resolve(homedir(), ".config/solana/id.json");
  if (existsSync(cliWallet)) return loadKeypair(cliWallet);

  throw new Error(
    "No authority keypair found. Tried $AUTHORITY_KEYPAIR, keypairs/deployer.json, and ~/.config/solana/id.json.",
  );
}

function ixDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

async function main(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
  const coreProgramId = new PublicKey(
    process.env.ROUNDFI_CORE_PROGRAM_ID ?? DEFAULT_CORE_PROGRAM_ID,
  );
  const authority = resolveAuthorityKeypair();
  const connection = new Connection(rpcUrl, "confirmed");

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgramId);

  console.log("");
  console.log("─── migrate_protocol_config (devnet rescue) ──────────────");
  console.log(`Cluster        : ${rpcUrl}`);
  console.log(`Core program   : ${coreProgramId.toBase58()}`);
  console.log(`Config PDA     : ${configPda.toBase58()}`);
  console.log(`Authority      : ${authority.publicKey.toBase58()}`);
  console.log("");

  // Pre-flight: how big is the account today vs how big does the new
  // bytecode want it?
  const before = await connection.getAccountInfo(configPda, "confirmed");
  if (!before) {
    throw new Error(
      `Config PDA does not exist at ${configPda.toBase58()} — was the program ever initialized?`,
    );
  }
  const sizeBefore = before.data.length;
  // We don't know the target size from here — the on-chain handler does.
  // Just print what we see today; if it's already at the new size the ix
  // is a no-op.
  console.log(`→ Account size today : ${sizeBefore} bytes`);
  console.log(
    `→ Authority balance  : ${(await connection.getBalance(authority.publicKey)) / 1e9} SOL`,
  );
  console.log("");

  // Build the ix. No args; the Anchor disc is the entire instruction body.
  const data = ixDiscriminator("migrate_protocol_config");
  const ix = new TransactionInstruction({
    programId: coreProgramId,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }))
    .add(ix);

  console.log("→ sending migrate_protocol_config…");
  const sig = await connection.sendTransaction(tx, [authority], {
    preflightCommitment: "confirmed",
    skipPreflight: false,
  });
  console.log(`  signature : ${sig}`);
  console.log(`  https://solscan.io/tx/${sig}?cluster=devnet`);
  await connection.confirmTransaction(sig, "confirmed");
  console.log("  ✓ confirmed");
  console.log("");

  const after = await connection.getAccountInfo(configPda, "confirmed");
  const sizeAfter = after?.data.length ?? 0;
  console.log(`→ Account size now   : ${sizeAfter} bytes`);
  if (sizeAfter > sizeBefore) {
    console.log(`  ✓ realloc'd from ${sizeBefore} → ${sizeAfter}`);
  } else if (sizeAfter === sizeBefore) {
    console.log(`  ✓ already at target size — handler was a no-op`);
  } else {
    console.warn(`  ⚠ unexpected: account shrunk?`);
  }
  console.log("");
  console.log("Next step: re-run pnpm devnet:seed to verify create_pool works.");
}

main().catch((err) => {
  console.error("");
  console.error("✗ migrate-config failed:", err);
  process.exit(1);
});

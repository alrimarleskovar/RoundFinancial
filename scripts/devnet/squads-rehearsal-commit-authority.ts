/**
 * Squads rehearsal — submit `commit_new_authority()`.
 *
 * Finalizes a pending authority rotation after its 7-day eta has
 * elapsed. **Permissionless crank** — any wallet that pays the tx fee
 * can call this, including a third-party monitor or an offline-recovery
 * runner. The signer does NOT need to be the proposing authority.
 *
 * Atomically:
 *   1. Validates `now >= pending_authority_eta`
 *   2. `config.authority = config.pending_authority`
 *   3. Clears `pending_authority` + `pending_authority_eta`
 *
 * After this lands, the new authority controls every authority-gated
 * ix on the protocol. At mainnet ceremony, this is the moment the
 * deployer key loses control and the Squads multisig vault takes over.
 *
 * Closes part of Fase B of the Squads ceremony preparation track.
 *
 * ## Usage
 *
 * ```bash
 * pnpm tsx scripts/devnet/squads-rehearsal-commit-authority.ts
 * ```
 *
 * Pre-flight: runs `squads-rehearsal-verify.ts`-equivalent decode to
 * confirm the eta has elapsed before submitting; bails early if not.
 *
 * Refuses to run on mainnet.
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

import { loadCluster, requireProgram } from "../../config/clusters.js";

const OFFSET_PENDING_AUTHORITY = 311;
const OFFSET_PENDING_AUTHORITY_ETA = 343;
const PROTOCOL_CONFIG_SIZE = 381;

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

async function main(): Promise<void> {
  const cluster = loadCluster();
  console.log(`\n━━━ Squads rehearsal · commit → ${cluster.name} ━━━\n`);

  if (cluster.name === "mainnet-beta") {
    throw new Error(
      "Refusing to commit authority rotation on mainnet via this script. " +
        "Mainnet commit is also permissionless but should go through a " +
        "deliberate operator runbook, not a rehearsal script.",
    );
  }

  const coreProgram = requireProgram(cluster, "core");
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);

  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  const caller = loadKeypair(walletPath);

  console.log(`→ Cluster        : ${cluster.name}`);
  console.log(`→ Core program   : ${coreProgram.toBase58()}`);
  console.log(`→ Config PDA     : ${configPda.toBase58()}`);
  console.log(`→ Crank (caller) : ${caller.publicKey.toBase58()}\n`);

  // ─── Pre-flight: confirm eta has elapsed ───────────────────────────
  const connection = new Connection(cluster.rpcUrl, "confirmed");
  const info = await connection.getAccountInfo(configPda, "confirmed");
  if (!info) {
    throw new Error(`ProtocolConfig not found at ${configPda.toBase58()}`);
  }
  if (info.data.length !== PROTOCOL_CONFIG_SIZE) {
    throw new Error(
      `ProtocolConfig has unexpected size ${info.data.length} (expected ${PROTOCOL_CONFIG_SIZE}). ` +
        `Program needs to be on PR #323 or later.`,
    );
  }

  const pendingAuthority = new PublicKey(
    info.data.subarray(OFFSET_PENDING_AUTHORITY, OFFSET_PENDING_AUTHORITY + 32),
  );
  const eta = (info.data as Buffer).readBigInt64LE(OFFSET_PENDING_AUTHORITY_ETA);

  if (pendingAuthority.equals(PublicKey.default)) {
    throw new Error(
      "No authority rotation pending — nothing to commit. " +
        "Run squads-rehearsal-propose-authority.ts first.",
    );
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < eta) {
    const remaining = Number(eta - now);
    const hours = Math.floor(remaining / 3600);
    const mins = Math.floor((remaining % 3600) / 60);
    throw new Error(
      `Timelock active — eta in ${hours}h ${mins}m. ` +
        `Commit will revert with AuthorityTimelockActive. Wait until ${new Date(Number(eta) * 1000).toISOString()}.`,
    );
  }

  console.log(`→ Pending → live : ${pendingAuthority.toBase58()}`);
  console.log(`→ Eta elapsed at : ${new Date(Number(eta) * 1000).toISOString()}\n`);

  // ix.data = [discriminator (8)] — no args
  const data = anchorIxDiscriminator("commit_new_authority");

  // Account list mirrors `CommitNewAuthority`:
  //   1. config (PDA, mut)
  //   2. caller (signer; no authority constraint — permissionless)
  const ix = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: caller.publicKey, isSigner: true, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const signature = await connection.sendTransaction(tx, [caller], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");

  console.log(`✓ commit_new_authority confirmed`);
  console.log(`  signature : ${signature}`);
  if (cluster.name === "devnet") {
    console.log(`  solscan   : https://solscan.io/tx/${signature}?cluster=devnet`);
  }
  console.log("");
  console.log(`config.authority is now ${pendingAuthority.toBase58()}.`);
  console.log("Re-run squads-rehearsal-verify.ts to confirm the swap.");
  console.log("");
}

main().catch((e) => {
  console.error("\n✗ squads-rehearsal-commit-authority failed:");
  console.error(e);
  process.exit(1);
});

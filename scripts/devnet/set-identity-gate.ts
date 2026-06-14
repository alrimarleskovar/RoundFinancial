/**
 * Set (and lazily create) the SEV-047 `IdentityGateConfig` singleton on
 * the configured cluster.
 *
 * **Why this exists.** `promote_level` now loads the `IdentityGateConfig`
 * PDA as a REQUIRED account (SEV-047 Part 2). On a deployment where the
 * PDA doesn't exist yet, the first `promote_level` would fail. Run this
 * once with `required_min_level = 0` (gate OFF — Canary/devnet behave
 * exactly as before) to create the PDA. Raise to 2 or 3 later, on
 * mainnet, to require a verified identity for L2+ promotion.
 *
 * Idempotent: `set_identity_gate` is `init_if_needed` on-chain, so
 * re-running is safe — it just (re)writes `required_min_level`.
 *
 * Manual instruction encoding (no Anchor TS client) — same rationale
 * as `init-protocol.ts` (IDL-free by design, ADR 0002; hand-rolled,
 * not blocked):
 *
 *   discriminator = sha256("global:set_identity_gate")[0..8]
 *   args          = u8 required_min_level
 *   accounts      = [authority(s,w), config(r), identity_gate(w), system(r)]
 *
 * Usage:
 *   pnpm devnet:set-identity-gate            # level 0 (gate OFF, default)
 *   pnpm devnet:set-identity-gate 2          # require verified identity at L2+
 *   IDENTITY_GATE_LEVEL=3 pnpm devnet:set-identity-gate
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
} from "@solana/web3.js";

import { loadCluster, requireProgram } from "../../config/clusters.js";

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

function resolveLevel(): number {
  const raw = process.argv[2] ?? process.env.IDENTITY_GATE_LEVEL ?? "0";
  const level = Number.parseInt(raw, 10);
  if (Number.isNaN(level) || (level !== 0 && (level < 2 || level > 3))) {
    throw new Error(
      `Invalid required_min_level "${raw}". Valid: 0 (off), 2, or 3 ` +
        `(matches the on-chain constraint: 0 || 2..=LEVEL_MAX).`,
    );
  }
  return level;
}

async function main() {
  const cluster = loadCluster();
  console.log(`\n━━━ RoundFi set-identity-gate → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);

  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to run on mainnet — use a deliberate process.");
  }

  const requiredMinLevel = resolveLevel();
  const reputationProgram = requireProgram(cluster, "reputation");

  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  const authority = loadKeypair(walletPath);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("rep-config")],
    reputationProgram,
  );
  const [gatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("identity-gate")],
    reputationProgram,
  );

  console.log(`→ Cluster          : ${cluster.name}`);
  console.log(`→ Authority        : ${authority.publicKey.toBase58()}`);
  console.log(`→ Reputation prog  : ${reputationProgram.toBase58()}`);
  console.log(`→ ReputationConfig : ${configPda.toBase58()}`);
  console.log(`→ IdentityGate PDA : ${gatePda.toBase58()}`);
  console.log(
    `→ required_min_level: ${requiredMinLevel} ${requiredMinLevel === 0 ? "(gate OFF)" : "(gate ON)"}\n`,
  );

  const connection = new Connection(cluster.rpcUrl, "confirmed");

  const balance = await connection.getBalance(authority.publicKey);
  console.log(`→ Authority balance: ${(balance / 1e9).toFixed(4)} SOL`);
  if (balance < 0.01 * 1e9) {
    throw new Error(
      `Insufficient SOL on authority (${authority.publicKey.toBase58()}). ` +
        `Need ≥ 0.01 SOL to create/update the gate PDA.`,
    );
  }

  const existing = await connection.getAccountInfo(gatePda, "confirmed");
  console.log(`→ IdentityGate PDA ${existing ? "exists — updating" : "missing — creating"}\n`);

  // ix.data = [discriminator (8) | u8 required_min_level (1)] = 9 bytes
  const data = Buffer.concat([
    anchorIxDiscriminator("set_identity_gate"),
    Buffer.from([requiredMinLevel & 0xff]),
  ]);

  // Accounts (mirror `SetIdentityGate` in set_identity_gate.rs):
  //   1. authority      (signer, mut)
  //   2. config         (PDA [rep-config]; read — authority constraint)
  //   3. identity_gate  (PDA [identity-gate]; mut, init_if_needed)
  //   4. system_program (read)
  const ix = new TransactionInstruction({
    programId: reputationProgram,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: gatePda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const signature = await connection.sendTransaction(tx, [authority], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");

  console.log(`✓ set_identity_gate confirmed`);
  console.log(`  gate PDA  : ${gatePda.toBase58()}`);
  console.log(`  signature : ${signature}\n`);

  console.log(`━━━ done ━━━\n`);
  console.log(`Solscan (devnet):`);
  console.log(`  https://solscan.io/account/${gatePda.toBase58()}?cluster=devnet`);
  console.log(`  https://solscan.io/tx/${signature}?cluster=devnet\n`);
}

main().catch((e) => {
  console.error("\n✗ set-identity-gate failed:");
  console.error(e);
  process.exit(1);
});

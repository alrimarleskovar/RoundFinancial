/**
 * Run `roundfi_core.finalize_draw()` on a full sorteio pool (ADR pool_v2).
 *
 * Mints the pool's DrawResult PDA — the payout-order permutation — and
 * prints the drawn order (seat → cycle) so the operator can tell the
 * group who receives when. Permissionless + single-shot: a second run
 * fails on the PDA `init` collision (re-rolls are impossible by design).
 *
 * Usage (after the pool FILLS — every seat joined):
 *   POOL_SEED_ID=8 pnpm exec tsx scripts/devnet/finalize-draw.ts
 *
 * Pair with the sorteio seed:
 *   POOL_SEED_ID=8 ORDERING_POLICY=1 MEMBERS_TARGET=3 CYCLES_TOTAL=3 \
 *     CREDIT_AMOUNT_USDC=2 INSTALLMENT_AMOUNT_USDC=1 \
 *     pnpm exec tsx scripts/devnet/seed-pool.ts
 *
 * Manual instruction encoding (IDL-free by design, ADR 0002 — same as
 * seed-pool.ts / crank-payout.ts).
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

const POOL_SEED_ID = process.env.POOL_SEED_ID ? BigInt(process.env.POOL_SEED_ID) : 8n;

function loadKeypair(path: string): Keypair {
  if (!existsSync(path)) throw new Error(`keypair not found at ${path}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf-8"))));
}

function anchorIxDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

async function main() {
  const cluster = loadCluster();
  const coreProgram = requireProgram(cluster, "core");
  const connection = new Connection(cluster.rpcUrl, "confirmed");
  const caller = loadKeypair(
    process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json"),
  );

  const seedIdLe = Buffer.alloc(8);
  seedIdLe.writeBigUInt64LE(POOL_SEED_ID, 0);
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), caller.publicKey.toBuffer(), seedIdLe],
    coreProgram,
  );
  const [drawPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("draw-result"), poolPda.toBuffer()],
    coreProgram,
  );

  console.log(`━━━ finalize_draw → ${cluster.name} ━━━`);
  console.log(`pool (seed_id=${POOL_SEED_ID}): ${poolPda.toBase58()}`);
  console.log(`draw PDA:                       ${drawPda.toBase58()}`);

  const existing = await connection.getAccountInfo(drawPda, "confirmed");
  if (existing) {
    printOrder(existing.data);
    console.log("→ Draw already finalized — order above. (Single-shot by design.)");
    return;
  }

  // Account order matches FinalizeDraw<'info> (finalize_draw.rs).
  const ix = new TransactionInstruction({
    programId: coreProgram,
    data: anchorIxDiscriminator("finalize_draw"),
    keys: [
      { pubkey: caller.publicKey, isSigner: true, isWritable: true },
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: drawPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });

  const tx = new Transaction().add(ix);
  const signature = await connection.sendTransaction(tx, [caller], { skipPreflight: false });
  await connection.confirmTransaction(signature, "confirmed");
  console.log(`✓ draw finalized: ${signature}`);

  const info = await connection.getAccountInfo(drawPda, "confirmed");
  if (info) printOrder(info.data);
}

/** Decode DrawResult (disc 8 | pool 32 | seed 32 | order 64 | n 1 | bump 1). */
function printOrder(data: Buffer | Uint8Array) {
  const buf = Buffer.from(data);
  const n = buf[8 + 32 + 32 + 64] ?? 0;
  const order = Array.from(buf.subarray(8 + 32 + 32, 8 + 32 + 32 + n));
  const seed = buf.subarray(8 + 32, 8 + 32 + 32).toString("hex");
  console.log(`seed: ${seed}`);
  console.log(`payout order (seat → cycle):`);
  order.forEach((cycle, seat) => console.log(`  seat #${seat} → recebe no ciclo ${cycle}`));
}

main().catch((e) => {
  console.error("✗ finalize_draw failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

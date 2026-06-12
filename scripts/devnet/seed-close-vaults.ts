/**
 * SEV-039 rent-reclaim ceremony — the true end of a pool's lifecycle.
 *
 * `close_pool` only flips the pool to `Closed` (a state transition that
 * moves no funds). The rent locked in the Member PDAs + the four vault
 * ATAs + the Pool PDA itself is reclaimed by this two-stage ceremony:
 *
 *   1. `close_member` × N — closes each still-open Member PDA, returning
 *      its rent to the member's wallet, and decrements the repurposed
 *      `pool.members_joined` live-PDA counter.
 *   2. `close_pool_vaults` — once `members_joined == 0`, drains any
 *      residual USDC from the four vaults to `config.treasury`, closes
 *      the four vault ATAs, and closes the Pool PDA, returning all that
 *      rent to `rent_recipient` (the authority).
 *
 * Net effect: SOL flows BACK to the operator. This script costs only tx
 * fees; it recovers the per-pool rent.
 *
 * Pre-conditions (enforced on chain):
 *   - `pool.status == Closed` (run `seed-close` first).
 *   - Caller is `pool.authority` (the deployer) or `config.authority`.
 *
 * Env:
 *   POOL_SEED_ID         (default 1)
 *   MEMBERS_TARGET       (default 3 — how many member-{N} slots to close)
 *   MEMBER_INDEX_OFFSET  (default 0 — member-{slot+offset}.json filename)
 *
 * Manual ix encoding (Anchor IDL gen still blocked).
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
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { loadCluster, requireProgram } from "../../config/clusters.js";

const POOL_SEED_ID = process.env.POOL_SEED_ID ? BigInt(process.env.POOL_SEED_ID) : 1n;
const MEMBERS_TARGET = process.env.MEMBERS_TARGET ? Number(process.env.MEMBERS_TARGET) : 3;
const MEMBER_INDEX_OFFSET = process.env.MEMBER_INDEX_OFFSET
  ? Number(process.env.MEMBER_INDEX_OFFSET)
  : 0;
const KEYPAIRS_DIR = resolve(process.cwd(), "keypairs");
const DEPLOYMENT_CONFIG_PATH = resolve(process.cwd(), "config/program-ids.devnet.json");

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf-8"))));
}

function resolveDeployerKeypair(): Keypair {
  const p =
    process.env.ANCHOR_WALLET ??
    (existsSync(resolve(process.cwd(), "keypairs/deployer.json"))
      ? resolve(process.cwd(), "keypairs/deployer.json")
      : resolve(homedir(), ".config/solana/id.json"));
  if (!existsSync(p)) throw new Error(`No deployer keypair found at ${p}.`);
  return loadKeypair(p);
}

function memberWallet(slot: number): PublicKey {
  const path = resolve(KEYPAIRS_DIR, `member-${slot + MEMBER_INDEX_OFFSET}.json`);
  if (!existsSync(path))
    throw new Error(`Missing keypairs/member-${slot + MEMBER_INDEX_OFFSET}.json`);
  return loadKeypair(path).publicKey;
}

function anchorIxDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function poolPda(coreProgram: PublicKey, deployer: PublicKey, seedId: bigint): PublicKey {
  const seedIdLe = Buffer.alloc(8);
  seedIdLe.writeBigUInt64LE(seedId, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), deployer.toBuffer(), seedIdLe],
    coreProgram,
  )[0];
}

function treasuryAta(usdcMint: PublicKey, deployer: PublicKey): PublicKey {
  if (existsSync(DEPLOYMENT_CONFIG_PATH)) {
    const cfg = JSON.parse(readFileSync(DEPLOYMENT_CONFIG_PATH, "utf-8")) as {
      initialized?: { treasuryAta?: string };
    };
    if (cfg.initialized?.treasuryAta) return new PublicKey(cfg.initialized.treasuryAta);
  }
  // config.treasury defaults to the deployer's USDC ATA on the bootstrap deploy.
  return getAssociatedTokenAddressSync(usdcMint, deployer);
}

// Pool.status byte offset (decoded the same way seed-close does — offset 145).
function decodePoolStatus(data: Buffer): number {
  return data.readUInt8(145);
}

async function main() {
  const cluster = loadCluster();
  console.log(`\n━━━ RoundFi seed-close-vaults (SEV-039 rent reclaim) → ${cluster.name} ━━━\n`);
  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to run the rent-reclaim ceremony on mainnet from this script.");
  }

  const coreProgram = requireProgram(cluster, "core");
  const usdcMint = cluster.usdcMint;
  const deployer = resolveDeployerKeypair();
  const pool = poolPda(coreProgram, deployer.publicKey, POOL_SEED_ID);
  const [protocolConfig] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);

  console.log(`→ Authority   : ${deployer.publicKey.toBase58()}`);
  console.log(`→ Pool seed id: ${POOL_SEED_ID}`);
  console.log(`→ Pool PDA    : ${pool.toBase58()}`);

  const connection = new Connection(cluster.rpcUrl, "confirmed");
  const poolInfo = await connection.getAccountInfo(pool, "confirmed");
  if (!poolInfo) {
    throw new Error(`Pool not found at ${pool.toBase58()}. Wrong POOL_SEED_ID?`);
  }
  const status = decodePoolStatus(poolInfo.data);
  console.log(`→ Pool status : ${status} (need 3 = Closed)`);
  if (status !== 3) {
    throw new Error(`Pool is not Closed (status=${status}). Run 'pnpm devnet:seed-close' first.`);
  }

  const solBefore = await connection.getBalance(deployer.publicKey, "confirmed");

  // ── Stage 1: close each open Member PDA ─────────────────────────────
  console.log(`\nStage 1 — close_member × ${MEMBERS_TARGET}`);
  for (let slot = 0; slot < MEMBERS_TARGET; slot++) {
    const wallet = memberWallet(slot);
    const [memberPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("member"), pool.toBuffer(), wallet.toBuffer()],
      coreProgram,
    );
    const memberInfo = await connection.getAccountInfo(memberPda, "confirmed");
    if (!memberInfo) {
      console.log(`  slot ${slot}: Member PDA already closed — skip`);
      continue;
    }
    // Accounts match `CloseMember`:
    //   1. authority (signer, mut)  2. config (read)  3. pool (mut)
    //   4. member_wallet (mut)  5. member (mut, close=member_wallet)
    const ix = new TransactionInstruction({
      programId: coreProgram,
      keys: [
        { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
        { pubkey: protocolConfig, isSigner: false, isWritable: false },
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: wallet, isSigner: false, isWritable: true },
        { pubkey: memberPda, isSigner: false, isWritable: true },
      ],
      data: anchorIxDiscriminator("close_member"),
    });
    const sig = await connection.sendTransaction(new Transaction().add(ix), [deployer], {
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(sig, "confirmed");
    console.log(`  ✓ slot ${slot} (${wallet.toBase58()}) closed — sig ${sig}`);
  }

  // ── Stage 2: close the four vaults + the Pool PDA ───────────────────
  console.log(`\nStage 2 — close_pool_vaults (drain → treasury, close vaults + Pool PDA)`);
  const [escrowAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), pool.toBuffer()],
    coreProgram,
  );
  const [solidarityAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from("solidarity"), pool.toBuffer()],
    coreProgram,
  );
  const [yieldAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from("yield"), pool.toBuffer()],
    coreProgram,
  );
  const poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, pool, true);
  const escrowVault = getAssociatedTokenAddressSync(usdcMint, escrowAuth, true);
  const solidarityVault = getAssociatedTokenAddressSync(usdcMint, solidarityAuth, true);
  const yieldVault = getAssociatedTokenAddressSync(usdcMint, yieldAuth, true);
  const treasuryUsdc = treasuryAta(usdcMint, deployer.publicKey);

  // Accounts match `ClosePoolVaults` (14):
  //   1 authority(signer,mut) 2 config 3 rent_recipient(mut) 4 pool(mut,close)
  //   5 usdc_mint 6 treasury_usdc(mut) 7 escrow_auth 8 solidarity_auth
  //   9 yield_auth 10 pool_usdc_vault(mut) 11 escrow_vault(mut)
  //   12 solidarity_vault(mut) 13 yield_vault(mut) 14 token_program
  const ix = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: deployer.publicKey, isSigner: false, isWritable: true }, // rent_recipient
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: treasuryUsdc, isSigner: false, isWritable: true },
      { pubkey: escrowAuth, isSigner: false, isWritable: false },
      { pubkey: solidarityAuth, isSigner: false, isWritable: false },
      { pubkey: yieldAuth, isSigner: false, isWritable: false },
      { pubkey: poolUsdcVault, isSigner: false, isWritable: true },
      { pubkey: escrowVault, isSigner: false, isWritable: true },
      { pubkey: solidarityVault, isSigner: false, isWritable: true },
      { pubkey: yieldVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: anchorIxDiscriminator("close_pool_vaults"),
  });
  const sig = await connection.sendTransaction(new Transaction().add(ix), [deployer], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");
  console.log(`  ✓ close_pool_vaults confirmed — sig ${sig}`);

  const solAfter = await connection.getBalance(deployer.publicKey, "confirmed");
  const reclaimed = (solAfter - solBefore) / 1e9;
  console.log(
    `\n━━━ done — pool ${POOL_SEED_ID} fully reclaimed ━━━\n` +
      `  authority SOL: ${(solBefore / 1e9).toFixed(4)} → ${(solAfter / 1e9).toFixed(4)} ` +
      `(net ${reclaimed >= 0 ? "+" : ""}${reclaimed.toFixed(4)} after fees)\n`,
  );
  console.log(`Solscan: https://solscan.io/tx/${sig}?cluster=devnet\n`);
}

main().catch((e) => {
  console.error("\n✗ seed-close-vaults failed:");
  console.error(e);
  process.exit(1);
});

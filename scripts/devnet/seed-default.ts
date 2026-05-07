/**
 * Settle a delinquent member via `roundfi_core.settle_default(cycle)`.
 *
 * Preconditions (enforced on chain):
 *   - `clock >= pool.next_cycle_at + GRACE_PERIOD_SECS` (60s on devnet
 *     per the demo patch in core/src/constants.rs; 7d in production)
 *   - `member.contributions_paid < pool.current_cycle` (genuinely behind)
 *   - `!member.defaulted` (one-shot transition)
 *   - `pool.status == Active`
 *
 * Seizure order (Triple Shield):
 *   a) solidarity vault — up to the missed installment
 *   b) member.escrow_balance — up to D_remaining shortfall, gated by
 *      D/C invariant
 *   c) member.stake_deposited — remaining shortfall, gated by D/C
 * All seized USDC flows into pool_usdc_vault. Member.defaulted=true.
 * SCHEMA_DEFAULT attestation fires for the member's reputation profile.
 *
 * Env:
 *   POOL_SEED_ID         (default 1; pool 3 is the canonical target)
 *   DEFAULT_SLOT_INDEX   (default 2; slot 2 in pool 3 is the delinquent
 *                          member by convention — see runbook)
 *   DEFAULT_CYCLE        (default = pool.current_cycle from on-chain)
 *
 * Manual ix encoding (Anchor IDL gen still blocked).
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
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { loadCluster, requireProgram } from "../../config/clusters.js";

const POOL_SEED_ID = process.env.POOL_SEED_ID ? BigInt(process.env.POOL_SEED_ID) : 1n;
const SLOT_INDEX = Number(process.env.DEFAULT_SLOT_INDEX ?? 2);
const KEYPAIRS_DIR = resolve(process.cwd(), "keypairs");
const DEPLOYMENT_CONFIG_PATH = resolve(process.cwd(), "config/program-ids.devnet.json");
const MEMBER_INDEX_OFFSET = process.env.MEMBER_INDEX_OFFSET
  ? Number(process.env.MEMBER_INDEX_OFFSET)
  : 0;

function loadKeypair(path: string): Keypair {
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

function loadMemberKeypair(slot: number): Keypair {
  const path = resolve(KEYPAIRS_DIR, `member-${slot + MEMBER_INDEX_OFFSET}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `Missing keypairs/member-${slot + MEMBER_INDEX_OFFSET}.json. Run seed-members first.`,
    );
  }
  return loadKeypair(path);
}

function anchorIxDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function encodeU8(value: number): Buffer {
  return Buffer.from([value & 0xff]);
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
  status: number;
  currentCycle: number;
  nextCycleAt: bigint;
}

function decodePool(data: Buffer): PoolView {
  return {
    status: data.readUInt8(145),
    currentCycle: data.readUInt8(154),
    nextCycleAt: data.readBigInt64LE(155),
  };
}

interface MemberView {
  contributionsPaid: number;
  escrowBalance: bigint;
  stakeDeposited: bigint;
  defaulted: boolean;
}

function decodeMember(data: Buffer): MemberView {
  return {
    stakeDeposited: data.readBigUInt64LE(108),
    contributionsPaid: data.readUInt8(116),
    escrowBalance: data.readBigUInt64LE(133),
    defaulted: data.readUInt8(145) !== 0,
  };
}

function attestationPda(
  reputationProgram: PublicKey,
  pool: PublicKey,
  subject: PublicKey,
  schemaId: number,
  nonce: bigint,
): PublicKey {
  const schemaLe = Buffer.alloc(2);
  schemaLe.writeUInt16LE(schemaId, 0);
  const nonceLe = Buffer.alloc(8);
  nonceLe.writeBigUInt64LE(nonce, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("attestation"), pool.toBuffer(), subject.toBuffer(), schemaLe, nonceLe],
    reputationProgram,
  )[0];
}

const SCHEMA_DEFAULT: number = 3;

async function main() {
  const cluster = loadCluster();
  console.log(`\n━━━ RoundFi seed-default → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);
  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to seed default on mainnet.");
  }

  const coreProgram = requireProgram(cluster, "core");
  const reputationProgram = requireProgram(cluster, "reputation");
  const usdcMint = cluster.usdcMint;

  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  if (!existsSync(walletPath)) {
    throw new Error(`Caller keypair not found at ${walletPath}.`);
  }
  const caller = loadKeypair(walletPath);

  let cfgDeployer: PublicKey = caller.publicKey;
  if (existsSync(DEPLOYMENT_CONFIG_PATH)) {
    const cfg = JSON.parse(readFileSync(DEPLOYMENT_CONFIG_PATH, "utf-8")) as { deployer?: string };
    if (cfg.deployer) cfgDeployer = new PublicKey(cfg.deployer);
  }

  const pool = poolPda(coreProgram, cfgDeployer, POOL_SEED_ID);
  const [protocolConfig] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);

  const connection = new Connection(cluster.rpcUrl, "confirmed");

  const poolInfo = await connection.getAccountInfo(pool, "confirmed");
  if (!poolInfo) {
    throw new Error(`Pool not found at ${pool.toBase58()}. Wrong POOL_SEED_ID?`);
  }
  const poolView = decodePool(poolInfo.data);
  console.log(`→ Cluster      : ${cluster.name}`);
  console.log(`→ Caller       : ${caller.publicKey.toBase58()}`);
  console.log(`→ Pool seed id : ${POOL_SEED_ID}`);
  console.log(`→ Pool PDA     : ${pool.toBase58()}`);
  console.log(
    `→ Pool state   : status=${poolView.status} cycle=${poolView.currentCycle} ` +
      `next_cycle_at=${poolView.nextCycleAt}`,
  );

  if (poolView.status !== 1) {
    throw new Error(
      `Pool is not Active (status=${poolView.status}). settle_default requires status=1.`,
    );
  }

  const targetCycle = Number(process.env.DEFAULT_CYCLE ?? poolView.currentCycle);
  console.log(`→ Target slot  : ${SLOT_INDEX}`);
  console.log(`→ Target cycle : ${targetCycle}`);

  // Resolve the delinquent member's wallet via the slot's keypair file.
  const delinquent = loadMemberKeypair(SLOT_INDEX);
  console.log(`→ Delinquent   : ${delinquent.publicKey.toBase58()}`);

  // Read member state to confirm delinquency before sending.
  const [memberPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), pool.toBuffer(), delinquent.publicKey.toBuffer()],
    coreProgram,
  );
  const memberInfo = await connection.getAccountInfo(memberPda, "confirmed");
  if (!memberInfo) {
    throw new Error(`Member PDA missing at ${memberPda.toBase58()}. Did the member join?`);
  }
  const memberView = decodeMember(memberInfo.data);
  console.log(
    `→ Member state : contributions_paid=${memberView.contributionsPaid} ` +
      `escrow_balance=${(Number(memberView.escrowBalance) / 1e6).toFixed(2)} USDC ` +
      `stake_deposited=${(Number(memberView.stakeDeposited) / 1e6).toFixed(2)} USDC ` +
      `defaulted=${memberView.defaulted}`,
  );

  if (memberView.defaulted) {
    console.log(`\n✓ Member already defaulted. Nothing to do.`);
    return;
  }
  if (memberView.contributionsPaid >= poolView.currentCycle) {
    throw new Error(
      `Member is not behind: contributions_paid (${memberView.contributionsPaid}) >= ` +
        `current_cycle (${poolView.currentCycle}). Need them to skip a cycle first.`,
    );
  }

  const slot = await connection.getSlot("confirmed");
  const blockTime = await connection.getBlockTime(slot);
  if (blockTime == null) {
    throw new Error("Could not read block time from cluster.");
  }
  const graceDeadline = poolView.nextCycleAt + 60n; // GRACE_PERIOD_SECS = 60 (devnet patch)
  console.log(
    `→ Now (chain)  : ${blockTime}  ·  grace_deadline = next_cycle_at + 60 = ${graceDeadline}`,
  );
  if (BigInt(blockTime) < graceDeadline) {
    const wait = Number(graceDeadline - BigInt(blockTime));
    throw new Error(
      `Grace period not elapsed yet — need to wait ${wait}s. Try again after ${wait}s.`,
    );
  }
  console.log(`✓ Grace period elapsed (now >= deadline) — settle_default may proceed.\n`);

  // Vaults + reputation PDAs
  const poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, pool, true);
  const [solidarityAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("solidarity"), pool.toBuffer()],
    coreProgram,
  );
  const solidarityVault = getAssociatedTokenAddressSync(usdcMint, solidarityAuthority, true);
  const [escrowAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), pool.toBuffer()],
    coreProgram,
  );
  const escrowVault = getAssociatedTokenAddressSync(usdcMint, escrowAuthority, true);
  const [reputationConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("rep-config")],
    reputationProgram,
  );
  const [reputationProfile] = PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), delinquent.publicKey.toBuffer()],
    reputationProgram,
  );
  // Nonce mirrors the on-chain handler:
  //   nonce = ((cycle as u64) << 32) | (slot_index as u64)
  const nonce = (BigInt(targetCycle) << 32n) | BigInt(SLOT_INDEX);
  const attestation = attestationPda(
    reputationProgram,
    pool,
    delinquent.publicKey,
    SCHEMA_DEFAULT,
    nonce,
  );
  // identity_record = reputation_program → "no identity linked"
  const identityRecord = reputationProgram;

  const data = Buffer.concat([anchorIxDiscriminator("settle_default"), encodeU8(targetCycle)]);

  // Account order matches `SettleDefault` in
  // programs/roundfi-core/src/instructions/settle_default.rs:
  //   1.  caller (signer, mut)
  //   2.  config (PDA, read)
  //   3.  pool (PDA, mut)
  //   4.  member (PDA, mut)
  //   5.  defaulted_member_wallet (UncheckedAccount; read; pinned to member.wallet)
  //   6.  usdc_mint
  //   7.  pool_usdc_vault (mut)
  //   8.  solidarity_vault_authority (PDA, read)
  //   9.  solidarity_vault (mut)
  //  10.  escrow_vault_authority (PDA, read)
  //  11.  escrow_vault (mut)
  //  12.  token_program
  //  13.  reputation_program (UncheckedAccount, read)
  //  14.  reputation_config (UncheckedAccount, mut)
  //  15.  reputation_profile (UncheckedAccount, mut)
  //  16.  identity_record (UncheckedAccount, read; reputation_program ≡ None)
  //  17.  attestation (UncheckedAccount, mut, init by reputation::attest)
  //  18.  system_program
  const ix = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: caller.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: memberPda, isSigner: false, isWritable: true },
      { pubkey: delinquent.publicKey, isSigner: false, isWritable: false },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: poolUsdcVault, isSigner: false, isWritable: true },
      { pubkey: solidarityAuthority, isSigner: false, isWritable: false },
      { pubkey: solidarityVault, isSigner: false, isWritable: true },
      { pubkey: escrowAuthority, isSigner: false, isWritable: false },
      { pubkey: escrowVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: reputationProgram, isSigner: false, isWritable: false },
      { pubkey: reputationConfig, isSigner: false, isWritable: true },
      { pubkey: reputationProfile, isSigner: false, isWritable: true },
      { pubkey: identityRecord, isSigner: false, isWritable: false },
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
  const tx = new Transaction().add(cu, ix);
  const sig = await connection.sendTransaction(tx, [caller], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");

  console.log(`✓ settle_default landed`);
  console.log(`    signature: ${sig}\n`);

  // Pull the on-chain summary log.
  const txDetail = await connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (txDetail?.meta?.logMessages) {
    const summary = txDetail.meta.logMessages.find((l) => l.includes("settle_default"));
    if (summary) console.log(`On-chain summary log:\n  ${summary}`);
  }

  // Post-state member read.
  const memberInfoPost = await connection.getAccountInfo(memberPda, "confirmed");
  if (memberInfoPost) {
    const memberPost = decodeMember(memberInfoPost.data);
    console.log(
      `\nMember state post-settle:\n` +
        `    defaulted        = ${memberPost.defaulted}\n` +
        `    escrow_balance   = ${(Number(memberPost.escrowBalance) / 1e6).toFixed(2)} USDC ` +
        `(was ${(Number(memberView.escrowBalance) / 1e6).toFixed(2)})\n` +
        `    stake_deposited  = ${(Number(memberPost.stakeDeposited) / 1e6).toFixed(2)} USDC ` +
        `(was ${(Number(memberView.stakeDeposited) / 1e6).toFixed(2)})`,
    );
  }

  console.log(`\n━━━ done ━━━\n`);
  console.log(`Solscan (devnet):`);
  console.log(`  settle tx : https://solscan.io/tx/${sig}?cluster=devnet`);
  console.log(`  pool      : https://solscan.io/account/${pool.toBase58()}?cluster=devnet`);
  console.log(`  member PDA: https://solscan.io/account/${memberPda.toBase58()}?cluster=devnet`);
  console.log("");
}

main().catch((e) => {
  console.error("\n✗ seed-default failed:");
  console.error(e);
  process.exit(1);
});

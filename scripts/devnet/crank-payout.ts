/**
 * Permissionless liveness crank: unstick a pool whose LIVE contemplated member
 * never claimed. Calls `roundfi_core.crank_payout(cycle)` signed by the DEPLOYER
 * (any wallet works — it's permissionless), which delivers `pool.credit_amount`
 * to the contemplated member's OWN USDC ATA and advances `pool.current_cycle`.
 *
 * When it's callable: only AFTER the member's self-claim window,
 * `pool.next_cycle_at + GRACE_PERIOD_SECS` (7 days vanilla / 24h canary). Before
 * that, the member is expected to `claim_payout` themselves (use seed-claim /
 * the app). Calling early reverts with `PayoutGraceActive`.
 *
 * The contemplated member need not be reachable (that's the whole point — lost
 * wallet / abandonment). Provide their pubkey via `CRANK_MEMBER_WALLET`, or the
 * script falls back to `keypairs/member-{slot}.json` (demo pools).
 *
 * Env:
 *   POOL_SEED_ID          (default 1)
 *   CRANK_MEMBER_WALLET   (base58 pubkey of the stuck contemplated member;
 *                          optional — falls back to keypairs/member-{slot}.json)
 *   ANCHOR_WALLET         (caller/deployer keypair; default ~/.config/solana/id.json)
 *
 * Manual instruction encoding (IDL-free by design — ADR 0002).
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
import { TOKEN_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { loadCluster, requireProgram } from "../../config/clusters.js";

const POOL_SEED_ID = process.env.POOL_SEED_ID ? BigInt(process.env.POOL_SEED_ID) : 1n;
const KEYPAIRS_DIR = resolve(process.cwd(), "keypairs");
const DEPLOYMENT_CONFIG_PATH = resolve(process.cwd(), "config/program-ids.devnet.json");

// SCHEMA_PAYOUT_CLAIMED (roundfi-reputation constants) — the same score-neutral
// schema claim_payout emits, so crank_payout's attestation PDA derives identically.
const SCHEMA_PAYOUT_CLAIMED = 6;
// SCHEMA_CLAIM_NEGLECT (SEV-053 option B) — crank_payout's second attestation:
// the flat penalty on the contemplated member who never self-claimed.
const SCHEMA_CLAIM_NEGLECT = 7;

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf-8"))));
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

// Pool layout (declaration-order Borsh) — only the fields the crank needs.
interface PoolView {
  usdcMint: PublicKey;
  status: number;
  currentCycle: number;
  cyclesTotal: number;
  nextCycleAt: bigint;
  creditAmount: bigint;
}
function decodePool(data: Buffer): PoolView {
  return {
    usdcMint: new PublicKey(data.subarray(48, 80)),
    creditAmount: data.readBigUInt64LE(121),
    cyclesTotal: data.readUInt8(129),
    status: data.readUInt8(145),
    currentCycle: data.readUInt8(154),
    nextCycleAt: data.readBigInt64LE(155),
  };
}
// Member layout — slot_index (104), defaulted (145), paid_out (146).
function decodeMember(data: Buffer): { slotIndex: number; defaulted: boolean; paidOut: boolean } {
  return {
    slotIndex: data.readUInt8(104),
    defaulted: data.readUInt8(145) !== 0,
    paidOut: data.readUInt8(146) !== 0,
  };
}

/** Resolve the stuck member's pubkey: explicit env override, else the demo
 *  keypair on disk for the contemplated slot. */
function resolveMemberWallet(slot: number): PublicKey {
  const env = process.env.CRANK_MEMBER_WALLET;
  if (env) return new PublicKey(env);
  const path = resolve(KEYPAIRS_DIR, `member-${slot}.json`);
  if (existsSync(path)) return loadKeypair(path).publicKey;
  throw new Error(
    `Need the contemplated member's pubkey. Set CRANK_MEMBER_WALLET=<base58>, ` +
      `or provide keypairs/member-${slot}.json.`,
  );
}

async function main() {
  const cluster = loadCluster();
  console.log(`\n━━━ RoundFi crank-payout → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);
  if (cluster.name === "mainnet-beta") {
    throw new Error(
      "Refusing to crank on mainnet via the devnet script — use a deliberate process.",
    );
  }

  const coreProgram = requireProgram(cluster, "core");
  const reputationProgram = requireProgram(cluster, "reputation");

  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  if (!existsSync(walletPath)) throw new Error(`Caller keypair not found at ${walletPath}.`);
  const caller = loadKeypair(walletPath);

  // Pool PDA derives from the recorded deployer pubkey (not necessarily the caller).
  let deployerPubkey = caller.publicKey;
  if (existsSync(DEPLOYMENT_CONFIG_PATH)) {
    const cfg = JSON.parse(readFileSync(DEPLOYMENT_CONFIG_PATH, "utf-8")) as { deployer?: string };
    if (cfg.deployer) deployerPubkey = new PublicKey(cfg.deployer);
  }
  const pool = poolPda(coreProgram, deployerPubkey, POOL_SEED_ID);

  const connection = new Connection(cluster.rpcUrl, "confirmed");
  const poolInfo = await connection.getAccountInfo(pool, "confirmed");
  if (!poolInfo) throw new Error(`Pool not found at ${pool.toBase58()} (seed_id=${POOL_SEED_ID}).`);
  const p = decodePool(poolInfo.data);

  console.log(`→ Caller (perm.) : ${caller.publicKey.toBase58()}`);
  console.log(`→ Pool PDA       : ${pool.toBase58()}`);
  console.log(
    `→ Pool state     : status=${p.status} cycle=${p.currentCycle}/${p.cyclesTotal} ` +
      `credit=${(Number(p.creditAmount) / 1e6).toFixed(2)} USDC`,
  );
  if (p.status !== 1) throw new Error(`Pool is not Active (status=${p.status}). Nothing to crank.`);
  if (p.currentCycle >= p.cyclesTotal) {
    console.log(`✓ Pool past final cycle. Nothing to do.`);
    return;
  }

  const slot = p.currentCycle;
  const memberWallet = resolveMemberWallet(slot);
  const [memberPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), pool.toBuffer(), memberWallet.toBuffer()],
    coreProgram,
  );
  const memberInfo = await connection.getAccountInfo(memberPda, "confirmed");
  if (!memberInfo)
    throw new Error(`Member PDA missing for ${memberWallet.toBase58()} at slot ${slot}.`);
  const m = decodeMember(memberInfo.data);
  console.log(`→ Contemplated   : slot ${slot} · ${memberWallet.toBase58()}`);

  if (m.slotIndex !== slot) throw new Error(`Member slot ${m.slotIndex} != current cycle ${slot}.`);
  if (m.paidOut) {
    console.log(`✓ Slot ${slot} already paid out. Nothing to do.`);
    return;
  }
  if (m.defaulted) {
    throw new Error(`Member is defaulted — use skip_defaulted_payout, not crank_payout.`);
  }

  // Grace pre-check (friendly message; the program also enforces it). The
  // deployed devnet is a vanilla build (GRACE_PERIOD_SECS = 604_800); a
  // `devnet-canary` build lowers it to 86_400 — set CRANK_GRACE_SECS to override
  // the local pre-check if you deployed the canary variant.
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const GRACE = process.env.CRANK_GRACE_SECS ? BigInt(process.env.CRANK_GRACE_SECS) : 604_800n;
  const deadline = p.nextCycleAt + GRACE;
  if (nowSec < deadline) {
    const hrs = Number(deadline - nowSec) / 3600;
    throw new Error(
      `Self-claim grace still open — crank_payout is callable in ~${hrs.toFixed(1)}h ` +
        `(at unix ${deadline}). Until then the member should claim_payout themselves.`,
    );
  }

  // ─── Encode crank_payout(cycle) ─────────────────────────────────────
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);
  const memberUsdc = getAssociatedTokenAddressSync(p.usdcMint, memberWallet);
  const poolUsdcVault = getAssociatedTokenAddressSync(p.usdcMint, pool, true);
  const [reputationConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("rep-config")],
    reputationProgram,
  );
  const [reputationProfile] = PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), memberWallet.toBuffer()],
    reputationProgram,
  );
  const nonce = (BigInt(slot) << 32n) | BigInt(slot);
  const attestation = attestationPda(
    reputationProgram,
    pool,
    memberWallet,
    SCHEMA_PAYOUT_CLAIMED,
    nonce,
  );
  // SEV-053 option B: crank_payout also mints a CLAIM_NEGLECT attestation
  // (schema 7) on the contemplated member — same nonce, distinct schema seed.
  const neglectAttestation = attestationPda(
    reputationProgram,
    pool,
    memberWallet,
    SCHEMA_CLAIM_NEGLECT,
    nonce,
  );
  const identityRecord = reputationProgram; // "None" sentinel

  const data = Buffer.concat([anchorIxDiscriminator("crank_payout"), Buffer.from([slot & 0xff])]);

  // Account order MUST match `CrankPayout` in
  // programs/roundfi-core/src/instructions/crank_payout.rs:
  //   caller(S,mut), config, pool(mut), member(mut), member_wallet(read),
  //   usdc_mint, member_usdc(mut), pool_usdc_vault(mut), token_program,
  //   reputation_program, reputation_config(mut), reputation_profile(mut),
  //   identity_record, attestation(mut), neglect_attestation(mut),
  //   system_program
  const ix = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: caller.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: memberPda, isSigner: false, isWritable: true },
      { pubkey: memberWallet, isSigner: false, isWritable: false },
      { pubkey: p.usdcMint, isSigner: false, isWritable: false },
      { pubkey: memberUsdc, isSigner: false, isWritable: true },
      { pubkey: poolUsdcVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: reputationProgram, isSigner: false, isWritable: false },
      { pubkey: reputationConfig, isSigner: false, isWritable: true },
      { pubkey: reputationProfile, isSigner: false, isWritable: true },
      { pubkey: identityRecord, isSigner: false, isWritable: false },
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: neglectAttestation, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const pre = await getAccount(connection, memberUsdc, "confirmed").catch(() => null);
  const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
  const tx = new Transaction().add(cu, ix);
  const sig = await connection.sendTransaction(tx, [caller], { preflightCommitment: "confirmed" });
  await connection.confirmTransaction(sig, "confirmed");

  const post = await getAccount(connection, memberUsdc, "confirmed");
  const delta = post.amount - (pre?.amount ?? 0n);
  console.log(`\n✓ crank_payout(${slot}) — cycle advanced, pool unstuck.`);
  console.log(`  delivered to member ATA: +${(Number(delta) / 1e6).toFixed(2)} USDC`);
  console.log(`  signature : https://solscan.io/tx/${sig}?cluster=devnet\n`);
}

main().catch((e) => {
  console.error("\n✗ crank-payout failed:");
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

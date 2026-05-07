/**
 * Seed members into the demo Pool created by `pnpm devnet:seed`.
 *
 * Onboards three test wallets via `roundfi_core.join_pool(...)`,
 * each one minting a Metaplex Core position NFT and depositing the
 * Lv1 stake (50% of credit_amount = 15 USDC per member) into the
 * pool's escrow vault.
 *
 * Why Lv1 and not Lv2/Lv3:
 *   The on-chain handler validates `args.reputation_level ==
 *   trusted_level` where trusted_level is read from the
 *   `ReputationProfile` PDA (or defaults to 1 for uninitialized
 *   profiles). Bumping a fresh wallet to Lv2/Lv3 would require an
 *   `attest()` flow from the core program (CPI-only). Sticking with
 *   Lv1 lets us skip `init_profile` entirely and ship the demo with
 *   3 join_pool ixs, period.
 *
 * Manual instruction encoding (no Anchor SDK runtime — IDL gen still
 * blocked on the toolchain bump documented in `init-protocol.ts`).
 *
 * Pre-flight requirements (script enforces with helpful errors):
 *   1. Pool exists at the deterministic PDA (created by seed-pool).
 *   2. Deployer has ≥ 0.5 SOL to airdrop to the 3 member wallets.
 *   3. Each member has ≥ 15 USDC. If not, prints the Circle faucet URL
 *      with the member pubkey pre-filled.
 *
 * Member keypairs are persisted to `keypairs/member-{1..3}.json` so
 * re-running is idempotent: existing Member PDAs short-circuit the join.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";

import { loadCluster, requireProgram } from "../../config/clusters.js";

// Pool params must match what `seed-pool.ts` created.
const POOL_SEED_ID = 1n;
const CREDIT_AMOUNT_BASE = 30_000_000n; // 30 USDC ×1e6
const REPUTATION_LEVEL = 1; // Lv1 — fresh wallets default to this
const STAKE_BPS_LV1 = 5_000n; // 50% of credit
const STAKE_AMOUNT_BASE = (CREDIT_AMOUNT_BASE * STAKE_BPS_LV1) / 10_000n; // 15 USDC = 15_000_000

// Member SOL budget — covers tx fee + Member PDA rent (~0.003) + NFT
// asset rent (~0.005) + ATA rent (~0.002). 0.1 SOL is comfortable.
const MEMBER_SOL_BUDGET_LAMPORTS = 100_000_000n; // 0.1 SOL

// Metaplex Core on devnet (same address everywhere; pinned by ProtocolConfig).
const METAPLEX_CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

const MEMBER_COUNT = 3;
const KEYPAIRS_DIR = resolve(process.cwd(), "keypairs");

function loadKeypair(path: string): Keypair {
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

function saveKeypair(path: string, kp: Keypair): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), "utf-8");
}

function loadOrCreateMember(slotIndex: number): Keypair {
  const path = resolve(KEYPAIRS_DIR, `member-${slotIndex}.json`);
  if (existsSync(path)) return loadKeypair(path);
  const kp = Keypair.generate();
  saveKeypair(path, kp);
  console.log(`  + generated keypairs/member-${slotIndex}.json`);
  return kp;
}

function anchorIxDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function encodeU8(value: number): Buffer {
  return Buffer.from([value & 0xff]);
}

function encodeBorshString(value: string): Buffer {
  // Borsh string = 4-byte LE length (u32) + UTF-8 bytes.
  const utf8 = Buffer.from(value, "utf-8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(utf8.length, 0);
  return Buffer.concat([len, utf8]);
}

async function ensureMemberSol(
  connection: Connection,
  deployer: Keypair,
  member: PublicKey,
  slot: number,
): Promise<void> {
  const balance = await connection.getBalance(member, "confirmed");
  if (BigInt(balance) >= MEMBER_SOL_BUDGET_LAMPORTS) return;

  const topUp = MEMBER_SOL_BUDGET_LAMPORTS - BigInt(balance);
  console.log(
    `  → top-up SOL: member ${slot} has ${(balance / 1e9).toFixed(4)} SOL, ` +
      `transferring ${(Number(topUp) / 1e9).toFixed(4)} from deployer`,
  );
  const ix = SystemProgram.transfer({
    fromPubkey: deployer.publicKey,
    toPubkey: member,
    lamports: Number(topUp),
  });
  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [deployer], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");
}

async function ensureMemberUsdc(
  connection: Connection,
  deployer: Keypair,
  member: PublicKey,
  usdcMint: PublicKey,
  slot: number,
): Promise<{ memberAta: PublicKey; balance: bigint }> {
  const memberAta = getAssociatedTokenAddressSync(usdcMint, member);
  const memberAtaInfo = await connection.getAccountInfo(memberAta, "confirmed");
  if (!memberAtaInfo) {
    console.log(`  → creating member ${slot} USDC ATA ${memberAta.toBase58()}`);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        deployer.publicKey,
        memberAta,
        member,
        usdcMint,
      ),
    );
    const sig = await connection.sendTransaction(tx, [deployer], {
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(sig, "confirmed");
  }
  const account = await getAccount(connection, memberAta, "confirmed");
  return { memberAta, balance: account.amount };
}

function poolPda(coreProgram: PublicKey, deployer: PublicKey, seedId: bigint): PublicKey {
  const seedIdLe = Buffer.alloc(8);
  seedIdLe.writeBigUInt64LE(seedId, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), deployer.toBuffer(), seedIdLe],
    coreProgram,
  )[0];
}

async function callJoinPool(
  connection: Connection,
  member: Keypair,
  slotIndex: number,
  coreProgram: PublicKey,
  reputationProgram: PublicKey,
  pool: PublicKey,
  usdcMint: PublicKey,
  memberUsdc: PublicKey,
): Promise<{ signature: string; memberPda: PublicKey } | { skipped: true; memberPda: PublicKey }> {
  const [memberPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), pool.toBuffer(), member.publicKey.toBuffer()],
    coreProgram,
  );

  const existing = await connection.getAccountInfo(memberPda, "confirmed");
  if (existing) {
    console.log(`  → Member PDA ${memberPda.toBase58()} already exists — skipping`);
    return { skipped: true, memberPda };
  }

  const [protocolConfig] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);
  const [escrowAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), pool.toBuffer()],
    coreProgram,
  );
  const escrowVault = getAssociatedTokenAddressSync(usdcMint, escrowAuthority, true);
  const [positionAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), pool.toBuffer(), Uint8Array.of(slotIndex)],
    coreProgram,
  );
  // Reputation Profile PDA seed = b"reputation" (constants.rs::SEED_PROFILE).
  const [reputationProfile] = PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), member.publicKey.toBuffer()],
    reputationProgram,
  );

  const nftAsset = Keypair.generate();
  const metadataUri = `https://roundfinancial.vercel.app/position/${slotIndex}.json`;

  const data = Buffer.concat([
    anchorIxDiscriminator("join_pool"),
    encodeU8(slotIndex),
    encodeU8(REPUTATION_LEVEL),
    encodeBorshString(metadataUri),
  ]);

  // Account list — order MUST match `JoinPool` in
  // programs/roundfi-core/src/instructions/join_pool.rs:
  //   1.  member_wallet              (signer, mut)
  //   2.  config                     (PDA, read)
  //   3.  pool                       (PDA, mut)
  //   4.  member                     (PDA, mut, init)
  //   5.  usdc_mint                  (read)
  //   6.  member_usdc                (mut, TokenAccount)
  //   7.  escrow_vault_authority     (PDA, read)
  //   8.  escrow_vault               (mut, TokenAccount)
  //   9.  position_authority         (PDA, read)
  //  10.  nft_asset                  (signer, mut, fresh keypair)
  //  11.  metaplex_core              (read)
  //  12.  reputation_program         (read)
  //  13.  reputation_profile         (read, may be uninit)
  //  14.  token_program              (read)
  //  15.  associated_token_program   (read)
  //  16.  system_program             (read)
  //  17.  rent sysvar                (read)
  const ix = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: member.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: memberPda, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: memberUsdc, isSigner: false, isWritable: true },
      { pubkey: escrowAuthority, isSigner: false, isWritable: false },
      { pubkey: escrowVault, isSigner: false, isWritable: true },
      { pubkey: positionAuthority, isSigner: false, isWritable: false },
      { pubkey: nftAsset.publicKey, isSigner: true, isWritable: true },
      { pubkey: METAPLEX_CORE_ID, isSigner: false, isWritable: false },
      { pubkey: reputationProgram, isSigner: false, isWritable: false },
      { pubkey: reputationProfile, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });

  // Metaplex Core CreateV2 + 2 plugins is CU-heavy; bump well above
  // the 200k default.
  const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
  const tx = new Transaction().add(cu, ix);
  const signature = await connection.sendTransaction(tx, [member, nftAsset], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");
  return { signature, memberPda };
}

async function main() {
  const cluster = loadCluster();
  console.log(`\n━━━ RoundFi seed-members → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);
  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to seed members on mainnet — use a deliberate process.");
  }

  const coreProgram = requireProgram(cluster, "core");
  const reputationProgram = requireProgram(cluster, "reputation");
  const usdcMint = cluster.usdcMint;

  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  const deployer = loadKeypair(walletPath);
  const pool = poolPda(coreProgram, deployer.publicKey, POOL_SEED_ID);

  console.log(`→ Cluster      : ${cluster.name}`);
  console.log(`→ Deployer     : ${deployer.publicKey.toBase58()}`);
  console.log(`→ Pool PDA     : ${pool.toBase58()}`);
  console.log(`→ USDC mint    : ${usdcMint.toBase58()}`);
  console.log(`→ Member count : ${MEMBER_COUNT}`);
  console.log(
    `→ Stake/member : ${(Number(STAKE_AMOUNT_BASE) / 1e6).toFixed(2)} USDC (Lv1, 50% of credit)\n`,
  );

  const connection = new Connection(cluster.rpcUrl, "confirmed");

  // Pre-flight: pool must exist.
  const poolInfo = await connection.getAccountInfo(pool, "confirmed");
  if (!poolInfo) {
    throw new Error(
      `Pool not found at ${pool.toBase58()}. Run 'pnpm devnet:seed' first to create it.`,
    );
  }

  // Pre-flight: deployer SOL — needs to fund 3 members at 0.1 each.
  const deployerBal = await connection.getBalance(deployer.publicKey);
  if (deployerBal < 0.5 * 1e9) {
    throw new Error(
      `Deployer needs ≥ 0.5 SOL. Currently has ${(deployerBal / 1e9).toFixed(4)} SOL. Airdrop more.`,
    );
  }
  console.log(`→ Deployer balance: ${(deployerBal / 1e9).toFixed(4)} SOL\n`);

  // Generate / load 3 member keypairs.
  console.log(`Step 1/3 — member keypairs:`);
  const members: Keypair[] = [];
  for (let i = 0; i < MEMBER_COUNT; i++) {
    const m = loadOrCreateMember(i);
    console.log(`  member ${i}: ${m.publicKey.toBase58()}`);
    members.push(m);
  }
  console.log("");

  // SOL airdrop / top-up each member from deployer.
  console.log(`Step 2/3 — fund members with SOL + USDC:`);
  for (let i = 0; i < MEMBER_COUNT; i++) {
    await ensureMemberSol(connection, deployer, members[i]!.publicKey, i);
    const { memberAta, balance } = await ensureMemberUsdc(
      connection,
      deployer,
      members[i]!.publicKey,
      usdcMint,
      i,
    );
    console.log(
      `  member ${i} USDC: ${(Number(balance) / 1e6).toFixed(2)} (need ${(Number(STAKE_AMOUNT_BASE) / 1e6).toFixed(2)})` +
        (balance < STAKE_AMOUNT_BASE
          ? `\n      ⚠ insufficient — fund via https://faucet.circle.com (use ${members[i]!.publicKey.toBase58()})`
          : ""),
    );
    void memberAta;
  }
  console.log("");

  // Stop early if any member is short on USDC — user needs to faucet.
  const insufficient: number[] = [];
  for (let i = 0; i < MEMBER_COUNT; i++) {
    const ata = getAssociatedTokenAddressSync(usdcMint, members[i]!.publicKey);
    const acct = await getAccount(connection, ata, "confirmed");
    if (acct.amount < STAKE_AMOUNT_BASE) insufficient.push(i);
  }
  if (insufficient.length > 0) {
    console.log(
      `✗ Members [${insufficient.join(", ")}] are short on USDC. ` +
        `Fund each via https://faucet.circle.com (one request = 10 USDC; need ` +
        `${(Number(STAKE_AMOUNT_BASE) / 1e6).toFixed(2)} per member ⇒ 2 hits each).`,
    );
    console.log(`   Re-run this script after the faucet hits land on each member's ATA.\n`);
    process.exit(1);
  }

  // Per-member join_pool.
  console.log(`Step 3/3 — calling join_pool for each member:`);
  const results: { slot: number; sig: string | null; memberPda: PublicKey }[] = [];
  for (let i = 0; i < MEMBER_COUNT; i++) {
    console.log(`\n→ member ${i} (${members[i]!.publicKey.toBase58().slice(0, 8)}…)`);
    const ata = getAssociatedTokenAddressSync(usdcMint, members[i]!.publicKey);
    const result = await callJoinPool(
      connection,
      members[i]!,
      i,
      coreProgram,
      reputationProgram,
      pool,
      usdcMint,
      ata,
    );
    if ("skipped" in result) {
      console.log(`  ✓ already joined`);
      results.push({ slot: i, sig: null, memberPda: result.memberPda });
    } else {
      console.log(`  ✓ joined`);
      console.log(`    Member PDA: ${result.memberPda.toBase58()}`);
      console.log(`    signature : ${result.signature}`);
      results.push({ slot: i, sig: result.signature, memberPda: result.memberPda });
    }
  }

  console.log(`\n━━━ done ━━━\n`);
  console.log(`Solscan (devnet):`);
  console.log(`  https://solscan.io/account/${pool.toBase58()}?cluster=devnet`);
  for (const r of results) {
    console.log(
      `  https://solscan.io/account/${r.memberPda.toBase58()}?cluster=devnet (member ${r.slot})`,
    );
    if (r.sig) {
      console.log(`  https://solscan.io/tx/${r.sig}?cluster=devnet`);
    }
  }
  console.log("");
}

main().catch((e) => {
  console.error("\n✗ seed-members failed:");
  console.error(e);
  process.exit(1);
});

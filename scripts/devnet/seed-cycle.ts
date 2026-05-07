/**
 * Drive cycle 0 of the demo Pool: each of the 3 members calls
 * `roundfi_core.contribute(...)` for the current cycle, paying their
 * 10 USDC installment. The handler splits each installment into:
 *   - solidarity vault (1% by default)
 *   - escrow vault (escrow_release_bps fraction = 25%)
 *   - pool float (remainder = 74%)
 *
 * It also fires a reputation attestation CPI per contribute — schema
 * is `SCHEMA_PAYMENT` if the contribution lands BEFORE pool.next_cycle_at,
 * `SCHEMA_LATE` otherwise. We derive the attestation PDA accordingly.
 *
 * Manual instruction encoding (no Anchor SDK runtime — IDL gen still
 * blocked on the toolchain bump documented in `init-protocol.ts`).
 *
 * Pre-flight requirements:
 *   1. Pool exists and is Active (3 members joined). Validates by reading
 *      pool.status == 1 from chain.
 *   2. Each of the 3 member keypairs is on disk under `keypairs/member-{0..2}.json`
 *      (created by `pnpm devnet:seed-members`).
 *   3. Each member has ≥ 10 USDC for the installment. If not, prints the
 *      Circle faucet URL with the member pubkey pre-filled.
 *
 * Idempotent: reads each Member PDA's `contributions_paid` field — if
 * already at or past pool.current_cycle, skips the call.
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
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";

import { loadCluster, requireProgram } from "../../config/clusters.js";

// Pool params must match what `seed-pool.ts` created.
const POOL_SEED_ID = 1n;
const INSTALLMENT_AMOUNT_BASE = 10_000_000n; // 10 USDC ×1e6
const DEPLOYMENT_CONFIG_PATH = resolve(process.cwd(), "config/program-ids.devnet.json");

const MEMBER_COUNT = 3;
const KEYPAIRS_DIR = resolve(process.cwd(), "keypairs");

// Reputation schema ids (mirror programs/roundfi-reputation/src/constants.rs).
const SCHEMA_PAYMENT: number = 1;
const SCHEMA_LATE: number = 2;

function loadKeypair(path: string): Keypair {
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

function loadMemberKeypair(slot: number): Keypair {
  const path = resolve(KEYPAIRS_DIR, `member-${slot}.json`);
  if (!existsSync(path)) {
    throw new Error(`Missing keypairs/member-${slot}.json — run 'pnpm devnet:seed-members' first.`);
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

/** Borsh-encoded Pool state — partial read for the fields we need. */
interface PoolView {
  membersJoined: number;
  status: number;
  currentCycle: number;
  nextCycleAt: bigint;
  cyclesTotal: number;
}

/**
 * Anchor accounts use Borsh: 8-byte discriminator + sequential fields
 * in declaration order, no padding. Layout snapshot of `Pool`:
 *   off  8: authority           Pubkey  (32)
 *   off 40: seed_id             u64     ( 8)
 *   off 48: usdc_mint           Pubkey  (32)
 *   off 80: yield_adapter       Pubkey  (32)
 *   off 112: members_target     u8      ( 1)
 *   off 113: installment_amount u64     ( 8)
 *   off 121: credit_amount      u64     ( 8)
 *   off 129: cycles_total       u8      ( 1)
 *   off 130: cycle_duration     i64     ( 8)
 *   off 138: seed_draw_bps      u16     ( 2)
 *   off 140: solidarity_bps     u16     ( 2)
 *   off 142: escrow_release_bps u16     ( 2)
 *   off 144: members_joined     u8      ( 1)
 *   off 145: status             u8      ( 1)
 *   off 146: started_at         i64     ( 8)
 *   off 154: current_cycle      u8      ( 1)
 *   off 155: next_cycle_at      i64     ( 8)
 */
function decodePool(data: Buffer): PoolView {
  return {
    cyclesTotal: data.readUInt8(129),
    membersJoined: data.readUInt8(144),
    status: data.readUInt8(145),
    currentCycle: data.readUInt8(154),
    nextCycleAt: data.readBigInt64LE(155),
  };
}

/**
 * Layout snapshot of `Member`:
 *   off  8: pool                Pubkey  (32)
 *   off 40: wallet              Pubkey  (32)
 *   off 72: nft_asset           Pubkey  (32)
 *   off 104: slot_index         u8      ( 1)
 *   off 105: reputation_level   u8      ( 1)
 *   off 106: stake_bps          u16     ( 2)
 *   off 108: stake_deposited    u64     ( 8)
 *   off 116: contributions_paid u8      ( 1)
 */
function decodeMemberContributionsPaid(data: Buffer): number {
  return data.readUInt8(116);
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

async function callContribute(
  connection: Connection,
  member: Keypair,
  slotIndex: number,
  cycle: number,
  schemaId: number,
  coreProgram: PublicKey,
  reputationProgram: PublicKey,
  pool: PublicKey,
  usdcMint: PublicKey,
  memberUsdc: PublicKey,
  memberPda: PublicKey,
): Promise<string> {
  const [protocolConfig] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);
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
    [Buffer.from("reputation"), member.publicKey.toBuffer()],
    reputationProgram,
  );

  // Nonce mirrors handler logic in contribute.rs:
  //   nonce = ((cycle as u64) << 32) | (slot_index as u64)
  const nonce = (BigInt(cycle) << 32n) | BigInt(slotIndex);
  const attestation = attestationPda(reputationProgram, pool, member.publicKey, schemaId, nonce);

  // identity_record == reputation_program itself signals "None" per
  // Anchor's Option<Account> convention (matches contribute.rs:255-260).
  const identityRecord = reputationProgram;

  const data = Buffer.concat([anchorIxDiscriminator("contribute"), encodeU8(cycle)]);

  // Account list — order MUST match `Contribute` in
  // programs/roundfi-core/src/instructions/contribute.rs:
  //   1.  member_wallet            (signer, mut)
  //   2.  config                   (PDA, read)
  //   3.  pool                     (PDA, mut)
  //   4.  member                   (PDA, mut)
  //   5.  usdc_mint                (read)
  //   6.  member_usdc              (mut, TokenAccount)
  //   7.  pool_usdc_vault          (mut, TokenAccount)
  //   8.  solidarity_vault_authority (PDA, read)
  //   9.  solidarity_vault         (mut, TokenAccount)
  //  10.  escrow_vault_authority   (PDA, read)
  //  11.  escrow_vault             (mut, TokenAccount)
  //  12.  token_program            (read)
  //  13.  reputation_program       (read)
  //  14.  reputation_config        (mut, UncheckedAccount)
  //  15.  reputation_profile       (mut, UncheckedAccount, init_if_needed inside CPI)
  //  16.  identity_record          (read; reputation_program ≡ None)
  //  17.  attestation              (mut, UncheckedAccount, init by reputation::attest)
  //  18.  system_program           (read)
  const ix = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: member.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: memberPda, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: memberUsdc, isSigner: false, isWritable: true },
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

  // Three SPL transfers + reputation CPI (init Attestation PDA + writes)
  // — bump CU above the 200k default to leave headroom.
  const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
  const tx = new Transaction().add(cu, ix);
  const signature = await connection.sendTransaction(tx, [member], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}

async function main() {
  const cluster = loadCluster();
  console.log(`\n━━━ RoundFi seed-cycle → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);
  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to drive cycle on mainnet — use a deliberate process.");
  }

  const coreProgram = requireProgram(cluster, "core");
  const reputationProgram = requireProgram(cluster, "reputation");
  const usdcMint = cluster.usdcMint;

  // Drivers don't need to sign with the deployer — they sign with member
  // keypairs. We only need the deployer pubkey to derive the Pool PDA.
  // Prefer the deployer keypair on disk if present (matches other seed
  // scripts); fall back to the recorded pubkey in program-ids.devnet.json.
  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  let deployerPubkey: PublicKey;
  if (existsSync(walletPath)) {
    deployerPubkey = loadKeypair(walletPath).publicKey;
  } else if (existsSync(DEPLOYMENT_CONFIG_PATH)) {
    const cfg = JSON.parse(readFileSync(DEPLOYMENT_CONFIG_PATH, "utf-8")) as { deployer?: string };
    if (!cfg.deployer) {
      throw new Error(`config/program-ids.devnet.json missing 'deployer' pubkey.`);
    }
    deployerPubkey = new PublicKey(cfg.deployer);
  } else {
    throw new Error(
      `Cannot resolve deployer pubkey: neither ${walletPath} nor ${DEPLOYMENT_CONFIG_PATH} found.`,
    );
  }
  const pool = poolPda(coreProgram, deployerPubkey, POOL_SEED_ID);

  console.log(`→ Cluster      : ${cluster.name}`);
  console.log(`→ Deployer     : ${deployerPubkey.toBase58()}`);
  console.log(`→ Pool PDA     : ${pool.toBase58()}`);
  console.log(`→ USDC mint    : ${usdcMint.toBase58()}`);
  console.log(`→ Member count : ${MEMBER_COUNT}`);
  console.log(
    `→ Installment  : ${(Number(INSTALLMENT_AMOUNT_BASE) / 1e6).toFixed(2)} USDC per member\n`,
  );

  const connection = new Connection(cluster.rpcUrl, "confirmed");

  // Pre-flight: pool must exist + be Active.
  const poolInfo = await connection.getAccountInfo(pool, "confirmed");
  if (!poolInfo) {
    throw new Error(
      `Pool not found at ${pool.toBase58()}. Run 'pnpm devnet:seed' + 'pnpm devnet:seed-members' first.`,
    );
  }
  const poolView = decodePool(poolInfo.data);
  console.log(
    `→ Pool state   : status=${poolView.status} ` +
      `members=${poolView.membersJoined}/${MEMBER_COUNT} ` +
      `cycle=${poolView.currentCycle}/${poolView.cyclesTotal} ` +
      `next_cycle_at=${poolView.nextCycleAt}`,
  );
  if (poolView.status !== 1) {
    throw new Error(`Pool is not Active (status=${poolView.status}). Need 3 members joined first.`);
  }
  if (poolView.currentCycle >= poolView.cyclesTotal) {
    console.log(
      `✓ Pool already past final cycle (${poolView.currentCycle}/${poolView.cyclesTotal}). Nothing to do.`,
    );
    return;
  }

  // Decide on_time vs late once for all 3 — they all submit in the same
  // window, so they get the same schema. Use cluster blockTime, not local
  // wall clock, to match what the on-chain Clock sysvar will see.
  const slot = await connection.getSlot("confirmed");
  const blockTime = await connection.getBlockTime(slot);
  if (blockTime == null) {
    throw new Error("Could not read block time from cluster — try again.");
  }
  const onTime = BigInt(blockTime) <= poolView.nextCycleAt;
  const schemaId = onTime ? SCHEMA_PAYMENT : SCHEMA_LATE;
  console.log(
    `→ Now (chain)  : ${blockTime}  ⇒  ${onTime ? "ON-TIME" : "LATE"} ` +
      `(schema=${schemaId === SCHEMA_PAYMENT ? "PAYMENT" : "LATE"})\n`,
  );

  const targetCycle = poolView.currentCycle;
  const results: { slot: number; sig: string | null; reason: string }[] = [];

  for (let i = 0; i < MEMBER_COUNT; i++) {
    const member = loadMemberKeypair(i);
    console.log(`\n→ member ${i} (${member.publicKey.toBase58().slice(0, 8)}…)`);

    const [memberPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("member"), pool.toBuffer(), member.publicKey.toBuffer()],
      coreProgram,
    );

    const memberInfo = await connection.getAccountInfo(memberPda, "confirmed");
    if (!memberInfo) {
      console.log(`  ⚠ Member PDA missing — run 'pnpm devnet:seed-members' first`);
      results.push({ slot: i, sig: null, reason: "member-pda-missing" });
      continue;
    }
    const contribsPaid = decodeMemberContributionsPaid(memberInfo.data);
    if (contribsPaid > targetCycle) {
      console.log(
        `  ✓ already contributed for cycle ${targetCycle} (paid=${contribsPaid}) — skipping`,
      );
      results.push({ slot: i, sig: null, reason: "already-paid" });
      continue;
    }

    // USDC balance check.
    const memberAta = getAssociatedTokenAddressSync(usdcMint, member.publicKey);
    const ataAcct = await getAccount(connection, memberAta, "confirmed");
    if (ataAcct.amount < INSTALLMENT_AMOUNT_BASE) {
      console.log(
        `  ✗ insufficient USDC: has ${(Number(ataAcct.amount) / 1e6).toFixed(2)}, ` +
          `needs ${(Number(INSTALLMENT_AMOUNT_BASE) / 1e6).toFixed(2)}`,
      );
      console.log(`    fund via https://faucet.circle.com (use ${member.publicKey.toBase58()})`);
      results.push({ slot: i, sig: null, reason: "insufficient-usdc" });
      continue;
    }

    try {
      const sig = await callContribute(
        connection,
        member,
        i,
        targetCycle,
        schemaId,
        coreProgram,
        reputationProgram,
        pool,
        usdcMint,
        memberAta,
        memberPda,
      );
      console.log(`  ✓ contributed cycle ${targetCycle}`);
      console.log(`    signature : ${sig}`);
      results.push({ slot: i, sig, reason: "ok" });
    } catch (e) {
      console.log(`  ✗ contribute failed:`);
      console.log(`    ${(e as Error).message}`);
      results.push({ slot: i, sig: null, reason: "tx-failed" });
    }
  }

  console.log(`\n━━━ done ━━━\n`);
  console.log(`Solscan (devnet):`);
  console.log(`  https://solscan.io/account/${pool.toBase58()}?cluster=devnet`);
  for (const r of results) {
    if (r.sig) {
      console.log(`  member ${r.slot}: https://solscan.io/tx/${r.sig}?cluster=devnet`);
    } else {
      console.log(`  member ${r.slot}: ${r.reason}`);
    }
  }
  console.log("");
}

main().catch((e) => {
  console.error("\n✗ seed-cycle failed:");
  console.error(e);
  process.exit(1);
});

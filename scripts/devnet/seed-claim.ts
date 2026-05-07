/**
 * Drive the cycle-0 payout: slot 0's winner calls
 * `roundfi_core.claim_payout(0)`. The handler transfers
 * `pool.credit_amount` from `pool_usdc_vault` to the winner's USDC ATA,
 * sets `member.paid_out = true`, and advances `pool.current_cycle` to 1
 * (refreshing `pool.next_cycle_at`). Also fires a CycleComplete
 * reputation attestation (`SCHEMA_CYCLE_COMPLETE = 4`).
 *
 * Liquidity gap pre-handling:
 *   With the demo pool params (3 members × $10 installment × 3 cycles,
 *   credit = $30) the contribute split routes 26% (1% solidarity + 25%
 *   escrow) out of pool_usdc_vault. After cycle 0 the pool float
 *   carries 3 × $7.40 = $22.20, but the on-chain WaterfallUnderflow
 *   guard requires `spendable >= credit_amount`. To unblock the demo
 *   without changing protocol params, this driver tops up the
 *   pool_usdc_vault from the deployer's USDC ATA when a gap exists.
 *   In production this gap is bridged by the Yield Cascade (LP
 *   distribution → pool float); the manual top-up here just stands in
 *   for that flow until `deposit_idle_to_yield` + `harvest_yield` are
 *   driven on-chain.
 *
 * Manual instruction encoding (no Anchor SDK runtime — IDL gen still
 * blocked on the toolchain bump documented in `init-protocol.ts`).
 *
 * Idempotent: reads `Member.paid_out` and skips if already true.
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
import {
  TOKEN_PROGRAM_ID,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";

import { loadCluster, requireProgram } from "../../config/clusters.js";

// Pool params must match what `seed-pool.ts` created.
const POOL_SEED_ID = process.env.POOL_SEED_ID ? BigInt(process.env.POOL_SEED_ID) : 1n;
const DEPLOYMENT_CONFIG_PATH = resolve(process.cwd(), "config/program-ids.devnet.json");
const KEYPAIRS_DIR = resolve(process.cwd(), "keypairs");

// Reputation schema id (mirror programs/roundfi-reputation/src/constants.rs).
const SCHEMA_CYCLE_COMPLETE: number = 4;

// Small extra cushion above the strict gap so the tx survives
// concurrent rounding / timestamp drift on the cluster's view of the
// vault. Cheap in USDC base units.
const TOPUP_CUSHION_BASE = 1n; // 0.000001 USDC

function loadKeypair(path: string): Keypair {
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

const MEMBER_INDEX_OFFSET = process.env.MEMBER_INDEX_OFFSET
  ? Number(process.env.MEMBER_INDEX_OFFSET)
  : 0;

function loadMemberKeypair(slot: number): Keypair {
  const path = resolve(KEYPAIRS_DIR, `member-${slot + MEMBER_INDEX_OFFSET}.json`);
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
  cyclesTotal: number;
  creditAmount: bigint;
  guaranteeFundBalance: bigint;
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
 *   off 163: total_contributed  u64     ( 8)
 *   off 171: total_paid_out     u64     ( 8)
 *   off 179: solidarity_balance u64     ( 8)
 *   off 187: escrow_balance     u64     ( 8)
 *   off 195: yield_accrued      u64     ( 8)
 *   off 203: guarantee_fund_balance u64 ( 8)
 */
function decodePool(data: Buffer): PoolView {
  return {
    creditAmount: data.readBigUInt64LE(121),
    cyclesTotal: data.readUInt8(129),
    membersJoined: data.readUInt8(144),
    status: data.readUInt8(145),
    currentCycle: data.readUInt8(154),
    guaranteeFundBalance: data.readBigUInt64LE(203),
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
 *   off 117: total_contributed  u64     ( 8)
 *   off 125: total_received     u64     ( 8)
 *   off 133: escrow_balance     u64     ( 8)
 *   off 141: on_time_count      u16     ( 2)
 *   off 143: late_count         u16     ( 2)
 *   off 145: defaulted          bool    ( 1)
 *   off 146: paid_out           bool    ( 1)
 */
function decodeMemberPaidOut(data: Buffer): boolean {
  return data.readUInt8(146) !== 0;
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

async function topUpPoolFloatIfNeeded(
  connection: Connection,
  pool: PublicKey,
  poolUsdcVault: PublicKey,
  poolView: PoolView,
  usdcMint: PublicKey,
  deployerKeypairPath: string,
): Promise<{ topUpSig?: string; topUpAmountBase?: bigint }> {
  const vaultAcct = await getAccount(connection, poolUsdcVault, "confirmed");
  const vaultAmount = vaultAcct.amount;
  const spendable =
    vaultAmount > poolView.guaranteeFundBalance ? vaultAmount - poolView.guaranteeFundBalance : 0n;

  if (spendable >= poolView.creditAmount) {
    console.log(
      `→ Pool float OK : spendable=${(Number(spendable) / 1e6).toFixed(2)} USDC ` +
        `>= credit=${(Number(poolView.creditAmount) / 1e6).toFixed(2)} — no top-up needed`,
    );
    return {};
  }

  const gap = poolView.creditAmount - spendable + TOPUP_CUSHION_BASE;
  console.log(
    `→ Pool float gap: spendable=${(Number(spendable) / 1e6).toFixed(2)} USDC, ` +
      `credit=${(Number(poolView.creditAmount) / 1e6).toFixed(2)} ⇒ ` +
      `topping up ${(Number(gap) / 1e6).toFixed(6)} USDC from deployer`,
  );

  if (!existsSync(deployerKeypairPath)) {
    throw new Error(
      `Deployer keypair not found at ${deployerKeypairPath}. ` +
        `Cannot top-up pool float without it. Set ANCHOR_WALLET to the deployer's keypair path.`,
    );
  }
  const deployer = loadKeypair(deployerKeypairPath);
  const deployerAta = getAssociatedTokenAddressSync(usdcMint, deployer.publicKey);
  const deployerAcct = await getAccount(connection, deployerAta, "confirmed").catch(() => null);
  if (!deployerAcct) {
    throw new Error(
      `Deployer USDC ATA ${deployerAta.toBase58()} does not exist. ` +
        `Faucet USDC to ${deployer.publicKey.toBase58()} via https://faucet.circle.com (devnet) and re-run.`,
    );
  }
  if (deployerAcct.amount < gap) {
    throw new Error(
      `Deployer has only ${(Number(deployerAcct.amount) / 1e6).toFixed(2)} USDC; ` +
        `need ${(Number(gap) / 1e6).toFixed(6)} for the top-up. ` +
        `Faucet more to ${deployer.publicKey.toBase58()} via https://faucet.circle.com (devnet) and re-run.`,
    );
  }

  const transferIx = createTransferInstruction(
    deployerAta,
    poolUsdcVault,
    deployer.publicKey,
    Number(gap),
  );
  void pool;
  const tx = new Transaction().add(transferIx);
  const sig = await connection.sendTransaction(tx, [deployer], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");
  console.log(`  ✓ top-up tx: ${sig}`);
  return { topUpSig: sig, topUpAmountBase: gap };
}

async function callClaimPayout(
  connection: Connection,
  member: Keypair,
  cycle: number,
  coreProgram: PublicKey,
  reputationProgram: PublicKey,
  pool: PublicKey,
  usdcMint: PublicKey,
  memberUsdc: PublicKey,
  memberPda: PublicKey,
): Promise<string> {
  const [protocolConfig] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);
  const poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, pool, true);
  const [reputationConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("rep-config")],
    reputationProgram,
  );
  const [reputationProfile] = PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), member.publicKey.toBuffer()],
    reputationProgram,
  );

  // Nonce mirrors handler logic in claim_payout.rs:
  //   nonce = ((cycle as u64) << 32) | (slot_index as u64)
  // For cycle 0 / slot 0 this is 0.
  const nonce = (BigInt(cycle) << 32n) | BigInt(cycle);
  const attestation = attestationPda(
    reputationProgram,
    pool,
    member.publicKey,
    SCHEMA_CYCLE_COMPLETE,
    nonce,
  );

  // identity_record == reputation_program signals "None" per Anchor's
  // Option<Account> convention (matches claim_payout.rs:200-205).
  const identityRecord = reputationProgram;

  const data = Buffer.concat([anchorIxDiscriminator("claim_payout"), encodeU8(cycle)]);

  // Account list — order MUST match `ClaimPayout` in
  // programs/roundfi-core/src/instructions/claim_payout.rs:
  //   1.  member_wallet            (signer, mut)
  //   2.  config                   (PDA, read)
  //   3.  pool                     (PDA, mut)
  //   4.  member                   (PDA, mut)
  //   5.  usdc_mint                (read)
  //   6.  member_usdc              (mut, TokenAccount)
  //   7.  pool_usdc_vault          (mut, TokenAccount)
  //   8.  token_program            (read)
  //   9.  reputation_program       (read)
  //  10.  reputation_config        (mut, UncheckedAccount)
  //  11.  reputation_profile       (mut, UncheckedAccount)
  //  12.  identity_record          (read; reputation_program ≡ None)
  //  13.  attestation              (mut, UncheckedAccount, init by reputation::attest)
  //  14.  system_program           (read)
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

  // SPL transfer (signed by Pool PDA) + reputation CPI that init's a
  // fresh Attestation PDA — bump CU above the 200k default.
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
  console.log(`\n━━━ RoundFi seed-claim → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);
  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to claim on mainnet — use a deliberate process.");
  }

  const coreProgram = requireProgram(cluster, "core");
  const reputationProgram = requireProgram(cluster, "reputation");
  const usdcMint = cluster.usdcMint;

  // Pool PDA derives from the deployer pubkey. Prefer the deployer
  // keypair on disk (also used for top-up), fall back to the recorded
  // pubkey in program-ids.devnet.json.
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

  const connection = new Connection(cluster.rpcUrl, "confirmed");

  const poolInfo = await connection.getAccountInfo(pool, "confirmed");
  if (!poolInfo) {
    throw new Error(
      `Pool not found at ${pool.toBase58()}. Run 'pnpm devnet:seed' + 'pnpm devnet:seed-members' + 'pnpm devnet:seed-cycle' first.`,
    );
  }
  const poolView = decodePool(poolInfo.data);
  console.log(
    `→ Pool state   : status=${poolView.status} ` +
      `members=${poolView.membersJoined} ` +
      `cycle=${poolView.currentCycle}/${poolView.cyclesTotal} ` +
      `credit=${(Number(poolView.creditAmount) / 1e6).toFixed(2)} USDC ` +
      `gf=${(Number(poolView.guaranteeFundBalance) / 1e6).toFixed(2)} USDC`,
  );

  if (poolView.status !== 1) {
    throw new Error(
      `Pool is not Active (status=${poolView.status}). ` +
        `Status 2 = Completed (all cycles paid). Status 0 = Forming (need 3 members). Status 3 = Liquidated.`,
    );
  }
  if (poolView.currentCycle >= poolView.cyclesTotal) {
    console.log(
      `✓ Pool is past final cycle (${poolView.currentCycle}/${poolView.cyclesTotal}). Nothing to do.`,
    );
    return;
  }

  // Claim is for the slot whose index == current cycle (slot rotation).
  const slotIndex = poolView.currentCycle;
  const winner = loadMemberKeypair(slotIndex);
  console.log(`→ Claimant     : member ${slotIndex} (${winner.publicKey.toBase58()})\n`);

  const [memberPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), pool.toBuffer(), winner.publicKey.toBuffer()],
    coreProgram,
  );

  const memberInfo = await connection.getAccountInfo(memberPda, "confirmed");
  if (!memberInfo) {
    throw new Error(
      `Member PDA missing for slot ${slotIndex} — run 'pnpm devnet:seed-members' first.`,
    );
  }
  if (decodeMemberPaidOut(memberInfo.data)) {
    console.log(`✓ Slot ${slotIndex} already paid out (member.paid_out=true). Nothing to do.`);
    return;
  }

  // Step 1 — top-up pool float if needed.
  console.log(`Step 1/2 — pool float vs credit:`);
  const poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, pool, true);
  const topUp = await topUpPoolFloatIfNeeded(
    connection,
    pool,
    poolUsdcVault,
    poolView,
    usdcMint,
    walletPath,
  );

  // Step 2 — call claim_payout.
  console.log(`\nStep 2/2 — claim_payout(${slotIndex}):`);
  const memberAta = getAssociatedTokenAddressSync(usdcMint, winner.publicKey);
  const memberAtaPre = await getAccount(connection, memberAta, "confirmed");
  console.log(
    `  member ${slotIndex} USDC pre-claim: ${(Number(memberAtaPre.amount) / 1e6).toFixed(2)}`,
  );

  const sig = await callClaimPayout(
    connection,
    winner,
    slotIndex,
    coreProgram,
    reputationProgram,
    pool,
    usdcMint,
    memberAta,
    memberPda,
  );

  const memberAtaPost = await getAccount(connection, memberAta, "confirmed");
  console.log(
    `  member ${slotIndex} USDC post-claim: ${(Number(memberAtaPost.amount) / 1e6).toFixed(2)} ` +
      `(+${(Number(memberAtaPost.amount - memberAtaPre.amount) / 1e6).toFixed(2)})`,
  );
  console.log(`  ✓ claimed cycle ${slotIndex}`);
  console.log(`    signature : ${sig}`);

  console.log(`\n━━━ done ━━━\n`);
  console.log(`Solscan (devnet):`);
  console.log(`  pool        : https://solscan.io/account/${pool.toBase58()}?cluster=devnet`);
  if (topUp.topUpSig) {
    console.log(`  top-up tx   : https://solscan.io/tx/${topUp.topUpSig}?cluster=devnet`);
  }
  console.log(`  claim tx    : https://solscan.io/tx/${sig}?cluster=devnet`);
  console.log("");
}

main().catch((e) => {
  console.error("\n✗ seed-claim failed:");
  console.error(e);
  process.exit(1);
});

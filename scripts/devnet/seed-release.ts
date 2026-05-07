/**
 * Negative-test driver for `roundfi_core.release_escrow(...)`.
 *
 * The current demo pool's 9 cycle contributions all landed AFTER
 * `pool.next_cycle_at` (the 60-second cycle window had elapsed eras
 * before the contributes ran), so every member carries
 * `Member.on_time_count == 0` and `Member.late_count == 3`.
 *
 * Per `release_escrow.rs:91-94`:
 *   require!(
 *     member.on_time_count >= args.checkpoint,
 *     RoundfiError::EscrowLocked,
 *   );
 *
 * That guard means: a member who paid late forfeits the right to
 * recover their stake. Triple Shield punishes lateness — same family
 * of enforcement as `WaterfallUnderflow` in `claim_payout`.
 *
 * This driver exercises that guard by submitting `release_escrow`
 * with `checkpoint = 1` for member 0 and using `skipPreflight: true`
 * so the tx LANDS on devnet as a failed transaction (rather than
 * being rejected client-side at simulation time). The resulting
 * Solscan link is durable evidence that the protocol enforces
 * on-time discipline on real funds.
 *
 * Expected on-chain error code: 6011 (0x1773) — `EscrowLocked`.
 *
 * Manual instruction encoding (no Anchor SDK runtime — IDL gen still
 * blocked on the toolchain bump documented in `init-protocol.ts`).
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
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { loadCluster, requireProgram } from "../../config/clusters.js";

const POOL_SEED_ID = process.env.POOL_SEED_ID ? BigInt(process.env.POOL_SEED_ID) : 1n;
const TARGET_CHECKPOINT = 1;
const TARGET_SLOT_INDEX = 0; // member 0 is the canonical claimant for the negative test
const KEYPAIRS_DIR = resolve(process.cwd(), "keypairs");
const DEPLOYMENT_CONFIG_PATH = resolve(process.cwd(), "config/program-ids.devnet.json");
const EXPECTED_ERROR_CODE = 6011; // RoundfiError::EscrowLocked

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

/**
 * Member layout (offsets after the 8-byte Anchor discriminator):
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
 *   off 147: last_released_checkpoint u8 (1)
 */
interface MemberView {
  slotIndex: number;
  stakeDeposited: bigint;
  escrowBalance: bigint;
  onTimeCount: number;
  lateCount: number;
  paidOut: boolean;
  lastReleasedCheckpoint: number;
}

function decodeMember(data: Buffer): MemberView {
  return {
    slotIndex: data.readUInt8(104),
    stakeDeposited: data.readBigUInt64LE(108),
    escrowBalance: data.readBigUInt64LE(133),
    onTimeCount: data.readUInt16LE(141),
    lateCount: data.readUInt16LE(143),
    paidOut: data.readUInt8(146) !== 0,
    lastReleasedCheckpoint: data.readUInt8(147),
  };
}

async function main() {
  const cluster = loadCluster();
  console.log(
    `\n━━━ RoundFi seed-release (negative test) → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`,
  );
  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to run negative tests on mainnet.");
  }

  const coreProgram = requireProgram(cluster, "core");
  const usdcMint = cluster.usdcMint;

  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  let deployerPubkey: PublicKey;
  if (existsSync(walletPath)) {
    deployerPubkey = loadKeypair(walletPath).publicKey;
  } else if (existsSync(DEPLOYMENT_CONFIG_PATH)) {
    const cfg = JSON.parse(readFileSync(DEPLOYMENT_CONFIG_PATH, "utf-8")) as { deployer?: string };
    if (!cfg.deployer) throw new Error(`config/program-ids.devnet.json missing 'deployer' pubkey.`);
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
  console.log(`→ Target slot  : ${TARGET_SLOT_INDEX} (member ${TARGET_SLOT_INDEX})`);
  console.log(`→ Checkpoint   : ${TARGET_CHECKPOINT}`);

  const connection = new Connection(cluster.rpcUrl, "confirmed");

  const member = loadMemberKeypair(TARGET_SLOT_INDEX);
  const [memberPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), pool.toBuffer(), member.publicKey.toBuffer()],
    coreProgram,
  );

  const memberInfo = await connection.getAccountInfo(memberPda, "confirmed");
  if (!memberInfo) {
    throw new Error(
      `Member PDA missing for slot ${TARGET_SLOT_INDEX} — run 'pnpm devnet:seed-members' first.`,
    );
  }
  const memberView = decodeMember(memberInfo.data);
  console.log(
    `\n→ Member state pre-call:\n` +
      `    slot_index               = ${memberView.slotIndex}\n` +
      `    stake_deposited          = ${(Number(memberView.stakeDeposited) / 1e6).toFixed(2)} USDC\n` +
      `    escrow_balance           = ${(Number(memberView.escrowBalance) / 1e6).toFixed(2)} USDC\n` +
      `    on_time_count            = ${memberView.onTimeCount}\n` +
      `    late_count               = ${memberView.lateCount}\n` +
      `    paid_out                 = ${memberView.paidOut}\n` +
      `    last_released_checkpoint = ${memberView.lastReleasedCheckpoint}`,
  );

  if (memberView.onTimeCount >= TARGET_CHECKPOINT) {
    console.log(
      `\n⚠  Member's on_time_count (${memberView.onTimeCount}) ` +
        `>= checkpoint (${TARGET_CHECKPOINT}). The on-chain guard would NOT fire — ` +
        `release would actually succeed. Aborting the negative-test driver.`,
    );
    process.exit(1);
  }
  console.log(
    `\n✓ Pre-condition satisfied: on_time_count (${memberView.onTimeCount}) < ` +
      `checkpoint (${TARGET_CHECKPOINT}). The on-chain guard at release_escrow.rs:91 ` +
      `WILL fire and revert with EscrowLocked (error code ${EXPECTED_ERROR_CODE}).`,
  );

  // ─── Build the ix ─────────────────────────────────────────────────────────
  const [protocolConfig] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);
  const [escrowAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), pool.toBuffer()],
    coreProgram,
  );
  const escrowVault = getAssociatedTokenAddressSync(usdcMint, escrowAuthority, true);
  const memberAta = getAssociatedTokenAddressSync(usdcMint, member.publicKey);

  const data = Buffer.concat([
    anchorIxDiscriminator("release_escrow"),
    encodeU8(TARGET_CHECKPOINT),
  ]);

  // Account list — order MUST match `ReleaseEscrow` in
  // programs/roundfi-core/src/instructions/release_escrow.rs:
  //   1. member_wallet            (signer, mut)
  //   2. config                   (PDA, read)
  //   3. pool                     (PDA, mut)
  //   4. member                   (PDA, mut)
  //   5. usdc_mint                (read)
  //   6. member_usdc              (mut, TokenAccount)
  //   7. escrow_vault_authority   (PDA, read)
  //   8. escrow_vault             (mut, TokenAccount)
  //   9. token_program            (read)
  const ix = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: member.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: memberPda, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: memberAta, isSigner: false, isWritable: true },
      { pubkey: escrowAuthority, isSigner: false, isWritable: false },
      { pubkey: escrowVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });

  const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });
  const tx = new Transaction().add(cu, ix);

  // skipPreflight=true → the cluster will process the tx and emit a failed
  // signature on chain (rather than rejecting at simulation). That gives us
  // a durable Solscan-able tx receipt of the protocol guard firing.
  console.log(`\n→ Submitting release_escrow(${TARGET_CHECKPOINT}) with skipPreflight=true ...`);
  const signature = await connection.sendTransaction(tx, [member], {
    preflightCommitment: "confirmed",
    skipPreflight: true,
  });
  console.log(`  signature: ${signature}`);

  // Wait for the failed tx to land. confirmTransaction throws when a tx
  // exits with an error — we expect that, and we want the signature.
  let landed = false;
  try {
    await connection.confirmTransaction(signature, "confirmed");
    landed = true;
  } catch (e) {
    landed = true; // failed-tx errors are fine — the tx still lands
    void e;
  }
  void landed;

  // Pull the on-chain log to confirm the EscrowLocked error code.
  const txDetail = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (txDetail) {
    const logs = txDetail.meta?.logMessages ?? [];
    const errMatch = logs.find(
      (l) => l.includes("Error Code:") || l.includes("custom program error"),
    );
    console.log(`\n→ On-chain log inspection:`);
    console.log(`    err: ${txDetail.meta?.err ? JSON.stringify(txDetail.meta.err) : "(none)"}`);
    if (errMatch) console.log(`    log: ${errMatch}`);

    const expectedHex = `0x${EXPECTED_ERROR_CODE.toString(16)}`;
    const matched =
      JSON.stringify(txDetail.meta?.err ?? {}).includes(expectedHex) ||
      logs.some(
        (l) => l.includes(expectedHex) || l.includes(`Error Number: ${EXPECTED_ERROR_CODE}`),
      );
    if (matched) {
      console.log(
        `\n✓ Negative test PASSED — on-chain guard fired with EscrowLocked (${expectedHex}).`,
      );
      console.log(`  Triple Shield enforcement of on-time discipline confirmed on devnet.`);
    } else {
      console.log(
        `\n⚠ Tx landed as failed but the expected EscrowLocked code wasn't matched in the logs.`,
      );
      console.log(`  Inspect the full log via Solscan and update this script's matcher if needed.`);
    }
  } else {
    console.log(`\n⚠ Could not fetch tx detail. Check Solscan directly.`);
  }

  console.log(`\n━━━ done ━━━\n`);
  console.log(`Solscan (devnet):`);
  console.log(`  failed tx: https://solscan.io/tx/${signature}?cluster=devnet`);
  console.log(`  pool     : https://solscan.io/account/${pool.toBase58()}?cluster=devnet`);
  console.log("");
}

main().catch((e) => {
  console.error("\n✗ seed-release failed (unexpectedly — not the on-chain revert):");
  console.error(e);
  process.exit(1);
});

/**
 * Devnet remediation for SEV-052.
 *
 * The buggy `migrate_protocol_config` (raw byte-splice at post-disc offset
 * 343 instead of the true 303) left the live devnet `ProtocolConfig` with
 * `lp_share_bps = 0` (it never wrote the real field) and spilled
 * `DEFAULT_LP_SHARE_BPS` into the high bytes of `pending_authority_eta`.
 *
 * This calls `update_protocol_config` with ONLY `new_lp_share_bps =
 * Some(<LP_SHARE_BPS>)` to restore the field. Unlike the raw migrate splice,
 * `update_protocol_config` writes via Anchor serialization, so it lands the
 * value at the correct offset. The `eta` spill is benign while
 * `pending_authority` is the default pubkey (confirmed) and self-heals on the
 * next `propose_new_authority`, so it is intentionally left untouched.
 *
 * Authority MUST be the on-chain `config.authority` (the devnet deployer);
 * the ix is gated on `authority.key() == config.authority`.
 *
 * Usage:
 *   pnpm devnet:update-config                 # sets lp_share_bps = 6500 (whitepaper default)
 *   LP_SHARE_BPS=6500 pnpm devnet:update-config
 *
 * Env (optional):
 *   SOLANA_RPC_URL           default https://api.devnet.solana.com
 *   ROUNDFI_CORE_PROGRAM_ID  default 8LVrgxKw... (the canonical devnet ID)
 *   AUTHORITY_KEYPAIR        default keypairs/deployer.json → ~/.config/solana/id.json
 *   LP_SHARE_BPS             default 6500 (must be an integer in 0..=10000)
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

const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const DEFAULT_CORE_PROGRAM_ID = "8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw";
const DEFAULT_LP_SHARE_BPS = 6500;
const MAX_BPS = 10_000;

// Absolute byte offset of `lp_share_bps` in the serialized account: the
// 8-byte Anchor discriminator + post-disc 303. Pinned in the program by
// `ProtocolConfig::LP_SHARE_BPS_POST_DISC_OFFSET` and its Borsh unit test.
const LP_SHARE_BPS_ABS_OFFSET = 8 + 303;

function loadKeypair(path: string): Keypair {
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

function resolveAuthorityKeypair(): Keypair {
  const explicit = process.env.AUTHORITY_KEYPAIR;
  if (explicit && existsSync(explicit)) return loadKeypair(explicit);

  const deployer = resolve(process.cwd(), "keypairs/deployer.json");
  if (existsSync(deployer)) return loadKeypair(deployer);

  const cliWallet = resolve(homedir(), ".config/solana/id.json");
  if (existsSync(cliWallet)) return loadKeypair(cliWallet);

  throw new Error(
    "No authority keypair found. Tried $AUTHORITY_KEYPAIR, keypairs/deployer.json, and ~/.config/solana/id.json.",
  );
}

function ixDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

/**
 * Borsh-encode `UpdateProtocolConfigArgs` with EVERY field None except
 * `new_lp_share_bps = Some(bps)`. The struct (update_protocol_config.rs) has
 * 10 `Option` fields in this exact order; `new_lp_share_bps` is the 10th and
 * last, so the body is 9 None tags (0x00 each) followed by Some(u16) =
 * 0x01 + u16 LE:
 *
 *   1 new_fee_bps_yield        6 new_max_pool_tvl_usdc
 *   2 new_fee_bps_cycle_l1     7 new_max_protocol_tvl_usdc
 *   3 new_fee_bps_cycle_l2     8 new_approved_yield_adapter
 *   4 new_fee_bps_cycle_l3     9 new_commit_reveal_required
 *   5 new_guarantee_fund_bps  10 new_lp_share_bps   <-- the only Some
 *
 * (A borsh `Option<T>` is 1 tag byte regardless of T, so the 9 leading
 * None fields are 9 bytes total even though their inner types differ.)
 */
function encodeLpShareBpsOnly(bps: number): Buffer {
  const some = Buffer.alloc(3);
  some.writeUInt8(0x01, 0); // Some tag
  some.writeUInt16LE(bps, 1); // u16 LE payload
  return Buffer.concat([Buffer.alloc(9, 0x00), some]); // 9 None + Some(u16) = 12 bytes
}

async function main(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
  const coreProgramId = new PublicKey(
    process.env.ROUNDFI_CORE_PROGRAM_ID ?? DEFAULT_CORE_PROGRAM_ID,
  );
  const targetBps = Number(process.env.LP_SHARE_BPS ?? DEFAULT_LP_SHARE_BPS);
  if (!Number.isInteger(targetBps) || targetBps < 0 || targetBps > MAX_BPS) {
    throw new Error(
      `LP_SHARE_BPS must be an integer in 0..=${MAX_BPS}, got ${process.env.LP_SHARE_BPS}`,
    );
  }

  const authority = resolveAuthorityKeypair();
  const connection = new Connection(rpcUrl, "confirmed");
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgramId);

  console.log("");
  console.log("─── update_protocol_config: lp_share_bps (SEV-052 remediation) ───");
  console.log(`Cluster        : ${rpcUrl}`);
  console.log(`Core program   : ${coreProgramId.toBase58()}`);
  console.log(`Config PDA     : ${configPda.toBase58()}`);
  console.log(`Authority      : ${authority.publicKey.toBase58()}`);
  console.log(`Target bps     : ${targetBps}`);
  console.log("");

  const before = await connection.getAccountInfo(configPda, "confirmed");
  if (!before) {
    throw new Error(
      `Config PDA does not exist at ${configPda.toBase58()} — was the program initialized?`,
    );
  }
  const lpBefore = before.data.readUInt16LE(LP_SHARE_BPS_ABS_OFFSET);
  console.log(`→ lp_share_bps today : ${lpBefore}`);
  if (lpBefore === targetBps) {
    console.log(`  ✓ already ${targetBps} — nothing to do.`);
    return;
  }
  console.log(
    `→ Authority balance  : ${(await connection.getBalance(authority.publicKey)) / 1e9} SOL`,
  );
  console.log("");

  const data = Buffer.concat([
    ixDiscriminator("update_protocol_config"),
    encodeLpShareBpsOnly(targetBps),
  ]);
  const ix = new TransactionInstruction({
    programId: coreProgramId,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
    ],
    data,
  });
  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }))
    .add(ix);

  console.log("→ sending update_protocol_config (new_lp_share_bps only)…");
  const sig = await connection.sendTransaction(tx, [authority], {
    preflightCommitment: "confirmed",
    skipPreflight: false,
  });
  console.log(`  signature : ${sig}`);
  console.log(`  https://solscan.io/tx/${sig}?cluster=devnet`);
  await connection.confirmTransaction(sig, "confirmed");
  console.log("  ✓ confirmed");
  console.log("");

  const after = await connection.getAccountInfo(configPda, "confirmed");
  const lpAfter = after?.data.readUInt16LE(LP_SHARE_BPS_ABS_OFFSET) ?? -1;
  console.log(`→ lp_share_bps now   : ${lpAfter}`);
  if (lpAfter === targetBps) {
    console.log(`  ✓ restored ${lpBefore} → ${lpAfter}`);
  } else {
    console.warn(`  ⚠ unexpected: read back ${lpAfter}, expected ${targetBps}`);
  }
}

main().catch((err) => {
  console.error("");
  console.error("✗ update-config failed:", err);
  process.exit(1);
});

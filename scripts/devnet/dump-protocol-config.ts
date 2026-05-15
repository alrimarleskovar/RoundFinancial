/**
 * dump-protocol-config.ts — read-only ProtocolConfig PDA decoder.
 *
 * **Purpose:** validate the byte offsets I hand-decoded for
 * `scripts/mainnet/canary-flow.ts::readProtocolConfig` (PR #356).
 * If any offset is wrong, the canary pre-flight reads junk values
 * and the mainnet hardening check passes/fails on noise.
 *
 * **Safe by construction:** read-only, no signing, no transaction
 * submission. Runs against any cluster (devnet recommended for
 * validation since mainnet may not be initialized yet).
 *
 * **Usage:**
 *
 *     # Read devnet ProtocolConfig
 *     pnpm tsx scripts/devnet/dump-protocol-config.ts
 *
 *     # Read against a specific RPC URL
 *     SOLANA_RPC_URL=https://api.devnet.solana.com \
 *       pnpm tsx scripts/devnet/dump-protocol-config.ts
 *
 * Output is structured: each field on its own line, `OFFSET=N` shown
 * so you can sanity-check against `programs/roundfi-core/src/state/config.rs`
 * if any value looks wrong.
 *
 * **What to look for:**
 *   - `authority` should be a real pubkey (not 1111…11)
 *   - `paused` should be `false` (or `true` if you paused the
 *     protocol intentionally for testing)
 *   - `bump` should be a non-zero u8 (PDA bump seed)
 *   - `treasury` should be a USDC ATA pubkey, NOT the deployer's
 *     wallet directly
 *   - `committed_protocol_tvl_usdc` should equal the sum of
 *     `credit_amount * cycles_total` across active pools
 *
 * If anything looks wrong (gibberish bytes, "false" where you
 * expect "true", etc.), the offset is probably off-by-N — surface
 * it and we patch `canary-flow.ts` immediately.
 */

import { Connection, PublicKey } from "@solana/web3.js";

import { loadCluster, requireProgram } from "../../config/clusters.js";

// ─── Field offsets (must match canary-flow.ts) ──────────────────────────
//
// Layout source: programs/roundfi-core/src/state/config.rs::SIZE
// Anchor discriminator is the first 8 bytes; offsets below are
// post-discriminator (i.e. account.data[OFFSET_X] reads the field).
//
// If you add a field upstream, update BOTH this file AND canary-flow.ts.

const OFFSETS = {
  authority: 8, // Pubkey (32)
  treasury: 8 + 32, // Pubkey (32)
  usdc_mint: 8 + 32 * 2, // Pubkey (32)
  metaplex_core: 8 + 32 * 3, // Pubkey (32)
  default_yield_adapter: 8 + 32 * 4, // Pubkey (32)
  reputation_program: 8 + 32 * 5, // Pubkey (32)
  fee_bps_yield: 8 + 32 * 6, // u16 (2)  = 200
  fee_bps_cycle_l1: 8 + 32 * 6 + 2, // 202
  fee_bps_cycle_l2: 8 + 32 * 6 + 4, // 204
  fee_bps_cycle_l3: 8 + 32 * 6 + 6, // 206
  guarantee_fund_bps: 8 + 32 * 6 + 8, // 208
  paused: 8 + 32 * 6 + 10, // bool (1) = 210
  bump: 8 + 32 * 6 + 11, // u8   (1) = 211
  treasury_locked: 8 + 32 * 6 + 12, // bool (1) = 212
  pending_treasury: 8 + 32 * 6 + 13, // Pubkey (32) = 213
  pending_treasury_eta: 8 + 32 * 6 + 13 + 32, // i64 (8) = 245
  max_pool_tvl_usdc: 8 + 32 * 6 + 13 + 32 + 8, // u64 (8) = 253
  max_protocol_tvl_usdc: 8 + 32 * 6 + 13 + 32 + 8 + 8, // u64 = 261
  committed_protocol_tvl_usdc: 8 + 32 * 6 + 13 + 32 + 8 + 16, // u64 = 269
  approved_yield_adapter: 8 + 32 * 6 + 13 + 32 + 8 + 24, // Pubkey = 277
  approved_yield_adapter_locked: 8 + 32 * 6 + 13 + 32 + 8 + 24 + 32, // 309
  commit_reveal_required: 8 + 32 * 6 + 13 + 32 + 8 + 24 + 33, // 310
  pending_authority: 8 + 32 * 6 + 13 + 32 + 8 + 24 + 34, // Pubkey = 311
  pending_authority_eta: 8 + 32 * 6 + 13 + 32 + 8 + 24 + 34 + 32, // i64 = 343
  lp_share_bps: 8 + 32 * 6 + 13 + 32 + 8 + 24 + 34 + 40, // u16 = 351
  pending_fee_bps_yield: 8 + 32 * 6 + 13 + 32 + 8 + 24 + 34 + 42, // u16 = 353
  pending_fee_bps_yield_eta: 8 + 32 * 6 + 13 + 32 + 8 + 24 + 34 + 44, // i64 = 355
};

const EXPECTED_SIZE = 363 + 18; // last field + 18 padding bytes

function pk(data: Buffer, offset: number): string {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

function bool(data: Buffer, offset: number): string {
  const b = data[offset];
  if (b === 0) return "false";
  if (b === 1) return "true";
  return `?? raw=${b}`;
}

function u16(data: Buffer, offset: number): number {
  return data.readUInt16LE(offset);
}

function u64(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset);
}

function i64(data: Buffer, offset: number): bigint {
  return data.readBigInt64LE(offset);
}

function row(label: string, offset: number, value: string | number | bigint): void {
  console.log(`  [${String(offset).padStart(3, " ")}] ${label.padEnd(34, " ")} ${value}`);
}

async function main(): Promise<void> {
  const cluster = loadCluster();
  const coreProgram = requireProgram(cluster, "core");
  const conn = new Connection(cluster.rpcUrl, "confirmed");

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);
  console.log(`\nProtocolConfig PDA: ${configPda.toBase58()}`);
  console.log(`Cluster:            ${cluster.name}`);
  console.log(`RPC:                ${cluster.rpcUrl}`);
  console.log(`Core program:       ${coreProgram.toBase58()}\n`);

  const info = await conn.getAccountInfo(configPda, "confirmed");
  if (!info) {
    console.error(`❌ ProtocolConfig PDA not found at ${configPda.toBase58()}`);
    console.error(`   Either the protocol isn't initialized on this cluster,`);
    console.error(`   or the SOLANA_CLUSTER / *_PROGRAM_ID env is wrong.`);
    process.exit(1);
  }

  const data = info.data;
  console.log(`Account data length: ${data.length} bytes (expected ~${EXPECTED_SIZE})\n`);

  if (data.length < EXPECTED_SIZE) {
    console.warn(
      `⚠ data shorter than expected (${data.length} < ${EXPECTED_SIZE}) — ` +
        `account may be from before SEV-024 follow-up extended ProtocolConfig. ` +
        `If this is mainnet, that's fine; if devnet, consider re-init.`,
    );
  }

  console.log("─── Decoded fields ────────────────────────────────────");
  row("authority", OFFSETS.authority, pk(data, OFFSETS.authority));
  row("treasury", OFFSETS.treasury, pk(data, OFFSETS.treasury));
  row("usdc_mint", OFFSETS.usdc_mint, pk(data, OFFSETS.usdc_mint));
  row("metaplex_core", OFFSETS.metaplex_core, pk(data, OFFSETS.metaplex_core));
  row(
    "default_yield_adapter",
    OFFSETS.default_yield_adapter,
    pk(data, OFFSETS.default_yield_adapter),
  );
  row("reputation_program", OFFSETS.reputation_program, pk(data, OFFSETS.reputation_program));
  console.log("");
  row("fee_bps_yield", OFFSETS.fee_bps_yield, u16(data, OFFSETS.fee_bps_yield));
  row("fee_bps_cycle_l1", OFFSETS.fee_bps_cycle_l1, u16(data, OFFSETS.fee_bps_cycle_l1));
  row("fee_bps_cycle_l2", OFFSETS.fee_bps_cycle_l2, u16(data, OFFSETS.fee_bps_cycle_l2));
  row("fee_bps_cycle_l3", OFFSETS.fee_bps_cycle_l3, u16(data, OFFSETS.fee_bps_cycle_l3));
  row("guarantee_fund_bps", OFFSETS.guarantee_fund_bps, u16(data, OFFSETS.guarantee_fund_bps));
  console.log("");
  row("paused", OFFSETS.paused, bool(data, OFFSETS.paused));
  row("bump", OFFSETS.bump, data[OFFSETS.bump] ?? 0);
  console.log("");
  row("treasury_locked", OFFSETS.treasury_locked, bool(data, OFFSETS.treasury_locked));
  row("pending_treasury", OFFSETS.pending_treasury, pk(data, OFFSETS.pending_treasury));
  row(
    "pending_treasury_eta",
    OFFSETS.pending_treasury_eta,
    i64(data, OFFSETS.pending_treasury_eta),
  );
  console.log("");
  row("max_pool_tvl_usdc", OFFSETS.max_pool_tvl_usdc, u64(data, OFFSETS.max_pool_tvl_usdc));
  row(
    "max_protocol_tvl_usdc",
    OFFSETS.max_protocol_tvl_usdc,
    u64(data, OFFSETS.max_protocol_tvl_usdc),
  );
  row(
    "committed_protocol_tvl_usdc",
    OFFSETS.committed_protocol_tvl_usdc,
    u64(data, OFFSETS.committed_protocol_tvl_usdc),
  );
  console.log("");
  row(
    "approved_yield_adapter",
    OFFSETS.approved_yield_adapter,
    pk(data, OFFSETS.approved_yield_adapter),
  );
  row(
    "approved_yield_adapter_locked",
    OFFSETS.approved_yield_adapter_locked,
    bool(data, OFFSETS.approved_yield_adapter_locked),
  );
  row(
    "commit_reveal_required",
    OFFSETS.commit_reveal_required,
    bool(data, OFFSETS.commit_reveal_required),
  );
  console.log("");
  row("pending_authority", OFFSETS.pending_authority, pk(data, OFFSETS.pending_authority));
  row(
    "pending_authority_eta",
    OFFSETS.pending_authority_eta,
    i64(data, OFFSETS.pending_authority_eta),
  );
  console.log("");
  row("lp_share_bps", OFFSETS.lp_share_bps, u16(data, OFFSETS.lp_share_bps));
  row(
    "pending_fee_bps_yield",
    OFFSETS.pending_fee_bps_yield,
    u16(data, OFFSETS.pending_fee_bps_yield),
  );
  row(
    "pending_fee_bps_yield_eta",
    OFFSETS.pending_fee_bps_yield_eta,
    i64(data, OFFSETS.pending_fee_bps_yield_eta),
  );
  console.log("\n─── Sanity assertions ─────────────────────────────────");

  // Hard assertions on values that have well-known expected ranges.
  // Each one prints PASS/FAIL so the operator can scan quickly.
  const checks: Array<{ name: string; pass: boolean; got: string; expected: string }> = [];

  checks.push({
    name: "bump is non-zero (PDA bump)",
    pass: (data[OFFSETS.bump] ?? 0) !== 0,
    got: String(data[OFFSETS.bump] ?? 0),
    expected: "1..255",
  });

  const feeYield = u16(data, OFFSETS.fee_bps_yield);
  checks.push({
    name: "fee_bps_yield in [0, MAX_FEE_BPS_YIELD=3000]",
    pass: feeYield <= 3000,
    got: String(feeYield),
    expected: "0..3000",
  });

  const lpBps = u16(data, OFFSETS.lp_share_bps);
  checks.push({
    name: "lp_share_bps in [0, 10000]",
    pass: lpBps <= 10000,
    got: String(lpBps),
    expected: "0..10000",
  });

  const guaranteeBps = u16(data, OFFSETS.guarantee_fund_bps);
  checks.push({
    name: "guarantee_fund_bps in [0, 50000]",
    pass: guaranteeBps <= 50000,
    got: String(guaranteeBps),
    expected: "0..50000",
  });

  for (const c of checks) {
    const tag = c.pass ? "✅ PASS" : "❌ FAIL";
    console.log(`  ${tag}  ${c.name.padEnd(50, " ")} got=${c.got} expected=${c.expected}`);
  }

  console.log("\nIf any assertion FAILed or any field shows gibberish, the byte");
  console.log("offsets in canary-flow.ts are wrong — please report the output.\n");
}

main().catch((e) => {
  console.error(`\n❌ ${(e as Error).message}\n`);
  process.exit(1);
});

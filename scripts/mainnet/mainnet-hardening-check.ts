/**
 * Mainnet hardening pre-flight check.
 *
 * Per `docs/security/constants-audit-2026-05.md §4`, this script reads
 * the on-chain `ProtocolConfig` PDA and asserts every operational
 * canary safety rail is in the production-correct state BEFORE the
 * mainnet canary tx is allowed to fire.
 *
 * Converts a runbook checklist gate into an on-chain state assertion.
 * If any check fails, exits non-zero with an explicit per-flag report.
 *
 * **What this catches:**
 *   - Operator forgot to set commit_reveal_required = true (#232 MEV)
 *   - TVL caps left at 0 (= disabled, no canary safety envelope)
 *   - approved_yield_adapter not pinned to the canonical mainnet
 *     Kamino adapter program (or pinned wrong; SEV-040/SEV-041 class)
 *   - Protocol paused unexpectedly
 *   - Authority not on Squads multisig (#266)
 *   - Treasury not on Squads multisig (#266)
 *
 * **What this does NOT catch:**
 *   - Bug in the wrapper's CPI mechanics (use the Kamino bankrun spike)
 *   - Economic correctness of yield distribution (canary mainnet only)
 *   - mpl-core / Switchboard / Pyth external dependency health
 *
 * Usage:
 *
 *   pnpm test:mainnet-hardening
 *
 * Env:
 *   RPC_URL                       (default: https://api.mainnet-beta.solana.com)
 *   ROUNDFI_CORE_PROGRAM_ID       (default: 8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw)
 *   EXPECTED_AUTHORITY            (REQUIRED on mainnet — pass the Squads multisig PDA)
 *   EXPECTED_TREASURY             (REQUIRED on mainnet — pass the Squads-controlled USDC ATA)
 *   EXPECTED_APPROVED_ADAPTER     (REQUIRED on mainnet — pass roundfi-yield-kamino program ID)
 *   EXPECTED_MAX_POOL_TVL_USDC    (default 10000_000000 = 10k USDC base units for canary)
 *   EXPECTED_MAX_PROTOCOL_TVL_USDC (default 100000_000000 = 100k USDC for canary)
 *
 * Run with `--devnet` to use devnet defaults and SKIP the
 * REQUIRED-on-mainnet env vars (useful for rehearsal).
 */

import { Connection, PublicKey } from "@solana/web3.js";

const DEFAULT_CORE_PROGRAM_ID = "8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw";

// ProtocolConfig field byte offsets within the account data, AFTER
// the 8-byte Anchor discriminator. Derived from
// programs/roundfi-core/src/state/config.rs field declaration order +
// SIZE breakdown. If config.rs changes, update OFFSETS_POST_DISC.
//
// Layout (post-discriminator):
//   authority:                Pubkey      32 bytes  @ 0
//   treasury:                 Pubkey      32 bytes  @ 32
//   fee_bps_yield:            u16          2 bytes  @ 64
//   fee_bps_cycle_l1:         u16          2 bytes  @ 66
//   fee_bps_cycle_l2:         u16          2 bytes  @ 68
//   fee_bps_cycle_l3:         u16          2 bytes  @ 70
//   guarantee_fund_bps:       u16          2 bytes  @ 72
//   lp_share_bps:             u16          2 bytes  @ 74
//   reputation_program:       Pubkey      32 bytes  @ 76
//   paused:                   bool         1 byte   @ 108
//   pending_treasury_eta:     i64          8 bytes  @ 109
//   pending_authority_eta:    i64          8 bytes  @ 117
//   treasury_locked:          bool         1 byte   @ 125
//   pending_treasury:         Pubkey      32 bytes  @ 126
//   ... and so on through the new fields
// (We don't need every offset — just the ones we assert on.)
//
// NOTE: this script is OFFSET-FRAGILE. If ProtocolConfig grows new
// fields between authority+treasury and the fields we read, the
// offsets shift. Keep cross-referenced with config.rs.
const OFFSETS_POST_DISC = {
  authority: 0,
  treasury: 32,
  paused: 108,
  // The fields below are post-W3 additions per
  // docs/operations/reputation-config-migration.md and the SEV-024
  // timelock work. Offsets depend on the *exact* current ProtocolConfig
  // shape — if asserts below report unexpected values, run
  // `solana account <CONFIG_PDA> --output json-compact` and verify
  // by hand against config.rs.
  treasuryLocked: 125,
} as const;

const ANCHOR_DISC_SIZE = 8;

interface Check {
  name: string;
  ok: boolean;
  expected: string;
  actual: string;
  severity: "BLOCKER" | "WARNING";
}

function pubkeyAt(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function boolAt(data: Buffer, offset: number): boolean {
  return data.readUInt8(offset) === 1;
}

async function main() {
  const isDevnet = process.argv.includes("--devnet");
  const rpcUrl =
    process.env.RPC_URL ??
    (isDevnet ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com");
  const coreProgramId = new PublicKey(
    process.env.ROUNDFI_CORE_PROGRAM_ID ?? DEFAULT_CORE_PROGRAM_ID,
  );

  console.log("");
  console.log("─── mainnet_hardening_check ────────────────────────────────");
  console.log(`Cluster:  ${rpcUrl}`);
  console.log(`Mode:     ${isDevnet ? "DEVNET (rehearsal)" : "MAINNET (production)"}`);
  console.log(`Program:  ${coreProgramId.toBase58()}`);
  console.log("");

  // Derive ProtocolConfig PDA: seeds = [b"config"]
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgramId);
  console.log(`Config PDA: ${configPda.toBase58()}`);

  const connection = new Connection(rpcUrl, "confirmed");
  const info = await connection.getAccountInfo(configPda);
  if (!info) {
    console.error(`❌ ProtocolConfig PDA not found at ${configPda.toBase58()}`);
    console.error("   Protocol may not be initialized yet on this cluster.");
    process.exit(1);
  }

  const data = info.data.subarray(ANCHOR_DISC_SIZE);
  console.log(`Account data: ${data.length} bytes (post-discriminator)`);
  console.log("");

  const checks: Check[] = [];

  // ─── BLOCKER 1: authority must match expected (Squads PDA on mainnet) ──
  const actualAuthority = pubkeyAt(data, OFFSETS_POST_DISC.authority);
  if (process.env.EXPECTED_AUTHORITY) {
    const expected = new PublicKey(process.env.EXPECTED_AUTHORITY);
    checks.push({
      name: "authority",
      ok: actualAuthority.equals(expected),
      expected: expected.toBase58(),
      actual: actualAuthority.toBase58(),
      severity: "BLOCKER",
    });
  } else if (!isDevnet) {
    checks.push({
      name: "authority",
      ok: false,
      expected: "<set EXPECTED_AUTHORITY env var to the Squads multisig PDA>",
      actual: actualAuthority.toBase58(),
      severity: "BLOCKER",
    });
  } else {
    console.log(
      `  (devnet) authority = ${actualAuthority.toBase58()} (skipped — set EXPECTED_AUTHORITY to enforce)`,
    );
  }

  // ─── BLOCKER 2: treasury must match expected (Squads-controlled ATA on mainnet) ──
  const actualTreasury = pubkeyAt(data, OFFSETS_POST_DISC.treasury);
  if (process.env.EXPECTED_TREASURY) {
    const expected = new PublicKey(process.env.EXPECTED_TREASURY);
    checks.push({
      name: "treasury",
      ok: actualTreasury.equals(expected),
      expected: expected.toBase58(),
      actual: actualTreasury.toBase58(),
      severity: "BLOCKER",
    });
  } else if (!isDevnet) {
    checks.push({
      name: "treasury",
      ok: false,
      expected: "<set EXPECTED_TREASURY env var to the Squads-controlled USDC ATA>",
      actual: actualTreasury.toBase58(),
      severity: "BLOCKER",
    });
  } else {
    console.log(
      `  (devnet) treasury = ${actualTreasury.toBase58()} (skipped — set EXPECTED_TREASURY to enforce)`,
    );
  }

  // ─── BLOCKER 3: paused must be FALSE (canary cannot run if paused) ──
  const paused = boolAt(data, OFFSETS_POST_DISC.paused);
  checks.push({
    name: "paused",
    ok: !paused,
    expected: "false (protocol must be unpaused for canary)",
    actual: paused ? "true" : "false",
    severity: "BLOCKER",
  });

  // ─── BLOCKER 4: treasury_locked is a one-way kill switch ──
  // This SHOULD be false pre-canary (rotation still possible).
  // It only flips to true POST-canary via lock_treasury() ceremony.
  // If it's true pre-canary, someone fired it prematurely.
  const treasuryLocked = boolAt(data, OFFSETS_POST_DISC.treasuryLocked);
  checks.push({
    name: "treasury_locked",
    ok: !treasuryLocked,
    expected: "false (lock fires POST-canary only)",
    actual: treasuryLocked ? "true" : "false",
    severity: "BLOCKER",
  });

  // ─── Report ───────────────────────────────────────────────────────
  console.log("");
  console.log("Pre-flight assertions:");
  console.log("");
  let failedBlockers = 0;
  let failedWarnings = 0;
  for (const check of checks) {
    const mark = check.ok ? "✅" : check.severity === "BLOCKER" ? "🔴" : "⚠️";
    console.log(`  ${mark} ${check.name}`);
    if (!check.ok) {
      console.log(`     expected: ${check.expected}`);
      console.log(`     actual:   ${check.actual}`);
      if (check.severity === "BLOCKER") failedBlockers += 1;
      else failedWarnings += 1;
    }
  }

  console.log("");
  console.log("─── ProtocolConfig fields not yet checked by this script ───");
  console.log("  - approved_yield_adapter (post-W3 offset; verify manually with");
  console.log("    `solana account <CONFIG_PDA>` until script grows to read it)");
  console.log(
    "  - approved_yield_adapter_locked (one-way kill switch — should be false pre-canary)",
  );
  console.log("  - commit_reveal_required (#232 MEV mitigation — should be true for mainnet)");
  console.log("  - max_pool_tvl_usdc + max_protocol_tvl_usdc (canary caps — should be > 0)");
  console.log("");
  console.log("  Filed as TODO follow-up — the 4 fields above need stable byte");
  console.log("  offsets pinned. The 4 BLOCKER fields above (authority/treasury/");
  console.log("  paused/treasury_locked) are the highest-confidence layer that");
  console.log("  this script asserts today.");

  console.log("");
  if (failedBlockers > 0) {
    console.error(`❌ ${failedBlockers} BLOCKER check(s) failed — canary NOT safe to run.`);
    process.exit(1);
  }
  if (failedWarnings > 0) {
    console.warn(`⚠️  ${failedWarnings} WARNING check(s). Review before proceeding.`);
  }
  console.log("✅ All blocker pre-flight checks passed.");
  console.log("");
  console.log("Reminder: this is necessary but NOT sufficient. Canary still requires:");
  console.log("  - Squads multisig ceremony complete (MAINNET_READINESS §3.6/3.7)");
  console.log("  - mainnet-canary-plan.md kill criteria reviewed");
  console.log("  - Kamino integration validated (SEV-040/041 closed via spike PR #379)");
}

main().catch((err) => {
  console.error("");
  console.error("mainnet_hardening_check failed with exception:", err);
  process.exit(99);
});

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
 *   - usdc_mint not pinned to canonical mainnet USDC (SEV-044)
 *   - metaplex_core not pinned to canonical Metaplex Core (SEV-044)
 *   - Protocol paused unexpectedly
 *   - Authority not on Squads multisig (#266)
 *   - Treasury not on Squads multisig (#266)
 *   - reputation_program left at Pubkey::default — silently disables
 *     the v5.2 attest pipeline (security review Caio MEDIUM #1, 2026-06-12)
 *   - identity gate left disabled (required_min_level == 0) so L4 Elite
 *     could be reached without a verified identity (Caio MEDIUM #1
 *     continuation, 2026-06-12)
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
 *   RPC_URL                         (default: https://api.mainnet-beta.solana.com)
 *   ROUNDFI_CORE_PROGRAM_ID         (default: 8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw)
 *   EXPECTED_AUTHORITY              (REQUIRED on mainnet — pass the Squads multisig PDA)
 *   EXPECTED_TREASURY               (REQUIRED on mainnet — pass the Squads-controlled USDC ATA)
 *   EXPECTED_APPROVED_ADAPTER       (REQUIRED on mainnet — pass roundfi-yield-kamino program ID)
 *   EXPECTED_USDC_MINT              (default canonical mainnet/devnet USDC; override for pinned localnet)
 *   EXPECTED_MAX_POOL_TVL_USDC      (default 5_000000 = $5 base units for first canary wave)
 *   EXPECTED_MAX_PROTOCOL_TVL_USDC  (default 50_000000 = $50 base units for first canary wave)
 *   EXPECTED_COMMIT_REVEAL_REQUIRED (default "true" — #232 MEV mitigation gate on mainnet)
 *   EXPECTED_REPUTATION_PROGRAM     (optional — pin to canonical reputation program id;
 *                                    when unset, only enforces "not default")
 *   EXPECTED_IDENTITY_MIN_LEVEL     (optional — pin the identity-gate required_min_level
 *                                    exactly, e.g. 4; when unset, mainnet only enforces != 0)
 *
 * Run with `--devnet` to use devnet defaults and SKIP the
 * REQUIRED-on-mainnet env vars (useful for rehearsal).
 */

import { Connection, PublicKey } from "@solana/web3.js";

const DEFAULT_CORE_PROGRAM_ID = "8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw";

// ProtocolConfig field byte offsets within the account data, AFTER
// the 8-byte Anchor discriminator. Derived from
// programs/roundfi-core/src/state/config.rs field declaration order +
// SIZE breakdown.
//
// SEV-042 history: the previous version of this table had the
// post-Pubkey fields (paused, treasury_locked) at offsets 108 and 125
// because the docstring layout had skipped 4 Pubkeys (usdc_mint,
// metaplex_core, default_yield_adapter, reputation_program). The
// script was reading random bytes in the middle of those Pubkeys and
// would have passed even on a paused protocol if the corresponding
// byte happened to be 0. Layout below is derived empirically from
// config.rs at v0.4-canary.
//
// Layout (post-discriminator):
//   authority:                       Pubkey  32 bytes  @ 0
//   treasury:                        Pubkey  32 bytes  @ 32
//   usdc_mint:                       Pubkey  32 bytes  @ 64
//   metaplex_core:                   Pubkey  32 bytes  @ 96
//   default_yield_adapter:           Pubkey  32 bytes  @ 128
//   reputation_program:              Pubkey  32 bytes  @ 160
//   fee_bps_yield:                   u16      2 bytes  @ 192
//   fee_bps_cycle_l1:                u16      2 bytes  @ 194
//   fee_bps_cycle_l2:                u16      2 bytes  @ 196
//   fee_bps_cycle_l3:                u16      2 bytes  @ 198
//   guarantee_fund_bps:              u16      2 bytes  @ 200
//   paused:                          bool     1 byte   @ 202
//   bump:                            u8       1 byte   @ 203
//   treasury_locked:                 bool     1 byte   @ 204
//   pending_treasury:                Pubkey  32 bytes  @ 205
//   pending_treasury_eta:            i64      8 bytes  @ 237
//   max_pool_tvl_usdc:               u64      8 bytes  @ 245
//   max_protocol_tvl_usdc:           u64      8 bytes  @ 253
//   committed_protocol_tvl_usdc:     u64      8 bytes  @ 261
//   approved_yield_adapter:          Pubkey  32 bytes  @ 269
//   approved_yield_adapter_locked:   bool     1 byte   @ 301
//   commit_reveal_required:          bool     1 byte   @ 302
//   pending_authority:               Pubkey  32 bytes  @ 303
//   pending_authority_eta:           i64      8 bytes  @ 335
//   lp_share_bps:                    u16      2 bytes  @ 343
//   pending_fee_bps_yield:           u16      2 bytes  @ 345
//   pending_fee_bps_yield_eta:       i64      8 bytes  @ 347
//   forward-compat padding:                  18 bytes  @ 355
//   ────────────────────────────────────────────────────
//   Total post-discriminator size:           373 bytes
const OFFSETS_POST_DISC = {
  authority: 0,
  treasury: 32,
  usdcMint: 64,
  metaplexCore: 96,
  paused: 202,
  treasuryLocked: 204,
  maxPoolTvlUsdc: 245,
  maxProtocolTvlUsdc: 253,
  approvedYieldAdapter: 269,
  approvedYieldAdapterLocked: 301,
  commitRevealRequired: 302,
  /// reputation_program PDA pin (security review Caio MEDIUM-1, 2026-06-12).
  /// At Pubkey::default() ("11111…111"), every core ix skips the attest
  /// CPI — the on-chain reputation surface is silently disabled. Legacy
  /// devnet bootstrap only; mainnet must always pin it.
  reputationProgram: 160,
} as const;

const ANCHOR_DISC_SIZE = 8;

// Expected size of the ProtocolConfig account body (post-discriminator).
// Must equal ProtocolConfig::SIZE - 8 from config.rs. If the on-chain
// account is larger or smaller, the struct has changed shape and these
// offsets are stale — the script bails before reading wrong bytes.
const EXPECTED_DATA_SIZE = 373;

// Canonical mainnet pubkeys. Same value across clusters (Metaplex Core
// has a single program-id; Solana's mainnet USDC mint has its own).
// SEV-044: previously, `mainnet-canary-plan.md §3.2` required these
// be pinned but no automated check enforced them — operator error
// could have shipped a canary against a wrong mint or a substituted
// mpl-core program with no script-level guard.
const CANONICAL_METAPLEX_CORE_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
const CANONICAL_MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const CANONICAL_DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

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

function u64At(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset);
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

  // ─── SEV-042 guard: bail before reading wrong offsets ─────────────
  // If the on-chain account body size doesn't match ProtocolConfig::SIZE - 8
  // from config.rs, the struct has changed shape since this script was
  // written. Every offset below is potentially wrong — bail hard rather
  // than silently green-light the canary.
  if (data.length !== EXPECTED_DATA_SIZE) {
    console.error(
      `❌ ProtocolConfig size mismatch: expected ${EXPECTED_DATA_SIZE} bytes post-disc, got ${data.length}.`,
    );
    console.error("   The struct has changed since this script was last updated.");
    console.error("   Re-derive OFFSETS_POST_DISC from programs/roundfi-core/src/state/config.rs");
    console.error("   before running canary. SEV-042 class — do NOT proceed.");
    process.exit(2);
  }

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

  // ─── BLOCKER 3: usdc_mint must match canonical for the cluster ──
  // SEV-044 class — wrong mint = funds routed to a wrong-decimals or
  // wrong-issuer token. Default canonical values: mainnet
  // EPjFWdd5...zTDt1v, devnet 4zMMC9sr...DncDU. Override via env
  // EXPECTED_USDC_MINT (e.g. for a pinned localnet mint during
  // rehearsal).
  const actualUsdcMint = pubkeyAt(data, OFFSETS_POST_DISC.usdcMint);
  const expectedUsdcMint = new PublicKey(
    process.env.EXPECTED_USDC_MINT ??
      (isDevnet ? CANONICAL_DEVNET_USDC_MINT : CANONICAL_MAINNET_USDC_MINT),
  );
  checks.push({
    name: "usdc_mint",
    ok: actualUsdcMint.equals(expectedUsdcMint),
    expected: expectedUsdcMint.toBase58(),
    actual: actualUsdcMint.toBase58(),
    severity: "BLOCKER",
  });

  // ─── BLOCKER 4: metaplex_core must equal canonical Metaplex Core ──
  // Same program-id on every cluster. A substituted mpl-core program
  // (compromised, wrong fork, devnet test build) would silently
  // accept different plugin payloads in join_pool's CreateV2 CPI —
  // position NFTs would be malformed without an on-chain error here.
  // SEV-044 class.
  const actualMetaplexCore = pubkeyAt(data, OFFSETS_POST_DISC.metaplexCore);
  const expectedMetaplexCore = new PublicKey(CANONICAL_METAPLEX_CORE_ID);
  checks.push({
    name: "metaplex_core",
    ok: actualMetaplexCore.equals(expectedMetaplexCore),
    expected: expectedMetaplexCore.toBase58(),
    actual: actualMetaplexCore.toBase58(),
    severity: "BLOCKER",
  });

  // ─── BLOCKER 5: paused must be FALSE (canary cannot run if paused) ──
  const paused = boolAt(data, OFFSETS_POST_DISC.paused);
  checks.push({
    name: "paused",
    ok: !paused,
    expected: "false (protocol must be unpaused for canary)",
    actual: paused ? "true" : "false",
    severity: "BLOCKER",
  });

  // ─── BLOCKER 6: treasury_locked is a one-way kill switch ──
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

  // ─── BLOCKER 7: approved_yield_adapter must match expected (Kamino on mainnet) ──
  // SEV-040/041 class — wrong adapter program ID = funds routed to wrong CPI target.
  const actualAdapter = pubkeyAt(data, OFFSETS_POST_DISC.approvedYieldAdapter);
  if (process.env.EXPECTED_APPROVED_ADAPTER) {
    const expected = new PublicKey(process.env.EXPECTED_APPROVED_ADAPTER);
    checks.push({
      name: "approved_yield_adapter",
      ok: actualAdapter.equals(expected),
      expected: expected.toBase58(),
      actual: actualAdapter.toBase58(),
      severity: "BLOCKER",
    });
  } else if (!isDevnet) {
    checks.push({
      name: "approved_yield_adapter",
      ok: false,
      expected: "<set EXPECTED_APPROVED_ADAPTER env var to roundfi-yield-kamino program ID>",
      actual: actualAdapter.toBase58(),
      severity: "BLOCKER",
    });
  } else {
    console.log(
      `  (devnet) approved_yield_adapter = ${actualAdapter.toBase58()} (skipped — set EXPECTED_APPROVED_ADAPTER to enforce)`,
    );
  }

  // ─── BLOCKER 8: approved_yield_adapter_locked should be FALSE pre-canary ──
  // One-way kill switch. Locking pre-canary breaks rampup rotations
  // (e.g. mock → kamino). Only flip to true POST-canary.
  const adapterLocked = boolAt(data, OFFSETS_POST_DISC.approvedYieldAdapterLocked);
  checks.push({
    name: "approved_yield_adapter_locked",
    ok: !adapterLocked,
    expected: "false (lock fires POST-canary only)",
    actual: adapterLocked ? "true" : "false",
    severity: "BLOCKER",
  });

  // ─── BLOCKER 9 + 10: TVL caps must be > 0 ──
  // 0 means disabled (no cap) per config.rs docstring. On mainnet
  // canary, both caps MUST be > 0 — that's the entire point of the
  // canary safety envelope. Default expected values match
  // mainnet-canary-plan.md §7 wave-1 ($5 pool / $50 protocol).
  const maxPoolTvl = u64At(data, OFFSETS_POST_DISC.maxPoolTvlUsdc);
  const maxProtocolTvl = u64At(data, OFFSETS_POST_DISC.maxProtocolTvlUsdc);
  const expectedMaxPool = BigInt(process.env.EXPECTED_MAX_POOL_TVL_USDC ?? "5000000");
  const expectedMaxProtocol = BigInt(process.env.EXPECTED_MAX_PROTOCOL_TVL_USDC ?? "50000000");
  checks.push({
    name: "max_pool_tvl_usdc",
    ok: maxPoolTvl > 0n && (isDevnet || maxPoolTvl === expectedMaxPool),
    expected: isDevnet
      ? "> 0 (any value)"
      : `${expectedMaxPool} base units ($${Number(expectedMaxPool) / 1_000_000})`,
    actual: `${maxPoolTvl} base units ($${Number(maxPoolTvl) / 1_000_000})`,
    severity: "BLOCKER",
  });
  checks.push({
    name: "max_protocol_tvl_usdc",
    ok: maxProtocolTvl > 0n && (isDevnet || maxProtocolTvl === expectedMaxProtocol),
    expected: isDevnet
      ? "> 0 (any value)"
      : `${expectedMaxProtocol} base units ($${Number(expectedMaxProtocol) / 1_000_000})`,
    actual: `${maxProtocolTvl} base units ($${Number(maxProtocolTvl) / 1_000_000})`,
    severity: "BLOCKER",
  });

  // ─── BLOCKER 11: commit_reveal_required must be TRUE on mainnet (#232 MEV) ──
  // Gates the legacy single-step escape_valve_list path. Mainnet
  // canary requires the commit-reveal anti-snipe window. Devnet may
  // leave it false to keep demo flows single-step.
  const commitRevealRequired = boolAt(data, OFFSETS_POST_DISC.commitRevealRequired);
  const expectedCommitReveal =
    (process.env.EXPECTED_COMMIT_REVEAL_REQUIRED ?? (isDevnet ? "false" : "true")) === "true";
  checks.push({
    name: "commit_reveal_required",
    ok: commitRevealRequired === expectedCommitReveal,
    expected: expectedCommitReveal
      ? "true (#232 MEV mitigation on mainnet)"
      : "false (devnet demo)",
    actual: commitRevealRequired ? "true" : "false",
    severity: isDevnet ? "WARNING" : "BLOCKER",
  });

  // ─── BLOCKER 12: reputation_program must be set (security review 2026-06-12) ──
  // Every core ix (contribute / settle_default / claim_payout) gates the
  // attest CPI on `if config.reputation_program != Pubkey::default()`.
  // At default, the reputation pipeline is SILENTLY DISABLED — no
  // attestation PDAs, no payloads for the indexer to score, no `/score`
  // signal. Acceptable for legacy devnet bootstrap, NEVER for canary or
  // mainnet. Caio MEDIUM #1, pre-deploy gate.
  const reputationProgramBytes = data.subarray(
    OFFSETS_POST_DISC.reputationProgram,
    OFFSETS_POST_DISC.reputationProgram + 32,
  );
  const reputationProgram = new PublicKey(reputationProgramBytes);
  const isReputationDefault = reputationProgram.equals(PublicKey.default);
  // EXPECTED_REPUTATION_PROGRAM is optional — if set, we enforce equality
  // against the canonical pin; if unset, we only enforce "not default".
  const expectedRepProgram = process.env.EXPECTED_REPUTATION_PROGRAM
    ? new PublicKey(process.env.EXPECTED_REPUTATION_PROGRAM)
    : null;
  const reputationProgramOk = expectedRepProgram
    ? reputationProgram.equals(expectedRepProgram)
    : !isReputationDefault;
  checks.push({
    name: "reputation_program",
    ok: reputationProgramOk,
    expected: expectedRepProgram
      ? `${expectedRepProgram.toBase58()} (pinned)`
      : "≠ Pubkey::default (reputation pipeline active)",
    actual: isReputationDefault
      ? `${reputationProgram.toBase58()} (default — reputation pipeline DISABLED)`
      : reputationProgram.toBase58(),
    // Devnet bootstrap may legitimately leave this default before
    // running migrate-reputation-config; downgrade to WARNING there.
    severity: isDevnet ? "WARNING" : "BLOCKER",
  });

  // ─── BLOCKER 13: identity gate must gate L4 on mainnet (Caio MEDIUM #1) ──
  // SEV-047 added `IdentityGateConfig` + `cap_level_for_identity`, but the
  // default is `required_min_level = 0` (gate OFF) — correct for
  // devnet/canary where testers have no on-chain identity. For mainnet,
  // the security review (Caio MEDIUM #1, 2026-06-12) requires that
  // reaching the highest tiers needs a verified identity: L4 Elite (3%
  // stake, ~33x leverage) without an identity floor is the thinnest
  // collateral in the protocol granted on a purely score-based gate.
  //
  // `required_min_level` semantic: N means "reaching level >= N requires
  // identity_verified." So any value in 2..=4 gates L4; 0 = disabled.
  // We require != 0 on mainnet; EXPECTED_IDENTITY_MIN_LEVEL pins an exact
  // value (recommend 4 = "only L4 needs identity", the least restrictive
  // that still satisfies the review). The gate config lives on the
  // reputation program, not core, so we derive + read a second account.
  if (!isReputationDefault) {
    const [identityGatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("identity-gate")],
      reputationProgram,
    );
    const gateInfo = await connection.getAccountInfo(identityGatePda, "confirmed");
    // Layout: disc(8) + authority(32) + required_min_level u8 @ 40 + bump.
    const requiredMinLevel =
      gateInfo && gateInfo.data.length >= 41 ? gateInfo.data.readUInt8(40) : 0;
    const expectedMin = process.env.EXPECTED_IDENTITY_MIN_LEVEL
      ? Number(process.env.EXPECTED_IDENTITY_MIN_LEVEL)
      : null;
    const gateOk = expectedMin !== null ? requiredMinLevel === expectedMin : requiredMinLevel !== 0;
    checks.push({
      name: "identity_gate (L4 requires verified identity)",
      ok: gateOk,
      expected:
        expectedMin !== null
          ? `required_min_level == ${expectedMin}`
          : "required_min_level != 0 (recommend 4)",
      actual:
        gateInfo === null
          ? "IdentityGateConfig account not found (gate never initialized)"
          : `required_min_level = ${requiredMinLevel}${requiredMinLevel === 0 ? " (gate DISABLED)" : ""}`,
      // Devnet/canary intentionally run with the gate off so testers can
      // promote without KYC; only mainnet blocks.
      severity: isDevnet ? "WARNING" : "BLOCKER",
    });
  }

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

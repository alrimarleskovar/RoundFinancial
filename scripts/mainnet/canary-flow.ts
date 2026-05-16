/**
 * Mainnet canary flow — size-1 self-pool that exercises every active M3
 * instruction against real mainnet conditions before any retail pool
 * opens.
 *
 * **DO NOT RUN** without completing the pre-flight checklist in
 * [`docs/operations/mainnet-canary-plan.md`](../../docs/operations/mainnet-canary-plan.md)
 * §3. The script refuses to run if any pre-flight gate fails — read
 * the canary plan first.
 *
 * **Idempotent + resumable.** Each step checks the on-chain state
 * before re-running. A partial run can resume from where it left off.
 *
 * **Multi-sig path.** `create_pool` and `close_pool` are admin-gated
 * — the script generates the tx and prints the base64-encoded payload
 * for the operator to hand to the Squads UI. The script polls for
 * completion and continues automatically once the Squads tx lands.
 *
 * Foundation under issue #292. Not for production until the run is
 * authorized + pre-flight is green.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { loadCluster, requireProgram } from "../../config/clusters.js";

// ─── ProtocolConfig field offsets ──────────────────────────────────────
//
// Hand-decoded from `programs/roundfi-core/src/state/config.rs`. Each
// constant below is the byte offset of the field within the account
// data (post 8-byte Anchor discriminator). Updating any of these
// requires also updating the on-chain layout — the Rust SIZE comment
// is the canonical reference; touch both in the same PR.
//
// Field discovery order:
//   8 (disc) + 32 (authority) + 32 (treasury) + 32 (usdc_mint)
//     + 32 (metaplex_core) + 32 (default_yield_adapter)
//     + 32 (reputation_program) + 10 (5 × u16 fees) + 1 (paused)
//     + 1 (bump) + 1 (treasury_locked) + 32 (pending_treasury)
//     + 8 (pending_treasury_eta) + 8 (max_pool_tvl_usdc) + ...
const OFFSET_AUTHORITY = 8;
const OFFSET_PAUSED = 210;
const OFFSET_TREASURY_LOCKED = 212;
const OFFSET_MAX_POOL_TVL_USDC = 253;
const OFFSET_MAX_PROTOCOL_TVL_USDC = 261;
const OFFSET_APPROVED_YIELD_ADAPTER = 277;
const OFFSET_APPROVED_YIELD_ADAPTER_LOCKED = 309;
const OFFSET_COMMIT_REVEAL_REQUIRED = 310;

/**
 * Decode the fields of `ProtocolConfig` the canary pre-flight cares
 * about. Returns a typed struct or throws if the account is missing
 * / wrong-sized.
 *
 * Why hand-decode: the canary script must NOT depend on Anchor's
 * codegen path (which is gated on the Rust 1.95 / mpl-core fix). The
 * pre-flight gate is the protocol's ground-truth check; rolling our
 * own byte reader keeps it independent of the IDL surface.
 */
function readProtocolConfig(data: Buffer): {
  authority: PublicKey;
  paused: boolean;
  treasury_locked: boolean;
  max_pool_tvl_usdc: bigint;
  max_protocol_tvl_usdc: bigint;
  approved_yield_adapter: PublicKey;
  approved_yield_adapter_locked: boolean;
  commit_reveal_required: boolean;
} {
  return {
    authority: new PublicKey(data.subarray(OFFSET_AUTHORITY, OFFSET_AUTHORITY + 32)),
    paused: data[OFFSET_PAUSED] === 1,
    treasury_locked: data[OFFSET_TREASURY_LOCKED] === 1,
    max_pool_tvl_usdc: data.readBigUInt64LE(OFFSET_MAX_POOL_TVL_USDC),
    max_protocol_tvl_usdc: data.readBigUInt64LE(OFFSET_MAX_PROTOCOL_TVL_USDC),
    approved_yield_adapter: new PublicKey(
      data.subarray(OFFSET_APPROVED_YIELD_ADAPTER, OFFSET_APPROVED_YIELD_ADAPTER + 32),
    ),
    approved_yield_adapter_locked: data[OFFSET_APPROVED_YIELD_ADAPTER_LOCKED] === 1,
    commit_reveal_required: data[OFFSET_COMMIT_REVEAL_REQUIRED] === 1,
  };
}

// ─── Safety guards ──────────────────────────────────────────────────────

function refuseIfNotMainnet(): void {
  const cluster = loadCluster();
  if (cluster.name !== "mainnet-beta") {
    throw new Error(
      `canary-flow.ts is mainnet-only. Current cluster: ${cluster.name}. ` +
        `Set SOLANA_CLUSTER=mainnet-beta + SOLANA_RPC_URL=<mainnet-rpc> to run.`,
    );
  }
}

function refuseUnlessExplicitAuthorization(): void {
  // The script requires CANARY_AUTHORIZED=yes in the env to actually
  // submit transactions. This is a second safety belt beyond the
  // mainnet cluster check — protects against running on a properly
  // configured mainnet env by accident before pre-flight is complete.
  if (process.env.CANARY_AUTHORIZED !== "yes") {
    throw new Error(
      "Canary flow is not authorized. Set CANARY_AUTHORIZED=yes only after\n" +
        "completing the pre-flight checklist in docs/operations/mainnet-canary-plan.md §3.\n" +
        "The check above does NOT replace pre-flight — it just prevents accidental runs.",
    );
  }
}

// ─── Pre-flight (read-only, runs before any tx) ────────────────────────

interface PreflightCheck {
  name: string;
  run: (conn: Connection, deployer: Keypair) => Promise<void>;
}

const PREFLIGHT_CHECKS: PreflightCheck[] = [
  {
    name: "Cluster version is mainnet-beta",
    run: async (conn) => {
      const version = await conn.getVersion();
      if (!version) throw new Error("getVersion returned null");
      // Note: solana-core version doesn't directly say "mainnet" — verify
      // via the genesis hash. Mainnet genesis hash is well-known.
      const genesis = await conn.getGenesisHash();
      const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
      if (genesis !== MAINNET_GENESIS) {
        throw new Error(`genesis hash ${genesis} != mainnet ${MAINNET_GENESIS}`);
      }
    },
  },
  {
    name: "Protocol is NOT paused (and is initialized)",
    run: async (conn) => {
      const cluster = loadCluster();
      const coreProgram = requireProgram(cluster, "core");
      const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);
      const info = await conn.getAccountInfo(configPda, "confirmed");
      if (!info) {
        throw new Error(
          `ProtocolConfig PDA ${configPda.toBase58()} not found — protocol not initialized on this cluster`,
        );
      }
      const cfg = readProtocolConfig(info.data);
      if (cfg.paused) {
        throw new Error(`ProtocolConfig.paused == true on mainnet — refusing to run canary`);
      }
      if (cfg.authority.equals(PublicKey.default)) {
        throw new Error(`ProtocolConfig.authority == Pubkey::default() — protocol not initialized`);
      }
      console.log(`  ProtocolConfig authority: ${cfg.authority.toBase58()}`);
    },
  },
  {
    // Adevar Labs W5 #10 + constants-audit follow-up (PR #340) — the
    // 6 default-permissive flags must be in their production-correct
    // state before the canary touches any user-bearing pool.
    //
    // Hard checks (refuse to run if wrong):
    //   - commit_reveal_required == true     (MEV mitigation active)
    //   - max_pool_tvl_usdc > 0              (per-pool TVL cap active)
    //   - max_protocol_tvl_usdc > 0          (protocol-wide cap active)
    //   - approved_yield_adapter != default  (allowlist set)
    //
    // Soft checks (warn-only — these are post-canary lock-downs):
    //   - approved_yield_adapter_locked == true
    //   - treasury_locked == true
    //
    // Locks are intentionally soft: during the canary itself, the
    // operator may still be rotating; the locks come at the end of
    // canary. The hard checks are non-negotiable.
    name: "Mainnet hardening flags (constants-audit follow-up + W5 #10)",
    run: async (conn) => {
      const cluster = loadCluster();
      const coreProgram = requireProgram(cluster, "core");
      const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);
      const info = await conn.getAccountInfo(configPda, "confirmed");
      if (!info) {
        throw new Error(`ProtocolConfig PDA not found at ${configPda.toBase58()}`);
      }
      const cfg = readProtocolConfig(info.data);

      const hardFailures: string[] = [];
      if (!cfg.commit_reveal_required) {
        hardFailures.push(
          "commit_reveal_required == false — MEV mitigation OFF (must be true on mainnet)",
        );
      }
      if (cfg.max_pool_tvl_usdc === 0n) {
        hardFailures.push("max_pool_tvl_usdc == 0 — per-pool TVL cap disabled");
      }
      if (cfg.max_protocol_tvl_usdc === 0n) {
        hardFailures.push("max_protocol_tvl_usdc == 0 — protocol TVL cap disabled");
      }
      if (cfg.approved_yield_adapter.equals(PublicKey.default)) {
        hardFailures.push(
          "approved_yield_adapter == Pubkey::default() — yield-adapter allowlist disabled",
        );
      }

      if (hardFailures.length > 0) {
        throw new Error(
          `mainnet hardening pre-flight FAILED:\n` +
            hardFailures.map((f) => `    • ${f}`).join("\n") +
            `\n  Fix via update_protocol_config + lock_treasury / lock_approved_yield_adapter ` +
            `before re-running the canary. See docs/operations/mainnet-canary-plan.md §3.`,
        );
      }

      // Soft checks — log warnings but don't refuse.
      const softWarnings: string[] = [];
      if (!cfg.approved_yield_adapter_locked) {
        softWarnings.push(
          "approved_yield_adapter_locked == false — call lock_approved_yield_adapter() post-canary",
        );
      }
      if (!cfg.treasury_locked) {
        softWarnings.push("treasury_locked == false — call lock_treasury() post-canary");
      }
      if (softWarnings.length > 0) {
        console.log("  ⚠️  soft warnings (post-canary action items):");
        for (const w of softWarnings) console.log(`     - ${w}`);
      }
      console.log(
        `  hardening state OK: pool_cap=${cfg.max_pool_tvl_usdc} ` +
          `protocol_cap=${cfg.max_protocol_tvl_usdc} ` +
          `adapter_set=${!cfg.approved_yield_adapter.equals(PublicKey.default)} ` +
          `commit_reveal=${cfg.commit_reveal_required}`,
      );
    },
  },
  {
    name: "USDC mainnet mint resolves and has decimals=6",
    run: async (conn) => {
      const cluster = loadCluster();
      const info = await conn.getAccountInfo(cluster.usdcMint, "confirmed");
      if (!info) throw new Error(`USDC mint ${cluster.usdcMint.toBase58()} not found`);
      // Mint layout decimals byte is at offset 44.
      const decimals = info.data[44];
      if (decimals !== 6) throw new Error(`USDC decimals = ${decimals}, expected 6`);
    },
  },
  {
    name: "mpl-core program is executable",
    run: async (conn) => {
      const cluster = loadCluster();
      const info = await conn.getAccountInfo(cluster.metaplexCore, "confirmed");
      if (!info) throw new Error("mpl-core program account not found");
      if (!info.executable) throw new Error("mpl-core program is not executable");
    },
  },
  {
    name: "Kamino canonical USDC reserve is initialized",
    run: async (_conn, _deployer) => {
      // TODO(#292 W2): assert the canonical Kamino USDC reserve account
      // exists + has expected discriminator. Requires #233 to ship a
      // pinned canonical reserve pubkey first.
      console.log("  ⚠️  SKIPPED: Kamino reserve check pending #233. Document in report.");
    },
  },
  {
    name: "Deployer SOL balance ≥ 0.5",
    run: async (conn, deployer) => {
      const lamports = await conn.getBalance(deployer.publicKey, "confirmed");
      const sol = lamports / 1e9;
      if (sol < 0.5) throw new Error(`deployer SOL ${sol} < 0.5`);
      console.log(`  deployer SOL balance: ${sol.toFixed(4)}`);
    },
  },
  {
    name: "Deployer USDC balance ≥ $10",
    run: async (_conn, _deployer) => {
      // TODO(#292 W2): derive deployer USDC ATA, read balance, assert
      // >= 10_000_000 (= $10 in base units).
      throw new Error("PreflightCheck NOT IMPLEMENTED — USDC balance check");
    },
  },
];

async function runPreflight(conn: Connection, deployer: Keypair): Promise<void> {
  console.log("─── Pre-flight checks ─────────────────────────────────────────");
  let pass = 0;
  let fail = 0;
  for (const check of PREFLIGHT_CHECKS) {
    process.stdout.write(`  ${check.name} ... `);
    try {
      await check.run(conn, deployer);
      console.log("✅");
      pass++;
    } catch (e) {
      console.log(`❌\n     ${(e as Error).message}`);
      fail++;
    }
  }
  console.log(`\n  ${pass} passed · ${fail} failed`);
  if (fail > 0) {
    throw new Error("Pre-flight failed. Fix issues + re-run. Do NOT proceed.");
  }
}

// ─── Canary steps (scaffold — full impl lands when run is authorized) ──

const STEPS = [
  "initialize_protocol",
  "create_pool",
  "init_pool_vaults",
  "join_pool",
  "contribute(cycle=0)",
  "claim_payout(cycle=0)",
  "release_escrow(checkpoint=1)",
  // Step 8 (yield branch) only if #233 has landed.
  // "deposit_idle_to_yield",
  // "harvest_yield",
  "close_pool",
] as const;

// ─── Entry point ─────────────────────────────────────────────────────────

function loadKeypair(path: string): Keypair {
  if (!existsSync(path)) {
    throw new Error(`keypair not found at ${path}`);
  }
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

async function main() {
  refuseIfNotMainnet();
  refuseUnlessExplicitAuthorization();

  const cluster = loadCluster();
  console.log(`\n🚦 RoundFi mainnet canary — cluster: ${cluster.name} · RPC: ${cluster.rpcUrl}\n`);

  const conn = new Connection(cluster.rpcUrl, "confirmed");

  // Deployer keypair must be the wallet that signs `join_pool` +
  // `contribute` + `claim_payout` + `release_escrow`. NOT a Squads
  // signer — Squads PDAs are admin-only for create_pool + close_pool.
  const deployerPath =
    process.env.CANARY_DEPLOYER_KEYPAIR ?? resolve(homedir(), ".config/solana/canary.json");
  const deployer = loadKeypair(deployerPath);
  console.log(`Deployer: ${deployer.publicKey.toBase58()}\n`);

  await runPreflight(conn, deployer);

  console.log("\n─── Canary sequence (not yet implemented) ─────────────────");
  for (let i = 0; i < STEPS.length; i++) {
    console.log(`  ${i + 1}. ${STEPS[i]}`);
  }
  console.log(
    "\nStep handlers will be wired when the run is authorized.\n" +
      "See docs/operations/mainnet-canary-plan.md §4 for the spec each step must implement.",
  );

  throw new Error(
    "Step handlers not implemented. This script is a scaffold + pre-flight gate;\n" +
      "full step implementations land in a follow-up PR after the pre-flight\n" +
      "blockers (#266, #267, #230, #233, #268) clear.",
  );
}

main().catch((e) => {
  console.error(`\n❌ ${(e as Error).message}\n`);
  process.exit(1);
});

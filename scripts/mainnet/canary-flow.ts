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

import { Connection, Keypair } from "@solana/web3.js";

import { loadCluster } from "../../config/clusters.js";

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
    run: async (_conn, _deployer) => {
      // TODO(#292 W2): port the protocol-config decoder from
      // scripts/devnet/init-protocol.ts:read_protocol_config(). Read
      // ProtocolConfig PDA, assert paused == false, assert authority ==
      // squads_pda. Abort if not.
      throw new Error("PreflightCheck NOT IMPLEMENTED — wire decoder before run");
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

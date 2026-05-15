/**
 * Squads rehearsal — `ProtocolConfig` authority surface inspector.
 *
 * Read-only utility. Fetches the ProtocolConfig PDA from the configured
 * cluster, decodes the authority-rotation surface (live authority +
 * pending proposal + eta), and prints a status block suitable for
 * pasting into a rehearsal-log markdown.
 *
 * Used between each step of the Squads rotation rehearsal to confirm
 * on-chain state evolves as expected:
 *
 *   pre-propose      → authority=<deployer>, pending=default, eta=0
 *   post-propose     → authority=<deployer>, pending=<vault>, eta=now+7d
 *   post-cancel      → authority=<deployer>, pending=default, eta=0
 *   post-commit      → authority=<vault>,    pending=default, eta=0
 *
 * Closes part of Fase B (devnet rehearsal scripts) of the Squads
 * ceremony preparation track. See PR #323 for the on-chain instructions
 * this script reads.
 *
 * ## Usage
 *
 * ```bash
 * pnpm tsx scripts/devnet/squads-rehearsal-verify.ts
 * ```
 *
 * No flags — cluster is loaded from the standard env (`CLUSTER`,
 * `RPC_URL`, etc. — see `config/clusters.ts`).
 */

import { Connection, PublicKey } from "@solana/web3.js";

import { loadCluster, requireProgram } from "../../config/clusters.js";

// ─── ProtocolConfig field offsets ───────────────────────────────────────
//
// Mirrors the declaration order in
// `programs/roundfi-core/src/state/config.rs`. Anchor uses Borsh in
// struct-field order with no padding between fields, so offsets are
// computed by summing widths up to (but not including) the target
// field. The 8-byte Anchor discriminator prefix is included.

const OFFSET_AUTHORITY = 8;
const OFFSET_PENDING_TREASURY = 213;
const OFFSET_PENDING_TREASURY_ETA = 245;
const OFFSET_PENDING_AUTHORITY = 311; // (NEW in PR #323)
const OFFSET_PENDING_AUTHORITY_ETA = 343; // (NEW in PR #323)
const PROTOCOL_CONFIG_SIZE = 381;

interface AuthorityRotationView {
  authority: PublicKey;
  pendingAuthority: PublicKey;
  pendingAuthorityEta: bigint;
  pendingTreasury: PublicKey;
  pendingTreasuryEta: bigint;
}

function decodeAuthorityRotation(data: Buffer): AuthorityRotationView {
  if (data.length !== PROTOCOL_CONFIG_SIZE) {
    throw new Error(
      `ProtocolConfig has unexpected size ${data.length} (expected ${PROTOCOL_CONFIG_SIZE}). ` +
        `Either the protocol was initialized under an older version of the program (pre-PR #323), ` +
        `or the offsets in this script have drifted from the on-chain layout.`,
    );
  }
  return {
    authority: new PublicKey(data.subarray(OFFSET_AUTHORITY, OFFSET_AUTHORITY + 32)),
    pendingAuthority: new PublicKey(
      data.subarray(OFFSET_PENDING_AUTHORITY, OFFSET_PENDING_AUTHORITY + 32),
    ),
    pendingAuthorityEta: data.readBigInt64LE(OFFSET_PENDING_AUTHORITY_ETA),
    pendingTreasury: new PublicKey(
      data.subarray(OFFSET_PENDING_TREASURY, OFFSET_PENDING_TREASURY + 32),
    ),
    pendingTreasuryEta: data.readBigInt64LE(OFFSET_PENDING_TREASURY_ETA),
  };
}

function formatUnixTs(ts: bigint): string {
  if (ts === 0n) return "0 (no proposal)";
  const ms = Number(ts) * 1_000;
  const iso = new Date(ms).toISOString();
  const now = Math.floor(Date.now() / 1000);
  const delta = Number(ts) - now;
  if (delta > 0) {
    return `${ts} (${iso}, in ${formatDuration(delta)})`;
  }
  return `${ts} (${iso}, ${formatDuration(-delta)} ago — commit-eligible)`;
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
}

function classifyAuthorityRotation(view: AuthorityRotationView): string {
  const noPending = view.pendingAuthority.equals(PublicKey.default);
  if (noPending) {
    return "✓ Idle — no authority rotation in flight";
  }
  const now = Math.floor(Date.now() / 1000);
  if (Number(view.pendingAuthorityEta) > now) {
    return "⏳ Pending — proposal staged, timelock active";
  }
  return "🟢 Commit-ready — eta elapsed, anyone can crank `commit_new_authority`";
}

async function main(): Promise<void> {
  const cluster = loadCluster();
  console.log(`\n━━━ Squads rehearsal verify → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);

  const coreProgram = requireProgram(cluster, "core");
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);

  console.log(`→ Core program       : ${coreProgram.toBase58()}`);
  console.log(`→ ProtocolConfig PDA : ${configPda.toBase58()}\n`);

  const connection = new Connection(cluster.rpcUrl, "confirmed");
  const info = await connection.getAccountInfo(configPda, "confirmed");
  if (!info) {
    throw new Error(
      `ProtocolConfig not found at ${configPda.toBase58()}. ` +
        `Run init-protocol.ts first to bootstrap the singleton on this cluster.`,
    );
  }

  const view = decodeAuthorityRotation(info.data as Buffer);

  console.log("─── Authority rotation surface ──────────────────────────");
  console.log(`  Live authority       : ${view.authority.toBase58()}`);
  console.log(`  Pending authority    : ${view.pendingAuthority.toBase58()}`);
  console.log(`  Pending authority eta: ${formatUnixTs(view.pendingAuthorityEta)}`);
  console.log("");
  console.log(`  ${classifyAuthorityRotation(view)}`);
  console.log("");
  console.log("─── Treasury rotation surface (for cross-context) ──────");
  console.log(`  Pending treasury     : ${view.pendingTreasury.toBase58()}`);
  console.log(`  Pending treasury eta : ${formatUnixTs(view.pendingTreasuryEta)}`);
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log("Paste this block into the rehearsal log at the");
  console.log("corresponding step. See docs/operations/rehearsal-logs/");
  console.log("TEMPLATE-squads-rotation.md for the canonical structure.");
  console.log("");
}

main().catch((e) => {
  console.error("\n✗ squads-rehearsal-verify failed:");
  console.error(e);
  process.exit(1);
});

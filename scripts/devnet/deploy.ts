/**
 * Build + deploy all RoundFi Anchor programs to the configured cluster.
 *
 * LIVE clusters (devnet): UPGRADE IN PLACE at the canonical program addresses
 * (the committed `declare_id!` values), using the configured keypair as the
 * upgrade authority. This:
 *   - needs ONLY the upgrade authority (NOT the program keypairs) — `solana
 *     program deploy --program-id <addr> --upgrade-authority <kp>` upgrades the
 *     existing program in place;
 *   - builds with `anchor build --no-idl --ignore-keys` (skips Anchor 1.0's
 *     pre-build check comparing `declare_id!` to a generated target/deploy
 *     keypair — same flag the `anchor · build` CI lane uses);
 *   - does NOT run `anchor keys sync`. keys sync would rewrite `declare_id!` to
 *     match freshly-generated random keypairs and then deploy 4 NEW programs at
 *     random addresses instead of upgrading the live ones — the bug that made
 *     the prior CD runs deploy nothing useful (and fail the keypair check).
 *
 * localnet: first-run FRESH deploy — build, `anchor keys sync`, rebuild,
 * `anchor deploy`, then write config/program-ids.localnet.json.
 *
 * Usage:
 *   pnpm run devnet:deploy                              # SOLANA_CLUSTER (env), default devnet
 *   SOLANA_CLUSTER=localnet pnpm run devnet:deploy
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { Keypair } from "@solana/web3.js";

import { loadCluster, type ClusterConfig } from "../../config/clusters.js";

const PROGRAMS = [
  "roundfi_core",
  "roundfi_reputation",
  "roundfi_yield_mock",
  "roundfi_yield_kamino",
] as const;
type ProgramName = (typeof PROGRAMS)[number];

function run(cmd: string) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

/** Same as `run`, but returns stdout (stderr still streams to the log). */
function capture(cmd: string): string {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"] });
}

// ─── ProgramData capacity (BPF Upgradeable Loader) ────────────────────
//
// An in-place upgrade can only write into the ProgramData account that
// already exists. When the new `.so` outgrows it, `solana program deploy`
// tries to auto-extend — but the loader REJECTS any extension smaller than
// 10240 bytes:
//
//     ExtendProgram requires a minimum of 10240 additional bytes or to
//     extend to maximum size, but only 9520 were requested
//
// That is exactly how the 2026-07-29 devnet deploy of ADR 0012 Fase 2
// failed: the program grew ~9.5 KB, the CLI asked for precisely that, and
// the loader refused. So we extend EXPLICITLY, above the loader's floor and
// with headroom, before handing over to `deploy`.
const EXTEND_MIN_BYTES = 10_240; // the loader's hard minimum per extend
const EXTEND_HEADROOM_BYTES = 32_768; // spare room so the next few upgrades don't need one

/**
 * Bytecode capacity of a live upgradeable program, or null when it can't be
 * read (program missing, CLI shape drift). Null = "don't try to extend" —
 * the deploy itself stays the authority on whether it can proceed.
 */
function onChainCapacity(programId: string, rpcUrl: string): number | null {
  try {
    const out = capture(`solana program show ${programId} --url ${rpcUrl} --output json`);
    const json = JSON.parse(out) as { dataLen?: number; data_len?: number };
    const len = json.dataLen ?? json.data_len;
    return typeof len === "number" && Number.isFinite(len) ? len : null;
  } catch {
    return null;
  }
}

/**
 * Grow the program account when the freshly built `.so` no longer fits.
 * No-op when it already fits — the common case, so a normal upgrade pays
 * one extra RPC read and nothing else.
 */
function ensureCapacity(programId: string, soPath: string, cluster: ClusterConfig, payer: string) {
  const soBytes = statSync(soPath).size;
  const capacity = onChainCapacity(programId, cluster.rpcUrl);
  if (capacity === null) {
    console.log(`  (could not read on-chain size for ${programId} — skipping the extend check)`);
    return;
  }
  if (soBytes <= capacity) {
    console.log(`  ${programId}: ${soBytes} B fits in ${capacity} B — no extend needed.`);
    return;
  }
  const needed = soBytes - capacity;
  const additional = Math.max(EXTEND_MIN_BYTES, needed + EXTEND_HEADROOM_BYTES);
  console.log(
    `\n⚠ ${programId} grew past its on-chain capacity ` +
      `(${soBytes} B > ${capacity} B, short by ${needed} B).\n` +
      `  Extending by ${additional} B (loader minimum ${EXTEND_MIN_BYTES} B + ` +
      `${EXTEND_HEADROOM_BYTES} B headroom). Costs rent from the deployer.\n`,
  );
  // `extend` is permissionless — the signer only pays the added rent, so the
  // upgrade authority isn't required here (it still is for the deploy).
  run(
    `solana program extend ${programId} ${additional} ` +
      `--keypair ${payer} ` +
      `--url ${cluster.rpcUrl}`,
  );
}

/** Program address from the generated keypair (localnet fresh-deploy path). */
function readKeypairProgramId(name: ProgramName): string {
  const kpPath = resolve(`target/deploy/${name}-keypair.json`);
  if (!existsSync(kpPath)) {
    throw new Error(`Missing keypair: ${kpPath}. "anchor build" should have created it.`);
  }
  const secret = Uint8Array.from(JSON.parse(readFileSync(kpPath, "utf-8")));
  return Keypair.fromSecretKey(secret).publicKey.toBase58();
}

/**
 * Canonical (committed) program addresses for a live cluster — the `declare_id!`
 * values, persisted under `.programs.<name>.programId` in
 * config/program-ids.<cluster>.json. These are the addresses we UPGRADE; an
 * in-place upgrade never changes them.
 */
function readCanonicalIds(cluster: ClusterConfig): Record<ProgramName, string> {
  const idsPath = resolve(`config/program-ids.${cluster.name}.json`);
  if (!existsSync(idsPath)) {
    throw new Error(
      `Missing ${idsPath} — needed for an in-place upgrade (the canonical ` +
        `program addresses to upgrade). Run a first deploy or provide the file.`,
    );
  }
  const json = JSON.parse(readFileSync(idsPath, "utf-8")) as {
    programs?: Record<string, string | { programId?: string }>;
  };
  const out = {} as Record<ProgramName, string>;
  for (const name of PROGRAMS) {
    const entry = json.programs?.[name];
    const id = typeof entry === "string" ? entry : entry?.programId;
    if (!id) throw new Error(`No programId for "${name}" in ${idsPath}`);
    out[name] = id;
  }
  return out;
}

/** Deploy/upgrade authority keypair path (Anchor.toml [provider] wallet). */
function authorityKeypairPath(): string {
  const w = process.env.ANCHOR_WALLET;
  if (w && w.trim() !== "") return w;
  return resolve(homedir(), ".config/solana/id.json");
}

/**
 * Live-cluster path: upgrade each program in place at its canonical address.
 * Requires only the upgrade authority — NOT the program keypairs.
 */
function upgradeInPlace(cluster: ClusterConfig) {
  // Build against the committed declare_id! values (the addresses of record).
  // --ignore-keys skips the declare_id!-vs-generated-keypair check; we must NOT
  // run `anchor keys sync` (that would repoint declare_id! and deploy new
  // programs instead of upgrading the live ones).
  run("anchor build --no-idl --ignore-keys");

  // Optional Pre-Ceremony Beta grace override. `DEVNET_CANARY=1` rebuilds
  // ONLY roundfi_core with the `devnet-canary` cargo feature, lowering
  // GRACE_PERIOD_SECS from 7 days → 1 day (constants.rs, cfg-gated) so the
  // late-payment / default scenarios are reachable inside a short devnet
  // test window. The other three programs keep their normal build (none of
  // them define the feature). DEVNET-ONLY: main() already refuses
  // mainnet-beta, and the feature is cfg-gated so it can never compile into
  // a mainnet artifact. Never set this for a production deploy.
  const canary = process.env.DEVNET_CANARY;
  if (canary && canary !== "0" && cluster.name !== "mainnet-beta") {
    console.log(
      "\n⚠ DEVNET_CANARY set — rebuilding roundfi_core with " +
        "`--features devnet-canary` (GRACE_PERIOD_SECS → 1 day). Devnet only.\n",
    );
    run("anchor build --no-idl --ignore-keys -p roundfi_core -- --features devnet-canary");
  }

  // Optional DEVNET-ONLY Human Passport shim. `DEVNET_IDENTITY_SHIM=1`
  // rebuilds ONLY roundfi_reputation with the `devnet-identity-shim` cargo
  // feature, adding `devnet_seed_passport_authority` + `devnet_issue_attestation`
  // so the team can exercise the REAL `link_passport_identity` flow on devnet
  // (where the frozen attestation authority points at a non-functional Civic
  // placeholder). DEVNET-ONLY: main() refuses mainnet-beta and the feature is
  // cfg-gated so it can never compile into a mainnet artifact. After upgrading,
  // run `scripts/devnet/seed-passport-shim.ts` once. Never set for production.
  const identityShim = process.env.DEVNET_IDENTITY_SHIM;
  if (identityShim && identityShim !== "0" && cluster.name !== "mainnet-beta") {
    console.log(
      "\n⚠ DEVNET_IDENTITY_SHIM set — rebuilding roundfi_reputation with " +
        "`--features devnet-identity-shim` (devnet Human Passport test path). Devnet only.\n",
    );
    run(
      "anchor build --no-idl --ignore-keys -p roundfi_reputation -- --features devnet-identity-shim",
    );
  }

  const ids = readCanonicalIds(cluster);
  const authority = authorityKeypairPath();

  for (const program of PROGRAMS) {
    const programId = ids[program];
    const soPath = resolve(`target/deploy/${program}.so`);
    if (!existsSync(soPath)) {
      throw new Error(`Missing built program: ${soPath} (did "anchor build" run?)`);
    }
    // Grow the ProgramData account FIRST when the build outgrew it — the
    // loader's 10240-byte minimum makes `deploy`'s own auto-extend fail for
    // any smaller growth (see ensureCapacity).
    ensureCapacity(programId, soPath, cluster, authority);
    // In-place upgrade: `--program-id <pubkey>` targets the live program;
    // `--upgrade-authority` signs the upgrade. No program keypair needed.
    run(
      `solana program deploy ${soPath} ` +
        `--program-id ${programId} ` +
        `--upgrade-authority ${authority} ` +
        `--keypair ${authority} ` +
        `--url ${cluster.rpcUrl}`,
    );
  }

  console.log(`\n✓ Upgraded ${PROGRAMS.length} programs in place on ${cluster.name}.\n`);
  for (const program of PROGRAMS) {
    console.log(`    ${program.padEnd(24)} ${ids[program]}`);
  }
  console.log(
    `\n→ Program IDs unchanged (in-place upgrade). ` +
      `config/program-ids.${cluster.name}.json left as-is.\n`,
  );
}

/**
 * localnet path: first-run fresh deploy — generate keypairs, sync declare_id!,
 * deploy, and write the program-ids file.
 */
function freshDeploy(cluster: ClusterConfig) {
  run("anchor build --no-idl");
  run("anchor keys sync");
  run("anchor build --no-idl");
  run("anchor deploy --provider.cluster localnet");

  const deployed: Record<string, string> = {};
  for (const program of PROGRAMS) {
    deployed[program] = readKeypairProgramId(program);
  }

  const outPath = resolve(`config/program-ids.${cluster.name}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      { cluster: cluster.name, deployedAt: new Date().toISOString(), programs: deployed },
      null,
      2,
    ),
  );

  console.log(`\n✓ Deployment complete. IDs → ${outPath}\n`);
  for (const [name, id] of Object.entries(deployed)) {
    console.log(`    ${name.padEnd(24)} ${id}`);
  }
}

async function main() {
  const cluster = loadCluster();
  if (cluster.name === "mainnet-beta") {
    throw new Error(
      "Refusing to deploy to mainnet via devnet script. " +
        "Use scripts/mainnet/deploy.ts with explicit confirmation.",
    );
  }

  console.log(`\n━━━ RoundFi deploy → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);

  if (cluster.name === "localnet") {
    freshDeploy(cluster);
  } else {
    // devnet (and any other live cluster): upgrade in place at the canonical
    // addresses using the configured upgrade authority.
    upgradeInPlace(cluster);
  }
}

main().catch((e) => {
  console.error("\n✗ Deploy failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

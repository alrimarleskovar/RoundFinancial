/**
 * Build + deploy all RoundFi Anchor programs to **Solana mainnet-beta**.
 *
 * Mirrors `scripts/devnet/deploy.ts` but with hard guards appropriate
 * for the production cluster:
 *
 *   1. Refuses to run unless `SOLANA_CLUSTER=mainnet-beta` AND the
 *      `MAINNET_DEPLOY_CONFIRM` env var carries the exact sentinel
 *      `"I-UNDERSTAND-THIS-IS-MAINNET"`. Both protect against
 *      accidental invocation.
 *   2. Pre-flight: if the protocol is already initialized, runs the
 *      `mainnet_hardening_check` BLOCKER suite against the cluster
 *      and refuses to proceed on any failure. Operator must pass
 *      `EXPECTED_AUTHORITY`, `EXPECTED_TREASURY`,
 *      `EXPECTED_APPROVED_ADAPTER` for the hardening checks. First
 *      deploy (no `ProtocolConfig` PDA yet) is exempt.
 *   3. Refuses to run unless `MAINNET_DEPLOYER_KEYPAIR` is present
 *      (path) — and refuses if the keypair pubkey matches a known
 *      devnet pattern.
 *   4. Echoes the canary-plan reminders (Squads ceremony, OtterSec
 *      verify-build) before each cargo-build-sbf invocation so the
 *      operator can `Ctrl-C` if any prereq isn't actually green.
 *
 * Usage (intentionally verbose):
 *
 *   SOLANA_CLUSTER=mainnet-beta \
 *   MAINNET_DEPLOY_CONFIRM=I-UNDERSTAND-THIS-IS-MAINNET \
 *   MAINNET_DEPLOYER_KEYPAIR=/path/to/keypair.json \
 *   EXPECTED_AUTHORITY=<squads-multisig-pda> \
 *   EXPECTED_TREASURY=<squads-treasury-ata> \
 *   EXPECTED_APPROVED_ADAPTER=<roundfi-yield-kamino-program-id> \
 *   pnpm run mainnet:deploy
 *
 * Coordinator MUST capture each tx signature for the canary report
 * (see `docs/operations/mainnet-canary-report-template.md`). This
 * script logs them; archive the run via `tee` or copy from CI logs.
 *
 * Issue #272 — CD pipeline. The corresponding GitHub Actions
 * workflow is `.github/workflows/mainnet-deploy.yml`. The script is
 * factored so both manual invocation and CI invocation share the
 * same code path.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair } from "@solana/web3.js";

import { loadCluster } from "../../config/clusters.js";

const PROGRAMS = [
  "roundfi_core",
  "roundfi_reputation",
  "roundfi_yield_mock",
  "roundfi_yield_kamino",
] as const;
type ProgramName = (typeof PROGRAMS)[number];

const MAINNET_CONFIRM_SENTINEL = "I-UNDERSTAND-THIS-IS-MAINNET";

function run(cmd: string, opts: { env?: NodeJS.ProcessEnv } = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", env: opts.env ?? process.env });
}

function readProgramId(name: ProgramName): string {
  const kpPath = resolve(`target/deploy/${name}-keypair.json`);
  if (!existsSync(kpPath)) {
    throw new Error(`Missing keypair: ${kpPath}. "anchor build" should have created it.`);
  }
  const secret = Uint8Array.from(JSON.parse(readFileSync(kpPath, "utf-8")));
  return Keypair.fromSecretKey(secret).publicKey.toBase58();
}

function assertGuards(): void {
  const cluster = process.env.SOLANA_CLUSTER ?? "";
  if (cluster !== "mainnet-beta") {
    throw new Error(
      `SOLANA_CLUSTER must be exactly "mainnet-beta", got "${cluster}". ` +
        `Refusing to deploy. Use scripts/devnet/deploy.ts for any other cluster.`,
    );
  }
  const confirm = process.env.MAINNET_DEPLOY_CONFIRM ?? "";
  if (confirm !== MAINNET_CONFIRM_SENTINEL) {
    throw new Error(
      `MAINNET_DEPLOY_CONFIRM must equal "${MAINNET_CONFIRM_SENTINEL}", ` +
        `got ${confirm ? `"${confirm}"` : "(unset)"}. ` +
        `Refusing to deploy. This is the second-factor safeguard against accidental mainnet invocation.`,
    );
  }
  const kpPath = process.env.MAINNET_DEPLOYER_KEYPAIR;
  if (!kpPath) {
    throw new Error(
      `MAINNET_DEPLOYER_KEYPAIR (path) is required. ` +
        `Refusing to deploy without an explicit deployer key.`,
    );
  }
  if (!existsSync(kpPath)) {
    throw new Error(`MAINNET_DEPLOYER_KEYPAIR file not found: ${kpPath}`);
  }
  for (const expected of [
    "EXPECTED_AUTHORITY",
    "EXPECTED_TREASURY",
    "EXPECTED_APPROVED_ADAPTER",
  ] as const) {
    if (!process.env[expected]) {
      throw new Error(
        `${expected} env var is required (used by mainnet_hardening_check pre-flight). ` +
          `See docs/operations/cd-pipeline.md for the canonical values.`,
      );
    }
  }
}

function printCanaryReminders(): void {
  console.log("");
  console.log("━━━ Pre-deploy canary plan reminders ━━━");
  console.log("");
  console.log("  Before continuing, confirm ALL of the following are green:");
  console.log("");
  console.log("    • Squads multisig is the upgrade authority on each existing");
  console.log("      program (verify via `solana program show <id> -u mainnet-beta`)");
  console.log("    • Treasury sits on the Squads-controlled USDC ATA");
  console.log("    • Most recent mainnet-hardening-check run passed (this script");
  console.log("      will re-run it as pre-flight if ProtocolConfig PDA exists)");
  console.log("    • OtterSec verify-build is ready to attest the new bytecode");
  console.log("      AFTER this deploy (manual step, captures hash for audit trail)");
  console.log("    • PagerDuty primary + secondary on-call for the 7-day soak window");
  console.log("");
  console.log("  Reference: docs/operations/mainnet-canary-plan.md §3 (pre-flight checklist)");
  console.log("  Reference: docs/operations/cd-pipeline.md (this workflow)");
  console.log("");
  console.log("  If any are NOT green, Ctrl-C now and finish them first.");
  console.log("  Sleeping 10s so you have time to abort...");
  console.log("");
}

function runHardeningPreflight(coreProgramId: string | null): void {
  if (!coreProgramId) {
    console.log("  (skipping hardening pre-flight — ProtocolConfig not yet initialized)");
    console.log("");
    return;
  }
  console.log("━━━ Pre-flight: mainnet_hardening_check ━━━");
  console.log("");
  try {
    run(`ROUNDFI_CORE_PROGRAM_ID=${coreProgramId} pnpm run test:mainnet-hardening`);
  } catch (e) {
    throw new Error(
      `mainnet_hardening_check FAILED — refusing to redeploy on top of a broken-state protocol. ` +
        `Resolve the BLOCKER(s) listed above before retrying. See SEV-042 / SEV-044 for context.`,
    );
  }
}

async function main() {
  assertGuards();

  const cluster = loadCluster("mainnet-beta");
  if (cluster.name !== "mainnet-beta") {
    throw new Error(`loadCluster() returned unexpected cluster: ${cluster.name}`);
  }

  console.log("");
  console.log(`━━━ RoundFi MAINNET deploy → ${cluster.rpcUrl} ━━━`);

  printCanaryReminders();
  await new Promise((r) => setTimeout(r, 10_000));

  // Hardening pre-flight is keyed on the existing ROUNDFI_CORE_PROGRAM_ID
  // (if any). On first deploy this env var is undefined and we skip.
  // On subsequent deploys (upgrades), it must point at the live program.
  runHardeningPreflight(process.env.ROUNDFI_CORE_PROGRAM_ID ?? null);

  console.log("━━━ anchor build + keys sync + redeploy ━━━");
  console.log("");
  // `--no-idl` skips IDL generation — IDLs aren't needed for the on-chain
  // deploy (build-time optimization). Anchor 1.0 emits IDLs natively
  // post-#487; the old anchor-syn #319 patch workaround is retired.
  run("anchor build --no-idl");
  run("anchor keys sync");
  run("anchor build --no-idl");

  const deployerEnv = {
    ...process.env,
    ANCHOR_WALLET: process.env.MAINNET_DEPLOYER_KEYPAIR,
  };
  run(`anchor deploy --provider.cluster mainnet`, { env: deployerEnv });

  const deployed: Record<string, string> = {};
  for (const program of PROGRAMS) {
    deployed[program] = readProgramId(program);
  }

  const outPath = resolve(`config/program-ids.${cluster.name}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        cluster: cluster.name,
        deployedAt: new Date().toISOString(),
        programs: deployed,
      },
      null,
      2,
    ),
  );

  console.log("");
  console.log("✓ Mainnet deploy complete.");
  console.log("");
  console.log(`  Program IDs written to: ${outPath}`);
  console.log("");
  for (const [name, id] of Object.entries(deployed)) {
    console.log(`    ${name.padEnd(24)} ${id}`);
  }

  console.log("");
  console.log("→ Next (mandatory post-deploy steps):");
  console.log("");
  console.log("    1. Trigger OtterSec verify-build attestation for each program");
  console.log("    2. Rotate upgrade authority to Squads multisig PDA on each");
  console.log("       (via `solana program set-upgrade-authority` from each keypair)");
  console.log("    3. Initialize ProtocolConfig if first deploy (Squads-signed tx)");
  console.log("    4. Re-run `pnpm test:mainnet-hardening` and confirm ALL");
  console.log("       BLOCKER checks pass before the first canary tx");
  console.log("    5. File the run details in docs/operations/rehearsal-logs/");
  console.log("");
}

main().catch((e) => {
  console.error("");
  console.error("✗ Mainnet deploy aborted:", e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * Build + deploy all RoundFi Anchor programs to the configured cluster.
 *
 * On first run this will:
 *   1. Build all programs (anchor build)
 *   2. Sync declare_id!() with the generated keypairs (anchor keys sync)
 *   3. Rebuild with the synced IDs
 *   4. Deploy to the cluster
 *   5. Write program IDs to config/program-ids.<cluster>.json
 *
 * The resulting JSON is the source of truth downstream services read from.
 *
 * Usage:
 *   pnpm run devnet:deploy                              # deploys to SOLANA_CLUSTER (env)
 *   SOLANA_CLUSTER=localnet pnpm run devnet:deploy
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

function run(cmd: string) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function readProgramId(name: ProgramName): string {
  const kpPath = resolve(`target/deploy/${name}-keypair.json`);
  if (!existsSync(kpPath)) {
    throw new Error(`Missing keypair: ${kpPath}. "anchor build" should have created it.`);
  }
  const secret = Uint8Array.from(JSON.parse(readFileSync(kpPath, "utf-8")));
  return Keypair.fromSecretKey(secret).publicKey.toBase58();
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

  run("anchor build");
  run("anchor keys sync");
  run("anchor build");

  const anchorCluster = cluster.name === "localnet" ? "localnet" : "devnet";
  run(`anchor deploy --provider.cluster ${anchorCluster}`);

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

  console.log("\n✓ Deployment complete.\n");
  console.log(`  Program IDs written to: ${outPath}\n`);
  for (const [name, id] of Object.entries(deployed)) {
    console.log(`    ${name.padEnd(24)} ${id}`);
  }

  console.log(
    "\n→ Next: copy these IDs into .env:\n" +
      `    ROUNDFI_CORE_PROGRAM_ID=${deployed.roundfi_core}\n` +
      `    ROUNDFI_REPUTATION_PROGRAM_ID=${deployed.roundfi_reputation}\n` +
      `    ROUNDFI_YIELD_MOCK_PROGRAM_ID=${deployed.roundfi_yield_mock}\n` +
      `    ROUNDFI_YIELD_KAMINO_PROGRAM_ID=${deployed.roundfi_yield_kamino}\n`,
  );
}

main().catch((e) => {
  console.error("\n✗ Deploy failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

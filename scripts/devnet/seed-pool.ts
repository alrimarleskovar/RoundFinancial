/**
 * Seed a demo pool on Devnet for the hackathon demo.
 *
 * Creates a 24-member pool with default parameters, funds a handful of
 * test wallets with USDC (Devnet faucet) and walks them through the
 * first cycle so the frontend has live data on first load.
 *
 * Implementation lands in Step 4/8 once the core program exposes
 * create_pool / join_pool. This file is a stub.
 */

import { loadCluster, requireProgram } from "../../config/clusters.js";

async function main() {
  const cluster = loadCluster();
  console.log(`\n━━━ RoundFi seed-pool → ${cluster.name} ━━━\n`);

  requireProgram(cluster, "core");

  console.log("TODO: create_pool + join_pool for N test wallets.");
  console.log("      Implementation lands in Step 4/8.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

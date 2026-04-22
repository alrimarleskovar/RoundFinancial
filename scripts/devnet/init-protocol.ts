/**
 * Initialize the singleton ProtocolConfig account on-chain.
 *
 * Runs once per cluster after `devnet:deploy`. Populates the fee schedule,
 * treasury ATA, default yield adapter, and reputation program reference.
 *
 * Implementation lands in Step 4 (after the `initialize_protocol` instruction
 * is written). This file is a stub so the workspace scripts target exists.
 */

import { loadCluster, requireProgram } from "../../config/clusters.js";

async function main() {
  const cluster = loadCluster();
  console.log(`\n━━━ RoundFi init-protocol → ${cluster.name} ━━━\n`);

  // Smoke check: make sure program IDs are populated before we try anything.
  requireProgram(cluster, "core");
  requireProgram(cluster, "reputation");

  console.log("TODO: call roundfi_core.initialize_protocol(...) with the fee schedule.");
  console.log("      Implementation lands in Step 4.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

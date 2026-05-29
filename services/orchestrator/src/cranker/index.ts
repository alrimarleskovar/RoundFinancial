/**
 * Cranker entry point — long-running process that polls watched pools
 * and fires settle_default for any member past the grace window.
 *
 * Run:
 *   pnpm --filter @roundfi/orchestrator cranker
 *
 * Required env (see config.ts):
 *   CRANKER_KEYPAIR_PATH, CRANKER_POOLS, SOLANA_RPC_URL, USDC_MINT,
 *   ROUNDFI_CORE_PROGRAM_ID, ROUNDFI_REPUTATION_PROGRAM_ID
 *
 * Optional:
 *   CRANKER_POLL_INTERVAL_MS (default 60000)
 *   CRANKER_GRACE_SECONDS    (default 604800 = 7d; devnet = 60)
 *   CRANKER_HTTP_PORT        (default 8080)
 *
 * Shutdown: SIGINT / SIGTERM stop the HTTP server and exit cleanly.
 * The poll loop is non-cancellable but a process exit kills it.
 */

import { Connection } from "@solana/web3.js";

import { loadConfig } from "./config.js";
import { startHealthServer } from "./healthcheck.js";
import { runCrankerLoop } from "./loop.js";
import { newState } from "./state.js";

function ts(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${ts()}] ${msg}`);
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const state = newState();

  log(
    `cranker starting · pools=${cfg.pools.length} ` +
      `interval=${cfg.pollIntervalMs}ms grace=${cfg.graceSeconds}s ` +
      `http=:${cfg.httpPort} rpc=${cfg.rpcUrl}`,
  );

  const server = startHealthServer(state, cfg.httpPort, log);
  const connection = new Connection(cfg.rpcUrl, "confirmed");

  const shutdown = (sig: string): void => {
    log(`${sig} received, shutting down`);
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await runCrankerLoop(connection, cfg, state, log);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.stack ?? e.message : String(e);
  console.error(`[${ts()}] cranker crashed: ${msg}`);
  process.exit(1);
});

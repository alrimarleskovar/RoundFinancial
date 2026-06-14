/**
 * RoundFi crank — entrypoint.
 *
 * Boots the health server, optional Postgres lease, and the polling
 * loop. Wires SIGTERM/SIGINT to a graceful shutdown so Railway
 * redeploys don't leave a half-finished settle in the air.
 *
 * Env vars (see README):
 *   SOLANA_RPC_URL           required — devnet/mainnet RPC
 *   ROUNDFI_CORE_PROGRAM_ID  required
 *   ROUNDFI_REPUTATION_PROGRAM_ID required
 *   CRANK_KEYPAIR            required — base58 of the cranker keypair
 *                            (pays gas on settle_default; must hold SOL)
 *   ROUNDFI_IDL_DIR          default `./target/idl` — directory with
 *                            roundfi_core.json + roundfi_reputation.json
 *                            + roundfi_yield_mock.json (anchor build output)
 *   POLL_INTERVAL_MS         default 60000
 *   HEALTH_PORT              default 3000
 *   CRANK_LEASE_ENABLED      "true" to enable Postgres lease (multi-replica)
 *   DATABASE_URL             required if CRANK_LEASE_ENABLED=true
 *
 * Exit codes:
 *   0  — graceful shutdown (SIGTERM/SIGINT)
 *   1  — startup config error (missing env, bad keypair, RPC unreachable)
 *
 * The crank ITSELF never exits on a runtime error — pollingLoop's
 * try/catch keeps it running. Exit=1 is reserved for config issues
 * that make startup impossible.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AnchorProvider, Wallet, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

import { createClient } from "@roundfi/sdk";

import { crankState } from "./crankState.js";
import { startHealthServer } from "./healthServer.js";
import { createPostgresLease, noopLease, type LeaseClient } from "./lease.js";
import { logger } from "./logger.js";
import { startPollingLoop } from "./pollingLoop.js";

function readRequiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    logger.error({ event_type: "startup.missing_env", name }, `Missing env var: ${name}`);
    process.exit(1);
  }
  return v.trim();
}

function loadKeypair(): Keypair {
  const raw = readRequiredEnv("CRANK_KEYPAIR");
  try {
    // Accept JSON array (Solana CLI export) — base58 (devnet/local) also fine.
    if (raw.startsWith("[")) {
      const arr = JSON.parse(raw) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    }
    return Keypair.fromSecretKey(bs58.decode(raw));
  } catch (err) {
    logger.error(
      {
        event_type: "startup.bad_keypair",
        error: err instanceof Error ? err.message : String(err),
      },
      "CRANK_KEYPAIR is not a valid base58 secret key or JSON array",
    );
    process.exit(1);
  }
}

function loadIdl(idlDir: string, name: string): Idl {
  const path = resolve(idlDir, `${name}.json`);
  if (!existsSync(path)) {
    logger.error(
      { event_type: "startup.missing_idl", path },
      `IDL not found: ${path}. Run 'anchor build' or set ROUNDFI_IDL_DIR.`,
    );
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as Idl;
}

async function main(): Promise<void> {
  const rpcUrl = readRequiredEnv("SOLANA_RPC_URL");
  const corePk = new PublicKey(readRequiredEnv("ROUNDFI_CORE_PROGRAM_ID"));
  const reputationPk = new PublicKey(readRequiredEnv("ROUNDFI_REPUTATION_PROGRAM_ID"));
  const cranker = loadKeypair();
  const idlDir = process.env.ROUNDFI_IDL_DIR ?? resolve(process.cwd(), "target", "idl");

  logger.info(
    {
      event_type: "startup",
      rpc: rpcUrl,
      core: corePk.toBase58(),
      reputation: reputationPk.toBase58(),
      cranker: cranker.publicKey.toBase58(),
      idlDir,
      bootAt: crankState.snapshot.bootAt.toISOString(),
    },
    "Crank booting",
  );

  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new Wallet(cranker);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  const idls = {
    core: loadIdl(idlDir, "roundfi_core"),
    reputation: loadIdl(idlDir, "roundfi_reputation"),
    yieldAdapter: loadIdl(idlDir, "roundfi_yield_mock"),
  };

  const client = createClient({
    provider,
    idls,
    // expectedIds catches the "wrong cluster" failure mode the audit's
    // Gap 5 warned about — IDL ↔ env mismatch throws at boot.
    expectedIds: { core: corePk, reputation: reputationPk },
  });

  // Health server comes up first so Railway / UptimeRobot can see
  // `starting` immediately even if the polling loop hasn't ticked yet.
  const health = await startHealthServer();

  // Lease is opt-in via env (avoids forcing Postgres on dev / single-replica).
  const leaseEnabled = process.env.CRANK_LEASE_ENABLED === "true";
  const lease: LeaseClient = leaseEnabled ? await createPostgresLease() : noopLease;
  if (leaseEnabled) {
    logger.info({ event_type: "lease.enabled" }, "Postgres lease enabled (multi-replica)");
  }

  const loop = startPollingLoop({
    connection,
    client,
    lease,
    intervalMs: Number(process.env.POLL_INTERVAL_MS ?? 60_000),
  });

  // Graceful shutdown.
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ event_type: "shutdown.received", signal }, `Received ${signal}, draining`);
    loop.stop();
    await loop.done;
    await lease.release();
    await health.close();
    logger.info({ event_type: "shutdown.complete" }, "Crank shut down cleanly");
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error(
    {
      event_type: "startup.fatal",
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    },
    "Fatal error during startup — exiting",
  );
  process.exit(1);
});

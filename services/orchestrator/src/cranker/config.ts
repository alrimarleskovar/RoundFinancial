/**
 * Cranker config — env-driven, fail-fast.
 *
 * Required:
 *   CRANKER_KEYPAIR_PATH   path to Solana keypair JSON (caller pays + signs)
 *   CRANKER_POOLS          comma-separated Pool PDAs to monitor
 *   SOLANA_RPC_URL         devnet / mainnet RPC
 *   USDC_MINT              SPL mint for the pool's installments
 *   ROUNDFI_CORE_PROGRAM_ID
 *   ROUNDFI_REPUTATION_PROGRAM_ID
 *
 * Optional:
 *   CRANKER_POLL_INTERVAL_MS  default 60_000 (60s)
 *   CRANKER_GRACE_SECONDS     default 604_800 (7d). Devnet patches to 60s
 *                              via core/src/constants.rs — match it.
 *   CRANKER_HTTP_PORT         default 8080
 */

import { readFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";

export interface CrankerConfig {
  pools: PublicKey[];
  pollIntervalMs: number;
  graceSeconds: bigint;
  callerKeypair: Keypair;
  httpPort: number;
  rpcUrl: string;
  usdcMint: PublicKey;
  coreProgram: PublicKey;
  reputationProgram: PublicKey;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`cranker config: missing required env ${name}`);
  return v;
}

function loadKeypair(path: string): Keypair {
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

export function loadConfig(): CrankerConfig {
  return {
    pools: req("CRANKER_POOLS")
      .split(",")
      .map((s) => new PublicKey(s.trim())),
    pollIntervalMs: Number(process.env.CRANKER_POLL_INTERVAL_MS ?? "60000"),
    graceSeconds: BigInt(process.env.CRANKER_GRACE_SECONDS ?? "604800"),
    callerKeypair: loadKeypair(req("CRANKER_KEYPAIR_PATH")),
    httpPort: Number(process.env.CRANKER_HTTP_PORT ?? "8080"),
    rpcUrl: req("SOLANA_RPC_URL"),
    usdcMint: new PublicKey(req("USDC_MINT")),
    coreProgram: new PublicKey(req("ROUNDFI_CORE_PROGRAM_ID")),
    reputationProgram: new PublicKey(req("ROUNDFI_REPUTATION_PROGRAM_ID")),
  };
}

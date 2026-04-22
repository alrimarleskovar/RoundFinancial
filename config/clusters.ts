/**
 * Single source of truth for RoundFi cluster configuration.
 *
 * Every script, backend service and frontend module MUST resolve its
 * cluster context through `loadCluster()` — no hardcoded RPC URLs or
 * program IDs anywhere else in the codebase.
 */

import { clusterApiUrl, PublicKey } from "@solana/web3.js";
import { config as loadEnv } from "dotenv";

loadEnv();

export type ClusterName = "localnet" | "devnet" | "mainnet-beta";

export interface ClusterPrograms {
  core?: PublicKey;
  reputation?: PublicKey;
  yieldMock?: PublicKey;
  yieldKamino?: PublicKey;
}

export interface ClusterConfig {
  name: ClusterName;
  rpcUrl: string;
  usdcMint: PublicKey;
  metaplexCore: PublicKey;
  programs: ClusterPrograms;
  explorerBase: string;
  irysNode: string;
}

const METAPLEX_CORE_DEFAULT = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
const USDC_DEVNET_DEFAULT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const USDC_MAINNET_DEFAULT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function optionalPk(env: string | undefined): PublicKey | undefined {
  if (!env || env.trim() === "") return undefined;
  try {
    return new PublicKey(env);
  } catch (e) {
    throw new Error(`Invalid pubkey in env: "${env}"`);
  }
}

function resolveRpcUrl(name: ClusterName): string {
  if (process.env.SOLANA_RPC_URL && process.env.SOLANA_RPC_URL.trim() !== "") {
    return process.env.SOLANA_RPC_URL;
  }
  if (name === "localnet") return "http://127.0.0.1:8899";
  return clusterApiUrl(name);
}

export function loadCluster(
  name: ClusterName = (process.env.SOLANA_CLUSTER as ClusterName) ?? "devnet",
): ClusterConfig {
  const usdcMint = new PublicKey(
    name === "mainnet-beta"
      ? (process.env.USDC_MINT_MAINNET ?? USDC_MAINNET_DEFAULT)
      : (process.env.USDC_MINT_DEVNET ?? USDC_DEVNET_DEFAULT),
  );

  const metaplexCore = new PublicKey(
    process.env.METAPLEX_CORE_PROGRAM_ID ?? METAPLEX_CORE_DEFAULT,
  );

  return {
    name,
    rpcUrl: resolveRpcUrl(name),
    usdcMint,
    metaplexCore,
    programs: {
      core: optionalPk(process.env.ROUNDFI_CORE_PROGRAM_ID),
      reputation: optionalPk(process.env.ROUNDFI_REPUTATION_PROGRAM_ID),
      yieldMock: optionalPk(process.env.ROUNDFI_YIELD_MOCK_PROGRAM_ID),
      yieldKamino: optionalPk(process.env.ROUNDFI_YIELD_KAMINO_PROGRAM_ID),
    },
    explorerBase:
      name === "mainnet-beta"
        ? "https://explorer.solana.com"
        : `https://explorer.solana.com/?cluster=${name}`,
    irysNode:
      process.env.IRYS_NODE_URL ??
      (name === "mainnet-beta" ? "https://node1.irys.xyz" : "https://devnet.irys.xyz"),
  };
}

export function requireProgram(
  cfg: ClusterConfig,
  key: keyof ClusterPrograms,
): PublicKey {
  const pk = cfg.programs[key];
  if (!pk) {
    throw new Error(
      `Program "${key}" is not configured for cluster "${cfg.name}". ` +
        `Run "pnpm run devnet:deploy" and populate .env from config/program-ids.${cfg.name}.json`,
    );
  }
  return pk;
}

/** Default yield adapter for a cluster. Mainnet uses Kamino; all other clusters use the mock. */
export function defaultYieldAdapter(cfg: ClusterConfig): PublicKey {
  if (cfg.name === "mainnet-beta") return requireProgram(cfg, "yieldKamino");
  return requireProgram(cfg, "yieldMock");
}

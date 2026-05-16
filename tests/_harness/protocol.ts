/**
 * `initialize_protocol` wrapper — idempotent per env.
 *
 * `ProtocolConfig` is a singleton (seeds = [b"config"]), so specs
 * that care about a clean slate must either:
 *   (a) reuse the already-initialized config (most tests, cheap), or
 *   (b) redeploy with a different core program ID (expensive; only
 *       relevant for very specific upgrade-path tests).
 *
 * This helper takes path (a): if the config already exists, it
 * returns its handle with no write. Treasuries and fee schedule
 * come from defaults in `@roundfi/sdk/constants` unless overridden.
 */

import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

import { FEES } from "@roundfi/sdk";

import type { Env } from "./env.js";
import { configPda } from "./pda.js";
import { ensureAta } from "./mint.js";

export interface InitializeProtocolOpts {
  usdcMint: PublicKey;
  treasuryOwner?: PublicKey; // defaults to env.payer.publicKey
  feeBpsYield?: number;
  feeBpsCycleL1?: number;
  feeBpsCycleL2?: number;
  feeBpsCycleL3?: number;
  guaranteeFundBps?: number;
}

export interface ProtocolHandle {
  config: PublicKey;
  treasury: PublicKey;
  usdcMint: PublicKey;
  authority: PublicKey;
}

/** Metaplex Core program ID (same on every cluster). */
export const METAPLEX_CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

/**
 * Ensures a protocol is initialized for this env. Idempotent:
 * running it twice in the same mocha run is a no-op on the second
 * call (the PDA already exists).
 */
export async function initializeProtocol(
  env: Env,
  opts: InitializeProtocolOpts,
): Promise<ProtocolHandle> {
  const config = configPda(env);
  const treasuryOwner = opts.treasuryOwner ?? env.payer.publicKey;
  const treasury = await ensureAta(env, opts.usdcMint, treasuryOwner);

  const existing = await env.connection.getAccountInfo(config, "confirmed");
  if (existing) {
    // Validate that the on-chain `usdc_mint` matches what the spec
    // wants to use. If they diverge, every downstream ix that has
    // `has_one = usdc_mint` (create_pool, etc.) will fail with the
    // cryptic `InvalidMint` (6025). Surface that here as a clear
    // setup error instead.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chainConfig = (await (env.programs.core.account as any).protocolConfig.fetch(config)) as {
      usdcMint: PublicKey;
    };
    if (!chainConfig.usdcMint.equals(opts.usdcMint)) {
      throw new Error(
        `ProtocolConfig at ${config.toBase58()} is already initialized with USDC ` +
          `mint ${chainConfig.usdcMint.toBase58()}, but this spec is trying to use ` +
          `${opts.usdcMint.toBase58()}. Each test run creates a fresh mint via ` +
          `createUsdcMint(), so leftover state from a previous run causes this. ` +
          `Reset the validator: kill solana-test-validator, restart with --reset ` +
          `(and --clone-upgradeable-program for Metaplex Core), then redeploy.`,
      );
    }
    return {
      config,
      treasury,
      usdcMint: opts.usdcMint,
      authority: env.payer.publicKey,
    };
  }

  await (env.programs.core.methods as any)
    .initializeProtocol({
      feeBpsYield: opts.feeBpsYield ?? FEES.yieldFeeBps,
      feeBpsCycleL1: opts.feeBpsCycleL1 ?? FEES.cycleFeeL1Bps,
      feeBpsCycleL2: opts.feeBpsCycleL2 ?? FEES.cycleFeeL2Bps,
      feeBpsCycleL3: opts.feeBpsCycleL3 ?? FEES.cycleFeeL3Bps,
      guaranteeFundBps: opts.guaranteeFundBps ?? FEES.guaranteeFundBps,
    })
    .accounts({
      authority: env.payer.publicKey,
      config,
      usdcMint: opts.usdcMint,
      treasury,
      metaplexCore: METAPLEX_CORE_ID,
      defaultYieldAdapter: env.ids.yieldMock,
      reputationProgram: env.ids.reputation,
    })
    .signers([env.payer])
    .rpc();

  return {
    config,
    treasury,
    usdcMint: opts.usdcMint,
    authority: env.payer.publicKey,
  };
}

/** Loosely-typed accessor; each spec can cast to the generated type later. */
export async function fetchProtocolConfig(env: Env): Promise<Record<string, unknown>> {
  const config = configPda(env);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (env.programs.core.account as any).protocolConfig.fetch(config)) as Record<
    string,
    unknown
  >;
}

// Silence unused-import warnings on BN until specs start passing big numbers.
void BN;

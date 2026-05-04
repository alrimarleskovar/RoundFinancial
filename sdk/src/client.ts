/**
 * RoundFiClient — thin, stateless SDK entrypoint shared by the
 * orchestrator, demo scripts, and the Next.js app.
 *
 * Responsibilities:
 *   - wrap an Anchor `Provider` (AnchorProvider on RPC, BankrunProvider
 *     in tests, a wallet-adapter provider in the UI — anything that
 *     implements `@coral-xyz/anchor`'s `Provider`),
 *   - build typed `Program<Idl>` handles for every on-chain program
 *     we talk to (core, reputation, yield adapter),
 *   - FAIL FAST if the loaded IDL's declared program ID disagrees
 *     with an `expectedIds` entry — never silently point at the wrong
 *     cluster,
 *   - expose a single `debug` callback so callers can pipe events to
 *     their own logger without the SDK caring about `console`.
 *
 * Non-goals:
 *   - no retries, no caching, no websocket subscriptions,
 *   - no hidden side effects — construction never writes to chain.
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { Provider } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

// ─── Types ────────────────────────────────────────────────────────────

export type AnyIdl = anchor.Idl;

/** Program IDs for every on-chain program the SDK interacts with. */
export interface RoundFiProgramIds {
  core: PublicKey;
  reputation: PublicKey;
  /** Mock on devnet, kamino on mainnet — config-driven. */
  yieldAdapter: PublicKey;
}

/** Pre-parsed IDLs supplied to the client. The SDK never touches disk. */
export interface RoundFiIdls {
  core: AnyIdl;
  reputation: AnyIdl;
  yieldAdapter: AnyIdl;
}

/**
 * Minimal logging surface. Callers pass anything that matches this
 * shape — `console.debug.bind(console)`, a pino logger wrapper, or
 * a no-op for production UI. Absence ⇒ silent.
 */
export type DebugHook = (tag: string, data?: Record<string, unknown>) => void;

export interface RoundFiClientConfig {
  provider: Provider;
  idls: RoundFiIdls;
  /**
   * Program IDs the caller *expects* based on their local config
   * (devnet.json, env var, whatever). The client validates every
   * loaded IDL's address against the matching entry; mismatch throws.
   * Omit to skip validation (useful in ephemeral tests).
   */
  expectedIds?: Partial<RoundFiProgramIds>;
  debug?: DebugHook;
}

export interface RoundFiClient {
  readonly provider: Provider;
  readonly connection: Connection;
  readonly programs: {
    core: Program<AnyIdl>;
    reputation: Program<AnyIdl>;
    yieldAdapter: Program<AnyIdl>;
  };
  readonly ids: RoundFiProgramIds;
  readonly debug: DebugHook;
}

// ─── Implementation ──────────────────────────────────────────────────

function assertMatchingId(label: string, loaded: PublicKey, expected: PublicKey | undefined): void {
  if (expected && !expected.equals(loaded)) {
    throw new Error(
      `RoundFiClient: ${label} program ID mismatch. ` +
        `IDL declares ${loaded.toBase58()} but config expects ` +
        `${expected.toBase58()}. Rebuild IDLs or update the config.`,
    );
  }
}

/**
 * Build a client. Throws on IDL/config mismatch so callers can surface
 * misconfig immediately instead of hitting cryptic CPI errors later.
 */
export function createClient(cfg: RoundFiClientConfig): RoundFiClient {
  const debug: DebugHook = cfg.debug ?? (() => {});

  const core = new Program(cfg.idls.core, cfg.provider);
  const reputation = new Program(cfg.idls.reputation, cfg.provider);
  const yieldAdapter = new Program(cfg.idls.yieldAdapter, cfg.provider);

  const ids: RoundFiProgramIds = {
    core: core.programId,
    reputation: reputation.programId,
    yieldAdapter: yieldAdapter.programId,
  };

  assertMatchingId("core", ids.core, cfg.expectedIds?.core);
  assertMatchingId("reputation", ids.reputation, cfg.expectedIds?.reputation);
  assertMatchingId("yieldAdapter", ids.yieldAdapter, cfg.expectedIds?.yieldAdapter);

  // AnchorProvider exposes `connection`; other Provider implementations
  // (BankrunProvider, wallet-adapter providers) do too, but the
  // interface doesn't guarantee it — fall back to whatever the
  // provider carries, or surface a clear error if absent.
  const connection =
    (cfg.provider as AnchorProvider).connection ??
    (cfg.provider as { connection?: Connection }).connection;
  if (!connection) {
    throw new Error(
      "RoundFiClient: provider does not expose a Connection. " +
        "Pass an AnchorProvider or BankrunProvider.",
    );
  }

  debug("client.created", {
    core: ids.core.toBase58(),
    reputation: ids.reputation.toBase58(),
    yieldAdapter: ids.yieldAdapter.toBase58(),
    endpoint: connection.rpcEndpoint,
  });

  return {
    provider: cfg.provider,
    connection,
    programs: { core, reputation, yieldAdapter },
    ids,
    debug,
  };
}

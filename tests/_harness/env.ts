/**
 * Test environment bootstrap.
 *
 * One import-point for spec files to get a working provider + typed
 * `Program<T>` handles for every on-chain program in the workspace.
 *
 * Idempotent: `setupEnv()` returns the same singleton within a mocha
 * run, so individual specs don't pay the handshake cost twice.
 *
 * The IDLs are loaded from `target/idl/` after `anchor build`. On
 * fresh checkouts (or on the Windows author box where `anchor build`
 * can't run) the IDL files won't exist and `setupEnv()` will throw a
 * clear error instead of a cryptic Anchor stack.
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

// ─── IDL wire types ───────────────────────────────────────────────────
// We type IDLs as `anchor.Idl` — the generated TypeScript types under
// `sdk/src/generated/` give per-program type safety once `anchor build`
// has run. In 5a we intentionally keep the harness IDL-agnostic so it
// compiles on the author's Windows box.

type AnyIdl = anchor.Idl;

export interface Env {
  /** JSON-RPC connection pinned to the cluster from Anchor.toml [provider]. */
  readonly connection: Connection;
  /** The provider wallet (from ANCHOR_WALLET env / `solana config`). */
  readonly provider: AnchorProvider;
  /** Pays for every init in the harness unless a spec overrides. */
  readonly payer: Keypair;
  /** Typed program handles — safe for `.methods.<ix>(...)` calls. */
  readonly programs: {
    core: Program<AnyIdl>;
    reputation: Program<AnyIdl>;
    yieldMock: Program<AnyIdl>;
  };
  /** Program IDs — fast path without going through `programs.*.programId`. */
  readonly ids: {
    core: PublicKey;
    reputation: PublicKey;
    yieldMock: PublicKey;
  };
}

let cached: Env | null = null;

function loadWallet(): Keypair {
  const path = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  if (!existsSync(path)) {
    throw new Error(
      `ANCHOR_WALLET not found at ${path}. Set ANCHOR_WALLET env or run ` +
        `solana-keygen new -o ~/.config/solana/id.json`,
    );
  }
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

function loadIdl(name: string): AnyIdl {
  // anchor build → target/idl/<snake_case_name>.json
  const idlPath = resolve(process.cwd(), "target", "idl", `${name}.json`);
  if (!existsSync(idlPath)) {
    throw new Error(
      `IDL not found: ${idlPath}. Run 'anchor build' before 'anchor test'. ` +
        `(If you're running tests without 'anchor build', this will always fail.)`,
    );
  }
  return JSON.parse(readFileSync(idlPath, "utf-8")) as AnyIdl;
}

/**
 * Bootstrap (or return cached) test env.
 * Spec files should call this once in `before()`.
 */
export async function setupEnv(): Promise<Env> {
  if (cached) return cached;

  const payer = loadWallet();
  const wallet = new Wallet(payer);
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  const coreIdl = loadIdl("roundfi_core");
  const reputationIdl = loadIdl("roundfi_reputation");
  const yieldMockIdl = loadIdl("roundfi_yield_mock");

  const core = new Program(coreIdl, provider);
  const reputation = new Program(reputationIdl, provider);
  const yieldMock = new Program(yieldMockIdl, provider);

  cached = {
    connection,
    provider,
    payer,
    programs: { core, reputation, yieldMock },
    ids: {
      core: core.programId,
      reputation: reputation.programId,
      yieldMock: yieldMock.programId,
    },
  };
  return cached;
}

/**
 * Force-reset the env cache. Only useful if a test intentionally
 * wants a fresh wallet or RPC (rarely needed — most specs should
 * scope per-test state to their own keypairs).
 */
export function resetEnv(): void {
  cached = null;
}

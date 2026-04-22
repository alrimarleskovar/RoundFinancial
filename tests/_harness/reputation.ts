/**
 * Reputation program wrappers.
 *
 * The reputation program is a singleton (`ReputationConfig` seeds =
 * [b"rep-config"]) plus one `ReputationProfile` per wallet and many
 * `Attestation` records. Tests typically need to:
 *
 *   1. `initializeReputation(env, …)` once per run.
 *   2. `initProfile(env, wallet)` lazily before a member joins a pool.
 *   3. Assert attestation events emitted by core→reputation CPIs —
 *      see events.ts for log parsing.
 *
 * For specs that only care about the happy-path reputation flow
 * (Payment/Late/Default/CycleComplete events), `seedReputation(env)`
 * bundles (1)+(2) for a set of wallets into a single helper call.
 */

import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";

import type { Env } from "./env.js";
import { reputationConfigFor, reputationProfileFor } from "./pda.js";

/** Matches `roundfi_reputation::constants::SCHEMA_*`. */
export const SCHEMA = {
  Payment: 1,
  Late: 2,
  Default: 3,
  CycleComplete: 4,
  LevelUp: 5,
} as const;

export interface ReputationInitOpts {
  /** Core program ID that will be allowed to issue attestations. */
  coreProgram: PublicKey;
  /** Civic gateway program ID. On localnet this can be any pubkey —
   *  identity link/refresh tests will be skipped unless a real gateway
   *  account is supplied via the linker fixture. */
  civicGatewayProgram?: PublicKey;
  /** Civic network (gatekeeper) pubkey. */
  civicNetwork?: PublicKey;
}

export interface ReputationHandle {
  config: PublicKey;
  authority: PublicKey;
}

// Arbitrary non-zero localnet placeholder for the Civic gateway.
// Attestation tests never CPI into this; identity tests that DO need
// a real gateway must pass their own override.
const LOCALNET_CIVIC_GATEWAY = new PublicKey(
  "gatem74V238djXdzWnJf94Wo1DcnuGkfijbf3AuBhfs",
);
const LOCALNET_CIVIC_NETWORK = new PublicKey(
  "ignREusXmGrscGNUesoU9mxfds9AiYTezUKex2PsZV6",
);

export async function initializeReputation(
  env: Env,
  opts: ReputationInitOpts,
): Promise<ReputationHandle> {
  const config = reputationConfigFor(env);

  const existing = await env.connection.getAccountInfo(config, "confirmed");
  if (existing) {
    return { config, authority: env.payer.publicKey };
  }

  await env.programs.reputation.methods
    .initializeReputation({
      roundfiCoreProgram:  opts.coreProgram,
      civicGatewayProgram: opts.civicGatewayProgram ?? LOCALNET_CIVIC_GATEWAY,
      civicNetwork:        opts.civicNetwork ?? LOCALNET_CIVIC_NETWORK,
    })
    .accounts({
      authority: env.payer.publicKey,
      config,
      systemProgram: SystemProgram.programId,
    })
    .signers([env.payer])
    .rpc();

  return { config, authority: env.payer.publicKey };
}

/**
 * Ensure a `ReputationProfile` exists for `wallet`. Idempotent.
 * Returns the profile PDA.
 */
export async function initProfile(
  env: Env,
  wallet: PublicKey,
): Promise<PublicKey> {
  const profile = reputationProfileFor(env, wallet);

  const existing = await env.connection.getAccountInfo(profile, "confirmed");
  if (existing) return profile;

  await env.programs.reputation.methods
    .initProfile(wallet)
    .accounts({
      payer: env.payer.publicKey,
      profile,
      systemProgram: SystemProgram.programId,
    })
    .signers([env.payer])
    .rpc();

  return profile;
}

/**
 * Bootstrap: initialize reputation + init profiles for a slate of
 * member wallets in one call. Returns the profile PDAs in the same
 * order as the input wallets.
 */
export async function seedReputation(
  env: Env,
  members: (PublicKey | Keypair)[],
): Promise<{ handle: ReputationHandle; profiles: PublicKey[] }> {
  const handle = await initializeReputation(env, { coreProgram: env.ids.core });
  const profiles: PublicKey[] = [];
  for (const m of members) {
    const pk = m instanceof Keypair ? m.publicKey : m;
    profiles.push(await initProfile(env, pk));
  }
  return { handle, profiles };
}

/** Loosely-typed profile fetcher. */
export async function fetchProfile(
  env: Env,
  wallet: PublicKey,
): Promise<Record<string, unknown>> {
  const pda = reputationProfileFor(env, wallet);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (env.programs.reputation.account as any).reputationProfile.fetch(
    pda,
  )) as Record<string, unknown>;
}

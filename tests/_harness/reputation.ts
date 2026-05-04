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
import { BN } from "@coral-xyz/anchor";

import type { Env } from "./env.js";
import {
  attestationFor,
  reputationConfigFor,
  reputationProfileFor,
} from "./pda.js";

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

  await (env.programs.reputation.methods as any)
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

  await (env.programs.reputation.methods as any)
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

// ─── Admin-path attest ───────────────────────────────────────────────

export interface AdminAttestOpts {
  /** Wallet whose profile is being scored. Must already have a profile
   *  (init_if_needed will create it, but most callers pre-init). */
  subject: PublicKey;
  /** One of the SCHEMA values. */
  schemaId: number;
  /** 64-bit PDA nonce. Combined with (issuer, subject, schema) to seed
   *  the attestation PDA — so reusing the same nonce against the same
   *  tuple will fail (duplicate init). */
  nonce: bigint;
  /** Optional 96-byte payload (truncated / zero-padded). */
  payload?: Uint8Array;
  /** Issuer override. Defaults to env.payer (the config authority,
   *  i.e. the admin path). Pass a non-authority Keypair to exercise
   *  the InvalidIssuer guard. */
  issuer?: Keypair;
  /** Admin path leaves pool/poolAuthority = default; override only for
   *  pool-PDA issuance paths that the specs drive manually. */
  poolKey?: PublicKey;
  poolAuthority?: PublicKey;
  poolSeedId?: bigint;
  /** Identity sentinel. Defaults to env.ids.reputation — Anchor resolves
   *  the Option<Account<IdentityRecord>> to None because the owner check
   *  fails on the program account, so the handler treats the subject
   *  as Unverified (positive deltas halved). Pass a real identity PDA
   *  to exercise the Verified path. */
  identity?: PublicKey;
}

/**
 * Direct-issue an attestation against the admin authorization path,
 * bypassing the core→reputation CPI. Useful for:
 *   • Seeding score deltas without burning pool cycles.
 *   • Exercising the InvalidIssuer / InvalidSchema guards.
 *   • Driving promote_level boundaries deterministically.
 *
 * Returns the transaction signature. Throws (with Anchor's error) on
 * any program-side failure — callers in negative-path tests should
 * wrap this in their own try/catch.
 */
export async function adminAttest(
  env: Env,
  opts: AdminAttestOpts,
): Promise<string> {
  const issuer = opts.issuer ?? env.payer;

  // Fixed 96-byte payload; Anchor expects number[].
  const payload: number[] = new Array(96).fill(0);
  if (opts.payload) {
    const n = Math.min(opts.payload.length, 96);
    for (let i = 0; i < n; i++) payload[i] = opts.payload[i]!;
  }

  const profile = reputationProfileFor(env, opts.subject);
  const attestation = attestationFor(
    env,
    issuer.publicKey,
    opts.subject,
    opts.schemaId,
    opts.nonce,
  );

  return (env.programs.reputation.methods as any)
    .attest({
      schemaId:      opts.schemaId,
      nonce:         new BN(opts.nonce.toString()),
      payload,
      pool:          opts.poolKey ?? PublicKey.default,
      poolAuthority: opts.poolAuthority ?? PublicKey.default,
      poolSeedId:    new BN((opts.poolSeedId ?? 0n).toString()),
    })
    .accounts({
      issuer:        issuer.publicKey,
      subject:       opts.subject,
      config:        reputationConfigFor(env),
      profile,
      identity:      opts.identity ?? env.ids.reputation,
      attestation,
      payer:         env.payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers(
      // env.payer is always a signer (fee payer). If issuer is a different
      // keypair, it also needs to sign.
      issuer.publicKey.equals(env.payer.publicKey)
        ? [env.payer]
        : [env.payer, issuer],
    )
    .rpc();
}

// ─── Revoke attestation ──────────────────────────────────────────────

export interface RevokeAttestationOpts {
  /** Signer that created the attestation originally. Only the exact
   *  issuer stored on the attestation may revoke (checked by the
   *  handler). Pass a different Keypair to exercise the guard. */
  issuer: Keypair;
  /** Subject wallet whose profile gets reverted. */
  subject: PublicKey;
  /** Pre-computed attestation PDA (from `attestationFor`). */
  attestation: PublicKey;
  /** Identity sentinel; see AdminAttestOpts.identity. */
  identity?: PublicKey;
}

export async function revokeAttestation(
  env: Env,
  opts: RevokeAttestationOpts,
): Promise<string> {
  const profile = reputationProfileFor(env, opts.subject);
  return (env.programs.reputation.methods as any)
    .revoke()
    .accounts({
      issuer:      opts.issuer.publicKey,
      subject:     opts.subject,
      profile,
      identity:    opts.identity ?? env.ids.reputation,
      attestation: opts.attestation,
    })
    .signers(
      opts.issuer.publicKey.equals(env.payer.publicKey)
        ? [env.payer]
        : [env.payer, opts.issuer],
    )
    .rpc();
}

// ─── promote_level ───────────────────────────────────────────────────

export interface PromoteLevelOpts {
  /** Wallet whose profile to re-evaluate. */
  subject: PublicKey;
  /** Anyone can crank. Defaults to env.payer. */
  caller?: Keypair;
}

export async function promoteLevel(
  env: Env,
  opts: PromoteLevelOpts,
): Promise<string> {
  const caller = opts.caller ?? env.payer;
  const profile = reputationProfileFor(env, opts.subject);
  return (env.programs.reputation.methods as any)
    .promoteLevel()
    .accounts({
      subject: opts.subject,
      profile,
      caller:  caller.publicKey,
    })
    .signers(
      caller.publicKey.equals(env.payer.publicKey)
        ? [env.payer]
        : [env.payer, caller],
    )
    .rpc();
}

/** Loosely-typed fetcher for an Attestation account. */
export async function fetchAttestation(
  env: Env,
  attestation: PublicKey,
): Promise<Record<string, unknown>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (env.programs.reputation.account as any).attestation.fetch(
    attestation,
  )) as Record<string, unknown>;
}

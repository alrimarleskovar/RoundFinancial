/**
 * PDA helpers for tests.
 *
 * The canonical PDA derivations live in `@roundfi/sdk/pda` — this
 * module simply re-exports them so spec files import everything
 * PDA-shaped from one place. Add anchor-specific conveniences here
 * (arrays, bump extraction, per-env variants) — never add new seeds.
 *
 * If you find yourself about to paste seed bytes in this file, STOP:
 * add the helper to `sdk/src/pda.ts` first (so scripts + backend +
 * app + tests share one source of truth), then re-export here.
 */

import { PublicKey } from "@solana/web3.js";

import {
  SEED,
  attestationPda,
  escrowVaultAuthorityPda,
  memberPda,
  poolPda,
  positionAuthorityPda,
  protocolConfigPda,
  reputationConfigPda,
  reputationProfilePda,
  solidarityVaultAuthorityPda,
  yieldVaultAuthorityPda,
  yieldVaultStatePda,
} from "@roundfi/sdk";

import type { Env } from "./env.js";

export {
  SEED,
  attestationPda,
  escrowVaultAuthorityPda,
  memberPda,
  poolPda,
  positionAuthorityPda,
  protocolConfigPda,
  reputationConfigPda,
  reputationProfilePda,
  solidarityVaultAuthorityPda,
  yieldVaultAuthorityPda,
  yieldVaultStatePda,
};

// ─── Env-bound convenience wrappers ──────────────────────────────────
// These drop the `coreProgram` / `reputationProgram` argument so spec
// files can write `configPda(env)` instead of `protocolConfigPda(env.ids.core)`.

export function configPda(env: Env): PublicKey {
  return protocolConfigPda(env.ids.core)[0];
}

export function reputationConfigFor(env: Env): PublicKey {
  return reputationConfigPda(env.ids.reputation)[0];
}

export function reputationProfileFor(env: Env, wallet: PublicKey): PublicKey {
  return reputationProfilePda(env.ids.reputation, wallet)[0];
}

export function poolFor(env: Env, authority: PublicKey, seedId: bigint | number): PublicKey {
  return poolPda(env.ids.core, authority, seedId)[0];
}

export function memberFor(env: Env, pool: PublicKey, wallet: PublicKey): PublicKey {
  return memberPda(env.ids.core, pool, wallet)[0];
}

export function positionAuthorityFor(env: Env, pool: PublicKey, slotIndex: number): PublicKey {
  return positionAuthorityPda(env.ids.core, pool, slotIndex)[0];
}

export function attestationFor(
  env: Env,
  issuer: PublicKey,
  subject: PublicKey,
  schemaId: number,
  nonce: bigint | number,
): PublicKey {
  return attestationPda(env.ids.reputation, issuer, subject, schemaId, nonce)[0];
}

/** All position PDAs for a pool with `n` members. Handy for assertions. */
export function positionsForPool(env: Env, pool: PublicKey, membersTarget: number): PublicKey[] {
  return Array.from({ length: membersTarget }, (_, i) => positionAuthorityFor(env, pool, i));
}

/** Cross-program attestation nonce per reputation::cpi convention: (cycle << 32) | slot. */
export function attestationNonce(cycle: number, slot: number): bigint {
  return (BigInt(cycle) << 32n) | BigInt(slot);
}

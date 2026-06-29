/**
 * PDA derivation helpers — mirrors docs/architecture.md §7.
 *
 * Every PDA in the RoundFi protocol is computed here and nowhere else.
 * Drift between on-chain seeds and these helpers is an automatic bug, so
 * Step 5 will add a Rust↔TS parity test for every seed defined below.
 */

import { PublicKey } from "@solana/web3.js";

export const SEED = {
  config: Buffer.from("config"),
  pool: Buffer.from("pool"),
  member: Buffer.from("member"),
  escrow: Buffer.from("escrow"),
  solidarity: Buffer.from("solidarity"),
  yield: Buffer.from("yield"),
  position: Buffer.from("position"),
  listing: Buffer.from("listing"),
  reputation: Buffer.from("reputation"),
  reputationConfig: Buffer.from("rep-config"),
  attestation: Buffer.from("attestation"),
  identity: Buffer.from("identity"),
  identityGate: Buffer.from("identity-gate"),
  yieldState: Buffer.from("yield-state"),
  // DEVNET-ONLY Human Passport shim attestation (devnet-identity-shim feature).
  devnetPassport: Buffer.from("devnet-passport"),
} as const;

function u64le(n: bigint | number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(typeof n === "bigint" ? n : BigInt(n));
  return buf;
}

function u16le(n: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n);
  return buf;
}

function u8le(n: number): Buffer {
  return Buffer.from([n & 0xff]);
}

export function protocolConfigPda(coreProgram: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEED.config], coreProgram);
}

export function poolPda(
  coreProgram: PublicKey,
  authority: PublicKey,
  seedId: bigint | number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED.pool, authority.toBuffer(), u64le(seedId)],
    coreProgram,
  );
}

export function memberPda(
  coreProgram: PublicKey,
  pool: PublicKey,
  wallet: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED.member, pool.toBuffer(), wallet.toBuffer()],
    coreProgram,
  );
}

export function escrowVaultAuthorityPda(
  coreProgram: PublicKey,
  pool: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEED.escrow, pool.toBuffer()], coreProgram);
}

export function solidarityVaultAuthorityPda(
  coreProgram: PublicKey,
  pool: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEED.solidarity, pool.toBuffer()], coreProgram);
}

export function yieldVaultAuthorityPda(
  coreProgram: PublicKey,
  pool: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEED.yield, pool.toBuffer()], coreProgram);
}

export function positionAuthorityPda(
  coreProgram: PublicKey,
  pool: PublicKey,
  slotIndex: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED.position, pool.toBuffer(), u8le(slotIndex)],
    coreProgram,
  );
}

export function listingPda(
  coreProgram: PublicKey,
  pool: PublicKey,
  slotIndex: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED.listing, pool.toBuffer(), u8le(slotIndex)],
    coreProgram,
  );
}

export function reputationProfilePda(
  reputationProgram: PublicKey,
  wallet: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEED.reputation, wallet.toBuffer()], reputationProgram);
}

export function reputationConfigPda(reputationProgram: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEED.reputationConfig], reputationProgram);
}

/** `IdentityRecord` PDA — `[b"identity", wallet]`. */
export function identityPda(reputationProgram: PublicKey, wallet: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEED.identity, wallet.toBuffer()], reputationProgram);
}

/** SEV-047 `IdentityGateConfig` singleton PDA — `[b"identity-gate"]`. */
export function identityGatePda(reputationProgram: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEED.identityGate], reputationProgram);
}

/**
 * DEVNET-ONLY Human Passport shim attestation PDA — `[b"devnet-passport", subject]`.
 * Written by the `devnet_issue_attestation` instruction (gated behind the
 * `devnet-identity-shim` program feature) and consumed as the `gateway_token`
 * by the real `link_passport_identity`. Does not exist on mainnet.
 */
export function devnetPassportPda(
  reputationProgram: PublicKey,
  subject: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED.devnetPassport, subject.toBuffer()],
    reputationProgram,
  );
}

export function attestationPda(
  reputationProgram: PublicKey,
  issuer: PublicKey,
  subject: PublicKey,
  schemaId: number,
  nonce: bigint | number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED.attestation, issuer.toBuffer(), subject.toBuffer(), u16le(schemaId), u64le(nonce)],
    reputationProgram,
  );
}

/** Cross-program attestation nonce: (cycle << 32) | slot. Mirrors reputation::cpi. */
export function attestationNonce(cycle: number, slot: number): bigint {
  return (BigInt(cycle) << 32n) | BigInt(slot);
}

export function yieldVaultStatePda(yieldProgram: PublicKey, owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEED.yieldState, owner.toBuffer()], yieldProgram);
}

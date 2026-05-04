/**
 * Deterministic keypair generation for reproducible tests.
 *
 * Test failures are much easier to debug when wallet addresses are
 * stable across runs. `keypairFromSeed("alice")` returns the same
 * keypair every time — no surprises.
 *
 * Implementation: SHA-256 of a namespaced seed string, used as the
 * 32-byte ed25519 secret. Namespacing (`roundfi-test:<seed>`) keeps
 * test keypairs disjoint from any real wallets.
 */

import { Keypair } from "@solana/web3.js";
import { createHash } from "node:crypto";

const NAMESPACE = "roundfi-test:";

export function keypairFromSeed(seed: string): Keypair {
  const bytes = createHash("sha256")
    .update(NAMESPACE + seed)
    .digest();
  // ed25519 secret keys are 32 bytes; Keypair.fromSeed derives a 64-byte
  // secret (seed || pubkey) under the hood.
  return Keypair.fromSeed(bytes);
}

/**
 * Convenience: N deterministic member wallets named
 * `member-0`, `member-1`, ..., for multi-member pool fixtures.
 */
export function memberKeypairs(count: number, prefix = "member"): Keypair[] {
  return Array.from({ length: count }, (_, i) => keypairFromSeed(`${prefix}-${i}`));
}

/** Well-known named wallets used by multiple specs. */
export const NAMED = {
  alice: () => keypairFromSeed("alice"),
  bob: () => keypairFromSeed("bob"),
  carol: () => keypairFromSeed("carol"),
  crank: () => keypairFromSeed("crank"),
  treasury: () => keypairFromSeed("treasury"),
} as const;

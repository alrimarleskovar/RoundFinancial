/**
 * Sealed free bid — commit-hash construction (ADR 0012 Fase 3).
 *
 * The one place the pre-image layout is written down on the client side.
 * It MUST stay byte-identical to `place_bid_reveal.rs`:
 *
 *     sha256( amount:u64 LE (8) ‖ salt:u64 LE (8) ‖ bidder:Pubkey (32) )
 *
 * Drift here is not a cosmetic bug: the reveal would fail with
 * `BidCommitMismatch` and the bidder's sealed envelope becomes
 * unopenable — they lose the auction with no recourse. Pinned by
 * `tests/lance_livre_hash.spec.ts` against the Rust construction.
 *
 * Why the bidder is inside the pre-image (the #232 listing commit hashes
 * only `price ‖ salt`): a free-bid envelope lives at a PDA keyed by the
 * bidder, so binding the hash to the same wallet means a hash copied
 * from someone else's envelope can never be revealed from another
 * wallet, even if their salt leaks.
 *
 * **Browser-safe by construction.** This module is reachable from the
 * SDK barrel, which the Next.js app imports — so it must never touch
 * `node:crypto`. It uses `@noble/hashes` (pure JS, browser + node), the
 * same family `@solana/web3.js` already relies on. An earlier revision
 * imported `node:crypto` and broke the app's webpack build with
 * `UnhandledSchemeError: Reading from "node:crypto" is not handled`.
 */

import { sha256 } from "@noble/hashes/sha256";
import { randomBytes } from "@noble/hashes/utils";
import { PublicKey } from "@solana/web3.js";

/**
 * Salt entropy is the CLIENT's responsibility (Adevar Labs SEV-013).
 * A free bid's amount lives in a tiny space — a handful of installment
 * multiples — so a predictable salt lets anyone brute-force the
 * envelope by enumerating candidates. The program rejects `salt = 0`
 * as the minimal trivially-broken guard; everything above that is on us.
 *
 * `randomBytes` is noble's CSPRNG wrapper over Web Crypto
 * (`crypto.getRandomValues`) — real entropy in both the browser and Node.
 */
export function randomBidSalt(): bigint {
  // Rejecting 0 costs one retry with probability 2^-64 and keeps the
  // on-chain guard unreachable in practice.
  for (;;) {
    const salt = Buffer.from(randomBytes(8)).readBigUInt64LE(0);
    if (salt !== 0n) return salt;
  }
}

/** `sha256(amount_le ‖ salt_le ‖ bidder)` — 32 bytes. */
export function freeBidCommitHash(amount: bigint, salt: bigint, bidder: PublicKey): Buffer {
  const preimage = Buffer.alloc(48);
  preimage.writeBigUInt64LE(amount, 0);
  preimage.writeBigUInt64LE(salt, 8);
  bidder.toBuffer().copy(preimage, 16);
  return Buffer.from(sha256(preimage));
}

/**
 * The USDC a bid of `parcels` whole installments costs. The program
 * requires an EXACT multiple (`BidAmountNotMultiple`) — that exactness is
 * what keeps the free bid free of dust, refunds and a settlement step.
 */
export function freeBidAmount(parcels: number, installmentAmount: bigint): bigint {
  if (!Number.isInteger(parcels) || parcels < 1) {
    throw new Error(`freeBidAmount: parcels must be a positive integer, got ${parcels}`);
  }
  return BigInt(parcels) * installmentAmount;
}

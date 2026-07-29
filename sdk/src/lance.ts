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

// ─── Recoverable envelopes ─────────────────────────────────────────────
//
// The commit-reveal flow has a failure mode no on-chain code can fix: the
// bidder seals `(amount, salt)` in one session and must reproduce BOTH,
// exactly, in another — possibly days later. Keep the pair only in
// localStorage and a cleared cache, a new browser or a second device turns
// the envelope into an unopenable one. The bidder loses the auction and
// there is no recourse.
//
// The fix is to stop storing the secret at all and DERIVE it:
//
//   salt   = sha256(wallet signature over a canonical per-(pool, cycle)
//            message) — ed25519 signing is deterministic (RFC 8032: the
//            nonce comes from the key and the message, not from an RNG),
//            so the same wallet re-signing the same message always yields
//            the same bytes, on any device.
//   amount = recovered by SCANNING the (tiny) space of whole-installment
//            bids against the on-chain `commit_hash`.
//
// The amount space being small is exactly what makes a weak salt
// dangerous — and exactly what makes recovery cheap. Both facts come from
// the same property, pointing in opposite directions.
//
// This does NOT weaken the seal: an outsider still cannot derive the salt
// without the bidder's private key, and the scan needs the salt.

/** Domain tag — changing it invalidates every outstanding envelope. */
export const BID_ENVELOPE_DOMAIN = "RoundFi lance livre v1";

/**
 * The exact message the wallet signs to derive an envelope's salt. It is
 * bound to (pool, cycle) so one signature cannot be replayed to recover a
 * different auction's secret, and it says plainly that signing costs
 * nothing — a signature request with no explanation reads like a scam.
 */
export function bidEnvelopeMessage(pool: PublicKey, cycle: number): string {
  return [
    BID_ENVELOPE_DOMAIN,
    `pool: ${pool.toBase58()}`,
    `cycle: ${cycle}`,
    "",
    "Assine para gerar o segredo do seu lance selado.",
    "Esta assinatura NAO e uma transacao: nao move fundos e nao paga taxa.",
    "Assinar a mesma mensagem de novo recupera o mesmo segredo em qualquer",
    "dispositivo — e a sua unica forma de reabrir o envelope.",
  ].join("\n");
}

/**
 * Derive the envelope salt from a wallet signature. Never returns 0 (the
 * program rejects it): on the ~2^-64 chance the leading bytes are all
 * zero, fall through to the next 8 — still deterministic.
 */
export function saltFromSignature(signature: Uint8Array): bigint {
  const digest = Buffer.from(sha256(signature));
  const first = digest.readBigUInt64LE(0);
  if (first !== 0n) return first;
  const second = digest.readBigUInt64LE(8);
  return second !== 0n ? second : 1n;
}

/**
 * Recover how many installments a sealed envelope bid, by re-deriving the
 * hash for each candidate and comparing against the on-chain
 * `commit_hash`. Returns null when nothing matches — which means the salt
 * is wrong (a different wallet, or a wallet whose signatures are not
 * deterministic), not that the bid was invalid.
 *
 * `maxParcels` bounds the scan; callers pass the pool's remaining
 * installments, so this is a handful of hashes, not a search.
 */
export function recoverBidParcels(
  commitHash: Uint8Array,
  salt: bigint,
  bidder: PublicKey,
  installmentAmount: bigint,
  maxParcels: number,
): number | null {
  const target = Buffer.from(commitHash).toString("hex");
  for (let k = 1; k <= maxParcels; k++) {
    const candidate = freeBidCommitHash(BigInt(k) * installmentAmount, salt, bidder);
    if (candidate.toString("hex") === target) return k;
  }
  return null;
}

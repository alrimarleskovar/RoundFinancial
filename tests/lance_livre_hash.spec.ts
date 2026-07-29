/**
 * Sealed free bid — commit-hash parity (ADR 0012 Fase 3).
 *
 * `sdk/src/lance.ts` builds the pre-image the client hashes; the reveal in
 * `programs/roundfi-core/src/instructions/place_bid_reveal.rs` rebuilds it
 * byte-for-byte on chain:
 *
 *     sha256( amount:u64 LE (8) ‖ salt:u64 LE (8) ‖ bidder:Pubkey (32) )
 *
 * Drift here is not cosmetic. The bidder's envelope is sealed at commit
 * time and can only be opened by reproducing that exact hash — so a
 * layout mismatch makes the envelope PERMANENTLY unopenable
 * (`BidCommitMismatch`) and the bidder loses the auction with no recourse
 * and no way to detect the problem before the reveal window.
 *
 * These are pure hash/encoding assertions — no chain, no validator. The
 * on-chain half of the contract is exercised end-to-end by
 * `tests/litesvm_lance_livre.spec.ts`.
 */

import { expect } from "chai";
import { createHash } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";

import { freeBidAmount, freeBidCommitHash, randomBidSalt } from "@roundfi/sdk";

const BIDDER = new PublicKey("8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw");

/** The pre-image exactly as `place_bid_reveal.rs` assembles it. */
function rustPreimage(amount: bigint, salt: bigint, bidder: PublicKey): Buffer {
  const buf = Buffer.alloc(48);
  buf.writeBigUInt64LE(amount, 0);
  buf.writeBigUInt64LE(salt, 8);
  bidder.toBuffer().copy(buf, 16);
  return buf;
}

describe("freeBidCommitHash — TS ↔ Rust pre-image parity", () => {
  it("matches the 48-byte layout the reveal handler rebuilds", () => {
    const amount = 6_000_000n;
    const salt = 0xfeed_beef_1234_5678n;
    const expected = createHash("sha256")
      .update(rustPreimage(amount, salt, BIDDER))
      .digest();
    expect(freeBidCommitHash(amount, salt, BIDDER).toString("hex")).to.equal(
      expected.toString("hex"),
    );
  });

  it("produces 32 bytes", () => {
    expect(freeBidCommitHash(1n, 2n, BIDDER)).to.have.lengthOf(32);
  });

  it("binds the hash to the BIDDER — the same (amount, salt) hashes differently per wallet", () => {
    // Why the bidder is in the pre-image at all (the #232 listing commit
    // hashes only price‖salt): a leaked salt must not let another wallet
    // open an envelope, and each Bid PDA is keyed by its bidder anyway.
    const other = Keypair.generate().publicKey;
    expect(freeBidCommitHash(4n, 9n, BIDDER).toString("hex")).to.not.equal(
      freeBidCommitHash(4n, 9n, other).toString("hex"),
    );
  });

  it("separates amount from salt (no field-collision aliasing)", () => {
    // A layout that concatenated without fixed widths could make
    // (amount=1, salt=2) collide with (amount=2, salt=1).
    expect(freeBidCommitHash(1n, 2n, BIDDER).toString("hex")).to.not.equal(
      freeBidCommitHash(2n, 1n, BIDDER).toString("hex"),
    );
  });

  it("is deterministic — the same triple always re-opens the envelope", () => {
    const a = freeBidCommitHash(12_345n, 67_890n, BIDDER);
    const b = freeBidCommitHash(12_345n, 67_890n, BIDDER);
    expect(a.toString("hex")).to.equal(b.toString("hex"));
  });

  it("survives u64 extremes without truncation", () => {
    const max = 2n ** 64n - 1n;
    expect(() => freeBidCommitHash(max, max, BIDDER)).to.not.throw();
    expect(freeBidCommitHash(max, max, BIDDER).toString("hex")).to.not.equal(
      freeBidCommitHash(0n, max, BIDDER).toString("hex"),
    );
  });
});

describe("randomBidSalt — SEV-013 entropy guard", () => {
  it("never returns 0 (the program rejects it outright)", () => {
    for (let i = 0; i < 64; i++) {
      expect(randomBidSalt()).to.not.equal(0n);
    }
  });

  it("fits u64 and does not repeat across draws", () => {
    const seen = new Set<bigint>();
    for (let i = 0; i < 64; i++) {
      const s = randomBidSalt();
      expect(s < 2n ** 64n, "salt fits u64").to.equal(true);
      seen.add(s);
    }
    // 64 draws from a 2^64 space colliding would mean the RNG is broken.
    expect(seen.size).to.equal(64);
  });
});

describe("freeBidAmount — whole installments only", () => {
  const INSTALLMENT = 2_000_000n;

  it("prices a K-installment bid", () => {
    expect(freeBidAmount(1, INSTALLMENT)).to.equal(INSTALLMENT);
    expect(freeBidAmount(3, INSTALLMENT)).to.equal(6_000_000n);
  });

  it("rejects non-positive or fractional parcel counts", () => {
    // The program requires an exact multiple (`BidAmountNotMultiple`);
    // catching it here means the UI never seals an unopenable envelope.
    expect(() => freeBidAmount(0, INSTALLMENT)).to.throw();
    expect(() => freeBidAmount(-1, INSTALLMENT)).to.throw();
    expect(() => freeBidAmount(1.5, INSTALLMENT)).to.throw();
  });

  it("always yields an exact multiple of the installment", () => {
    for (let k = 1; k <= 12; k++) {
      expect(freeBidAmount(k, INSTALLMENT) % INSTALLMENT).to.equal(0n);
    }
  });
});

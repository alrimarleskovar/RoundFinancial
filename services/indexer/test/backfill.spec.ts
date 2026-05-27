/**
 * Pin the Anchor account discriminators the backfill filters on (ADR 0009
 * follow-up). A dataSize filter silently returned 0 rows when Pool::SIZE
 * drifted (244 → 255); the discriminator memcmp is robust to layout edits
 * but DOES change if the account's type name changes — this test locks the
 * expected values so an accidental rename is caught in CI, not on devnet.
 *
 * The real end-to-end proof is the on-devnet backfill re-run
 * (poolsTouched=3, membersTouched=9, zero orphan); this is the cheap guard.
 */

import { expect } from "chai";

import { accountDiscriminatorBase58 } from "../src/discriminator.js";

describe("backfill — account discriminators (layout-drift-robust filter)", () => {
  it("Pool discriminator is pinned (sha256('account:Pool')[..8], base58)", () => {
    expect(accountDiscriminatorBase58("Pool")).to.equal("hQrXeCntzbV");
  });

  it("Member discriminator is pinned", () => {
    expect(accountDiscriminatorBase58("Member")).to.equal("A3cUbSeznMK");
  });
});

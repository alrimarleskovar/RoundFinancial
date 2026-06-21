/**
 * Decision-tree coverage for `inferDefaultReason` (security review,
 * Caio 2026-06-12 HIGH #2/#3 — stub replaced with real inference).
 *
 * Pure function, no DB. Locks the three branches the indexer derives
 * from the on-chain `settle_default` seized-cascade fields. A change to
 * the branch ordering or the comparison directions would silently
 * mis-classify defaults — and the on-chain payload still won't carry a
 * reason field, so this spec is the only gate against drift.
 */

import { expect } from "chai";

import { inferDefaultReason } from "../src/projector.js";

describe("inferDefaultReason — Triple-Shield cascade decision tree", () => {
  it("MissedDeadline: solidarity alone covered the missed installment (base case)", () => {
    // c_init = 3_000 (full collateral), d_rem = 1_000 (one installment),
    // c_after = 2_950 (solidarity nibble), seizedStake = 0 → MissedDeadline.
    expect(
      inferDefaultReason({
        dRem: 1_000n,
        cInit: 3_000n,
        cAfter: 2_950n,
        seizedStake: 0n,
      }).defaultReason,
    ).to.equal("MissedDeadline");
  });

  it("InsufficientStake: c_init below d_rem — structurally undercollateralised", () => {
    // Member's total collateral can't cover their debt even before the
    // cascade starts — most serious failure mode.
    expect(
      inferDefaultReason({
        dRem: 5_000n,
        cInit: 3_000n,
        cAfter: 0n,
        seizedStake: 3_000n,
      }).defaultReason,
    ).to.equal("InsufficientStake");
  });

  it("SolvencyGuardTriggered: cascade had to seize stake, c_after still < d_rem", () => {
    // c_init = d_rem (just enough), solidarity + escrow used up, cascade
    // dipped into stake — solvency guard activated.
    expect(
      inferDefaultReason({
        dRem: 3_000n,
        cInit: 3_000n,
        cAfter: 500n,
        seizedStake: 1_500n,
      }).defaultReason,
    ).to.equal("SolvencyGuardTriggered");
  });

  it("InsufficientStake wins over SolvencyGuardTriggered when both could match", () => {
    // c_init < d_rem AND seizedStake > 0 — InsufficientStake is the
    // structural cause; the stake seizure is downstream of that.
    expect(
      inferDefaultReason({
        dRem: 10_000n,
        cInit: 3_000n,
        cAfter: 0n,
        seizedStake: 3_000n,
      }).defaultReason,
    ).to.equal("InsufficientStake");
  });

  it("MissedDeadline when stake was seized but c_after still covers d_rem", () => {
    // Edge: seizedStake > 0 but cascade did not deplete collateral below
    // debt — solvency guard didn't really activate (the cascade just
    // happened to touch stake). Fall back to the base case.
    expect(
      inferDefaultReason({
        dRem: 1_000n,
        cInit: 5_000n,
        cAfter: 4_000n,
        seizedStake: 500n,
      }).defaultReason,
    ).to.equal("MissedDeadline");
  });

  it("provenance is always Inferred", () => {
    // The on-chain program emits no reason field; the indexer always
    // tags its inference so the admin renders an explicit "inferred" badge.
    const cases = [
      { dRem: 1_000n, cInit: 3_000n, cAfter: 2_950n, seizedStake: 0n },
      { dRem: 5_000n, cInit: 3_000n, cAfter: 0n, seizedStake: 3_000n },
      { dRem: 3_000n, cInit: 3_000n, cAfter: 500n, seizedStake: 1_500n },
    ];
    for (const c of cases) {
      expect(inferDefaultReason(c).defaultReasonProvenance).to.equal("Inferred");
    }
  });
});

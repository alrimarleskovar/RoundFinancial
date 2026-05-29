/**
 * Harvest slippage-floor computation (RoundFi internal audit Wave 3).
 *
 * Pins the single source of truth that turns an on-chain expected-surplus
 * reading into the `min_realized_usdc` floor the core program enforces.
 * The audit found the crank defaulted this to 0 (guard inert); these
 * tests pin that the DEFAULT path now produces a live floor and that the
 * opt-out is explicit.
 */

import { expect } from "chai";

import { computeHarvestFloor, DEFAULT_HARVEST_TOLERANCE_BPS } from "../sdk/src/yield.js";

describe("computeHarvestFloor", () => {
  it("computes a live floor below the expected surplus by default (1%)", () => {
    const r = computeHarvestFloor({ expectedRealized: 1_000_000n });
    expect(r.source).to.equal("computed");
    // 1_000_000 × (10_000 − 100) / 10_000 = 990_000
    expect(r.minRealizedUsdc).to.equal(990_000n);
  });

  it("uses DEFAULT_HARVEST_TOLERANCE_BPS when no tolerance is given", () => {
    const expected = 5_000_000n;
    const r = computeHarvestFloor({ expectedRealized: expected });
    const keep = BigInt(10_000 - DEFAULT_HARVEST_TOLERANCE_BPS);
    expect(r.minRealizedUsdc).to.equal((expected * keep) / 10_000n);
  });

  it("honors a custom tolerance", () => {
    const r = computeHarvestFloor({ expectedRealized: 1_000_000n, toleranceBps: 250 });
    // 1_000_000 × 9_750 / 10_000 = 975_000
    expect(r.minRealizedUsdc).to.equal(975_000n);
    expect(r.source).to.equal("computed");
  });

  it("floors (never rounds the floor ABOVE the expected surplus)", () => {
    // 7 × 9_900 / 10_000 = 6.93 → floor 6 (never 7+)
    const r = computeHarvestFloor({ expectedRealized: 7n });
    expect(r.minRealizedUsdc).to.equal(6n);
    expect(r.minRealizedUsdc < 7n).to.equal(true);
  });

  it("reports 'disabled' (floor 0) when there is no surplus to floor", () => {
    expect(computeHarvestFloor({ expectedRealized: 0n })).to.deep.equal({
      minRealizedUsdc: 0n,
      source: "disabled",
    });
    expect(computeHarvestFloor({ expectedRealized: -5n }).source).to.equal("disabled");
  });

  it("lets an explicit override win — including an intentional opt-out (0n)", () => {
    const optOut = computeHarvestFloor({ expectedRealized: 1_000_000n, override: 0n });
    expect(optOut).to.deep.equal({ minRealizedUsdc: 0n, source: "override" });

    const explicit = computeHarvestFloor({ expectedRealized: 1_000_000n, override: 123_456n });
    expect(explicit).to.deep.equal({ minRealizedUsdc: 123_456n, source: "override" });
  });

  it("clamps tolerance to [0, 10_000]", () => {
    // tolerance 0 → floor equals the full expected surplus.
    expect(
      computeHarvestFloor({ expectedRealized: 1_000_000n, toleranceBps: 0 }).minRealizedUsdc,
    ).to.equal(1_000_000n);
    // tolerance > 100% clamps to 100% → floor 0.
    expect(
      computeHarvestFloor({ expectedRealized: 1_000_000n, toleranceBps: 50_000 }).minRealizedUsdc,
    ).to.equal(0n);
    // negative tolerance clamps to 0 → full surplus.
    expect(
      computeHarvestFloor({ expectedRealized: 1_000_000n, toleranceBps: -10 }).minRealizedUsdc,
    ).to.equal(1_000_000n);
  });
});

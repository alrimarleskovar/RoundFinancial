/**
 * Insights v0 — the pure primitives (ADR 0010 §2 + §5), with NO database.
 *
 * Why this file exists separately from `insights.spec.ts`: that file
 * constructs `new PrismaClient()` at MODULE level, so it throws
 * `PrismaClientInitializationError` at import time without a live Postgres —
 * taking the pure-helper tests down with it. The result was that the gates
 * which exist to stop us rendering noise as a number had no coverage in any
 * CI lane. `classifySample` and `wilson95Bps` are pure functions of numbers;
 * they never needed a database to be tested.
 *
 * So this file has exactly one import from the product code and no I/O. If
 * it ever needs a fixture, the fixture belongs in the DB-backed spec instead.
 *
 * Every expected value below was computed from the implementation and pinned,
 * not eyeballed — these are exact-value assertions, so a change in the
 * arithmetic fails loudly rather than drifting.
 */

import { expect } from "chai";

import { INSIGHTS_THRESHOLDS, classifySample, wilson95Bps } from "../src/insights.js";

describe("Insights v0 — sample-size thresholds are pinned to ADR 0010 §2", function () {
  this.timeout(5_000);

  // The whole anti-p-hacking argument rests on these four numbers being
  // an amendment rather than a feature flag. If someone lowers a threshold
  // to make a devnet card render, that is exactly the failure mode the ADR
  // was written to prevent — so it has to break the build, not pass quietly.
  it("the four thresholds match the ADR exactly", () => {
    expect(INSIGHTS_THRESHOLDS.retentionPerCohort).to.equal(30);
    expect(INSIGHTS_THRESHOLDS.predictorTotalWallets).to.equal(100);
    expect(INSIGHTS_THRESHOLDS.progressionEligibleWallets).to.equal(50);
    expect(INSIGHTS_THRESHOLDS.improvementEligibleWallets).to.equal(30);
  });

  it("no threshold is zero or negative (which would disable the gate)", () => {
    for (const [name, t] of Object.entries(INSIGHTS_THRESHOLDS)) {
      expect(t, name).to.be.a("number");
      expect(t, name).to.be.greaterThan(0);
    }
  });
});

describe("Insights v0 — classifySample", function () {
  this.timeout(5_000);

  it("below T → insufficient", () => {
    expect(classifySample(0, 30)).to.equal("insufficient");
    expect(classifySample(29, 30)).to.equal("insufficient");
  });

  it("[T, 2T) → preliminary", () => {
    expect(classifySample(30, 30)).to.equal("preliminary");
    expect(classifySample(59, 30)).to.equal("preliminary");
  });

  it("≥ 2T → significant", () => {
    expect(classifySample(60, 30)).to.equal("significant");
    expect(classifySample(1_000, 30)).to.equal("significant");
  });

  // Both boundaries are inclusive-below / exclusive-above, and both are
  // off-by-one bait: `n === T` must already render (preliminary), and
  // `n === 2T - 1` must NOT yet be significant.
  it("the boundaries land on the documented side at every real threshold", () => {
    for (const t of Object.values(INSIGHTS_THRESHOLDS)) {
      expect(classifySample(t - 1, t), `${t}-1`).to.equal("insufficient");
      expect(classifySample(t, t), `${t}`).to.equal("preliminary");
      expect(classifySample(2 * t - 1, t), `2*${t}-1`).to.equal("preliminary");
      expect(classifySample(2 * t, t), `2*${t}`).to.equal("significant");
    }
  });
});

describe("Insights v0 — wilson95Bps", function () {
  this.timeout(5_000);

  it("returns null with no observations (n = 0)", () => {
    expect(wilson95Bps(0, 0)).to.equal(null);
    expect(wilson95Bps(0, -1)).to.equal(null);
  });

  it("is exact at 50% of 100 → [4038, 5962] bps", () => {
    expect(wilson95Bps(50, 100)).to.deep.equal([4038, 5962]);
  });

  // This is WHY the ADR picked Wilson over Wald. At 0 successes Wald yields
  // [0, 0] — it claims certainty that the true rate is zero, from 100
  // observations. Wilson says [0%, 3.7%], which is the honest statement.
  // A default rate of "0%, definitely" is exactly the kind of number this
  // surface must never print.
  it("stays honest at zero successes — upper bound is strictly above 0", () => {
    expect(wilson95Bps(0, 100)).to.deep.equal([0, 370]);
  });

  it("stays honest at total successes — lower bound is strictly below 100%", () => {
    expect(wilson95Bps(100, 100)).to.deep.equal([9630, 10_000]);
  });

  it("never escapes [0, 10000] bps", () => {
    for (const [s, n] of [
      [0, 1],
      [1, 1],
      [0, 100],
      [100, 100],
      [1, 10],
      [15, 120],
    ] as [number, number][]) {
      const ci = wilson95Bps(s, n);
      expect(ci, `${s}/${n}`).to.not.equal(null);
      expect(ci![0], `${s}/${n} lo`).to.be.gte(0);
      expect(ci![1], `${s}/${n} hi`).to.be.lte(10_000);
      expect(ci![0], `${s}/${n} lo ≤ hi`).to.be.lte(ci![1]);
    }
  });

  // More evidence must mean a tighter claim. If this ever stops holding, the
  // interval has stopped being a function of sample size and the "preliminary
  // vs significant" badge would be decorative.
  it("narrows monotonically as n grows at a fixed proportion", () => {
    const widths = (
      [
        [5, 10],
        [50, 100],
        [500, 1_000],
        [5_000, 10_000],
      ] as [number, number][]
    ).map(([s, n]) => {
      const ci = wilson95Bps(s, n)!;
      return ci[1] - ci[0];
    });
    expect(widths).to.deep.equal([5_268, 1_924, 618, 196]);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i], `width at index ${i}`).to.be.lessThan(widths[i - 1]!);
    }
  });

  it("brackets the point estimate it describes", () => {
    for (const [s, n] of [
      [15, 120],
      [1, 10],
      [50, 100],
    ] as [number, number][]) {
      const ci = wilson95Bps(s, n)!;
      const pointBps = Math.round((s / n) * 10_000);
      expect(ci[0], `${s}/${n} lo ≤ p`).to.be.lte(pointBps);
      expect(ci[1], `${s}/${n} p ≤ hi`).to.be.gte(pointBps);
    }
  });
});

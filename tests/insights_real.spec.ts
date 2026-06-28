/**
 * Real /insights helpers — the pure on-chain→display math behind the real
 * behavioural factors and the reconstructed score curve
 * (app/src/data/insights.ts). Pure (no React / RPC / network), so it runs in
 * the normal mocha+tsx suite; the RPC wiring (useScoreInsights) is exercised by
 * the operator, not CI.
 */

import { expect } from "chai";

import {
  computeRealFactors,
  factorStatusKey,
  formatDayMon,
  niceScoreTicks,
  reconstructScoreHistory,
  scoreScale,
  type RepCounters,
} from "../app/src/data/insights.js";

const base: RepCounters = {
  exists: true,
  onTimePayments: 0,
  latePayments: 0,
  defaults: 0,
  cyclesCompleted: 0,
  totalParticipated: 0,
};

describe("insights — factorStatusKey ladder", () => {
  it("maps value to the status bands (boundaries inclusive)", () => {
    expect(factorStatusKey(90)).to.equal("excellent");
    expect(factorStatusKey(85)).to.equal("excellent");
    expect(factorStatusKey(84)).to.equal("good");
    expect(factorStatusKey(65)).to.equal("good");
    expect(factorStatusKey(45)).to.equal("developing");
    expect(factorStatusKey(44)).to.equal("improve");
    expect(factorStatusKey(0)).to.equal("improve");
  });
});

describe("insights — computeRealFactors (from on-chain counters)", () => {
  it("returns [] for a wallet with no reputation profile or no participation", () => {
    expect(computeRealFactors({ ...base, exists: false })).to.deep.equal([]);
    expect(computeRealFactors({ ...base, exists: true, totalParticipated: 0 })).to.deep.equal([]);
  });

  it("computes punctuality as the protocol's on-time rate", () => {
    const f = computeRealFactors({
      ...base,
      onTimePayments: 2,
      latePayments: 1,
      totalParticipated: 2,
    });
    const punc = f.find((x) => x.key === "punctuality");
    expect(punc?.value).to.equal(67); // 100 * 2/3
    const cons = f.find((x) => x.key === "consistency");
    expect(cons?.value).to.equal(85); // 100 - 1*15
    const div = f.find((x) => x.key === "diversity");
    expect(div?.value).to.equal(50); // 2 pools * 25
  });

  it("omits punctuality until there's a payment, and never fabricates anticipation", () => {
    const f = computeRealFactors({ ...base, totalParticipated: 1 });
    expect(f.map((x) => x.key)).to.not.include("punctuality"); // no payments yet
    expect(f.map((x) => x.key)).to.not.include("anticipation"); // not measured on-chain
    expect(f.map((x) => x.key)).to.include("diversity");
  });

  it("clamps to [0,100] and tanks consistency on a default", () => {
    const f = computeRealFactors({
      ...base,
      onTimePayments: 1,
      defaults: 1,
      totalParticipated: 1,
    });
    const cons = f.find((x) => x.key === "consistency");
    expect(cons?.value).to.equal(50); // 100 - 1*50
    f.forEach((x) => {
      expect(x.value).to.be.at.least(0);
      expect(x.value).to.be.at.most(100);
    });
  });
});

describe("insights — reconstructScoreHistory (anchored to current score)", () => {
  it("returns [] with no payments", () => {
    expect(reconstructScoreHistory(0, [], 0)).to.deep.equal([]);
  });

  it("steps +10 per payment and ends EXACTLY at the current score", () => {
    const pts = reconstructScoreHistory(30, [100, 200, 300], 50);
    expect(pts.map((p) => p.score)).to.deep.equal([0, 10, 20, 30]);
    expect(pts[pts.length - 1]!.score).to.equal(30); // anchor
    expect(pts[0]!.t).to.equal(50); // start seeded by earliest activity
  });

  it("sorts unordered payment times before stepping", () => {
    const pts = reconstructScoreHistory(130, [20, 10], 5);
    expect(pts.map((p) => [p.t, p.score])).to.deep.equal([
      [5, 110],
      [10, 120],
      [20, 130],
    ]);
  });

  it("degrades the step (not the endpoint) when penalties imply a sub-zero start", () => {
    const pts = reconstructScoreHistory(5, [1, 2, 3], 0); // 5 - 30 < 0
    expect(pts[0]!.score).to.equal(0); // floored start
    expect(pts[pts.length - 1]!.score).to.equal(5); // endpoint still exact
  });
});

describe("insights — scoreScale (fits the curve, with padding)", () => {
  it("brackets the curve's score range with at least 20pt padding", () => {
    const s = scoreScale([
      { t: 1, score: 110 },
      { t: 2, score: 130 },
    ]);
    expect(s.yMin).to.equal(90); // 110 - 20
    expect(s.yMax).to.equal(150); // 130 + 20
  });

  it("never goes below zero", () => {
    const s = scoreScale([
      { t: 1, score: 0 },
      { t: 2, score: 30 },
    ]);
    expect(s.yMin).to.equal(0);
    expect(s.yMax).to.equal(50);
  });
});

describe("insights — niceScoreTicks (Y-axis gridline values)", () => {
  it("returns round 10-step values for a typical low-score window", () => {
    // The padded window for a sub-tier wallet (e.g. score ~35) — the case that
    // used to render a blank Y-axis because no tier guide fell inside it.
    expect(niceScoreTicks(0, 55)).to.deep.equal([10, 20, 30, 40, 50]);
    expect(niceScoreTicks(5, 55)).to.deep.equal([10, 20, 30, 40, 50]);
  });

  it("keeps ticks strictly inside the window (never on the padded edges)", () => {
    const ticks = niceScoreTicks(0, 50);
    expect(ticks).to.deep.equal([10, 20, 30, 40]); // 0 and 50 excluded
    ticks.forEach((v) => {
      expect(v).to.be.greaterThan(0);
      expect(v).to.be.lessThan(50);
    });
  });

  it("scales the step up for a wide window", () => {
    expect(niceScoreTicks(90, 150)).to.deep.equal([100, 110, 120, 130, 140]);
  });

  it("returns [] for a degenerate or inverted span", () => {
    expect(niceScoreTicks(10, 10)).to.deep.equal([]);
    expect(niceScoreTicks(50, 40)).to.deep.equal([]);
  });
});

describe("insights — formatDayMon", () => {
  it("renders PT and EN day+month (UTC-noon, TZ-stable)", () => {
    const ts = Date.UTC(2026, 5, 26, 12); // 26 Jun 2026, noon UTC
    expect(formatDayMon(ts, "pt")).to.equal("26 Jun");
    expect(formatDayMon(ts, "en")).to.equal("Jun 26");
  });
});

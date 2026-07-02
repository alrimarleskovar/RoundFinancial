/**
 * Real /insights helpers — the pure on-chain→display math behind the real
 * behavioural factors and the reconstructed score curve
 * (app/src/data/insights.ts). Pure (no React / RPC / network), so it runs in
 * the normal mocha+tsx suite; the RPC wiring (useScoreInsights) is exercised by
 * the operator, not CI.
 */

import { expect } from "chai";

import {
  annotateScoreHistory,
  buildScoreTimeline,
  computeRealFactors,
  factorStatusKey,
  formatDayMon,
  formatDayTime,
  niceScoreTicks,
  reconstructScoreHistory,
  scoreDeltaFor,
  scoreScale,
  type RepCounters,
  type ScoreAttestation,
  type ScorePoint,
} from "../app/src/data/insights.js";

// Attestation schema ids (roundfi-reputation constants).
const S = { payment: 1, late: 2, default: 3, cycle: 4, levelUp: 5 } as const;
const att = (o: Partial<ScoreAttestation> & { schemaId: number }): ScoreAttestation => ({
  issuedAtMs: 0,
  verified: true,
  neutralized: false,
  revoked: false,
  ...o,
});

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

describe("insights — formatDayTime", () => {
  it("appends a zero-padded local clock to the day+month label", () => {
    const ts = Date.UTC(2026, 5, 26, 12); // noon UTC
    const out = formatDayTime(ts, "pt");
    // The date half is TZ-stable at noon; the clock is local, so just assert
    // the "<day mon> · HH:MM" shape rather than a fixed hour.
    expect(out).to.match(/^26 Jun · \d{2}:\d{2}$/);
  });
});

describe("insights — annotateScoreHistory (why the score moved)", () => {
  const raw: ScorePoint[] = [
    { t: 5, score: 0 },
    { t: 10, score: 10 },
    { t: 20, score: 20 },
  ];

  it("tags the baseline as the join and each later vertex as a payment step", () => {
    const out = annotateScoreHistory(raw, "Pool Rápida", ["Pool Rápida", "Pool Rápida"]);
    expect(out[0]).to.deep.equal({
      t: 5,
      score: 0,
      kind: "join",
      delta: 0,
      poolName: "Pool Rápida",
    });
    expect(out[1]).to.deep.equal({
      t: 10,
      score: 10,
      kind: "payment",
      delta: 10,
      poolName: "Pool Rápida",
    });
    expect(out[2]!.kind).to.equal("payment");
    expect(out[2]!.delta).to.equal(10); // 20 - 10
  });

  it("computes delta against the previous vertex, not a fixed step", () => {
    // A folded penalty makes the step non-uniform; delta must track the actual
    // score change between consecutive vertices.
    const uneven: ScorePoint[] = [
      { t: 1, score: 0 },
      { t: 2, score: 8 },
      { t: 3, score: 20 },
    ];
    const out = annotateScoreHistory(uneven, null, [null, null]);
    expect(out.map((p) => p.delta)).to.deep.equal([0, 8, 12]);
  });

  it("omits poolName cleanly when unknown (no undefined-valued key)", () => {
    const out = annotateScoreHistory(raw, null, [null, null]);
    expect(out[0]).to.deep.equal({ t: 5, score: 0, kind: "join", delta: 0 });
    expect(out[0]).to.not.have.property("poolName");
    expect(out[1]).to.not.have.property("poolName");
  });

  it("returns [] for an empty history", () => {
    expect(annotateScoreHistory([], "X", [])).to.deep.equal([]);
  });
});

describe("insights — scoreDeltaFor (exact on-chain per-attestation delta)", () => {
  it("halves a positive payment / cycle when the subject wasn't verified", () => {
    expect(scoreDeltaFor(att({ schemaId: S.payment, verified: true }))).to.equal(10);
    expect(scoreDeltaFor(att({ schemaId: S.payment, verified: false }))).to.equal(5);
    expect(scoreDeltaFor(att({ schemaId: S.cycle, verified: true }))).to.equal(50);
    expect(scoreDeltaFor(att({ schemaId: S.cycle, verified: false }))).to.equal(25);
  });

  it("applies the full unweighted penalty for late / default", () => {
    expect(scoreDeltaFor(att({ schemaId: S.late }))).to.equal(-100);
    expect(scoreDeltaFor(att({ schemaId: S.default }))).to.equal(-500);
  });

  it("scores nothing for revoked, neutralized cycle, or informational schemas", () => {
    expect(scoreDeltaFor(att({ schemaId: S.payment, revoked: true }))).to.equal(0);
    expect(scoreDeltaFor(att({ schemaId: S.cycle, neutralized: true }))).to.equal(0);
    expect(scoreDeltaFor(att({ schemaId: S.levelUp }))).to.equal(0); // SCHEMA_LEVEL_UP
    expect(scoreDeltaFor(att({ schemaId: 99 }))).to.equal(0); // unknown/future
  });
});

describe("insights — buildScoreTimeline (true attestation replay)", () => {
  it("seeds a score-0 baseline then steps each event's exact delta in time order", () => {
    const pts = buildScoreTimeline([
      att({ schemaId: S.payment, issuedAtMs: 200, verified: false, poolName: "Pool A" }), // +5
      att({ schemaId: S.payment, issuedAtMs: 100, verified: true, poolName: "Pool A" }), // +10 (earlier)
      att({ schemaId: S.cycle, issuedAtMs: 300, verified: true }), // +50
    ]);
    expect(pts.map((p) => [p.score, p.kind, p.delta])).to.deep.equal([
      [0, "join", 0],
      [10, "payment", 10],
      [15, "payment", 5],
      [65, "cycle", 50],
    ]);
    expect(pts[pts.length - 1]!.score).to.equal(65); // endpoint = true on-chain score
    expect(pts[1]!.poolName).to.equal("Pool A");
  });

  it("floors the score at 0 (mirrors saturating_sub) and shows the real drop", () => {
    const pts = buildScoreTimeline([
      att({ schemaId: S.payment, issuedAtMs: 1, verified: true }), // 0 → 10
      att({ schemaId: S.default, issuedAtMs: 2 }), // 10 − 500 → floored 0
    ]);
    expect(pts.map((p) => p.score)).to.deep.equal([0, 10, 0]);
    // The plotted change is the ACTUAL score movement (−10), not the raw −500.
    expect(pts[2]!.delta).to.equal(-10);
    expect(pts[2]!.kind).to.equal("default");
  });

  it("drops non-scoring events (revoked / neutralized / level-up) from the curve", () => {
    const pts = buildScoreTimeline([
      att({ schemaId: S.payment, issuedAtMs: 1, verified: true }),
      att({ schemaId: S.payment, issuedAtMs: 2, revoked: true }),
      att({ schemaId: S.cycle, issuedAtMs: 3, neutralized: true }),
      att({ schemaId: S.levelUp, issuedAtMs: 4 }),
    ]);
    expect(pts.map((p) => p.score)).to.deep.equal([0, 10]); // only the real +10 survives
  });

  it("returns [] when there are no scoring events", () => {
    expect(buildScoreTimeline([])).to.deep.equal([]);
    expect(buildScoreTimeline([att({ schemaId: S.levelUp })])).to.deep.equal([]);
  });
});

/**
 * Exact-value coverage for Reliability + Punctuality (Phase C.3),
 * against the proposal's published test vectors
 * (`01-proposal.md` §6, `03-spec.md` BLOQUEADOR 1).
 *
 * These are the "obrigatório" vectors the spec demands before any
 * instruction consumes the metric — locked here so a weight or formula
 * drift fails CI.
 */

import { expect } from "chai";

import type { EventClassification } from "../src/behavioralClassification.js";
import {
  type BehavioralSignal,
  PUNCTUALITY_NEUTRAL,
  punctuality,
  punctualityOfAvg,
  reliability,
} from "../src/reputationMetrics.js";

/** N events of one classification (delta only matters for punctuality). */
function evts(c: EventClassification, n: number, delta: bigint = 0n): BehavioralSignal[] {
  return Array.from({ length: n }, () => ({ classification: c, deltaSeconds: delta }));
}

describe("reliability — proposal §6 published vectors", () => {
  it("50 on-time events → 100", () => {
    expect(reliability(evts("payment_on_time", 50))).to.equal(100);
  });

  it("49 on-time + 1 default → 98", () => {
    expect(reliability([...evts("payment_on_time", 49), ...evts("default", 1)])).to.equal(98);
  });

  it("49 on-time + 1 friction_temporal (95) → 99 (trunc of 99.9)", () => {
    // (49*100 + 95) / 50 = 4995/50 = 99.9 → trunc 99
    expect(reliability([...evts("payment_on_time", 49), ...evts("friction_temporal", 1)])).to.equal(
      99,
    );
  });

  it("49 on-time + 1 late_behavioral (70) → 99 (trunc of 99.4)", () => {
    // (4900 + 70)/50 = 4970/50 = 99.4 → trunc 99
    expect(reliability([...evts("payment_on_time", 49), ...evts("late_behavioral", 1)])).to.equal(
      99,
    );
  });

  it("empty window → 0 (no evidence, div-by-zero guard)", () => {
    expect(reliability([])).to.equal(0);
  });

  it("window of only non-reliability events (cycle_complete) → 0", () => {
    expect(reliability(evts("cycle_complete", 10))).to.equal(0);
  });

  it("cycle_complete events are excluded; only payments count", () => {
    // 50 on-time interleaved with cycle_complete → still 100.
    const mixed: BehavioralSignal[] = [];
    for (let i = 0; i < 50; i++) {
      mixed.push({ classification: "payment_on_time", deltaSeconds: 0n });
      mixed.push({ classification: "cycle_complete", deltaSeconds: null });
    }
    expect(reliability(mixed)).to.equal(100);
  });

  it("only the most-recent RELIABILITY_WINDOW events count", () => {
    // 60 defaults (old) then 50 on-time (recent) → window is the 50 recent → 100.
    const history = [...evts("default", 60), ...evts("payment_on_time", 50)];
    expect(reliability(history)).to.equal(100);
  });

  it("all defaults → 0 (no underflow)", () => {
    expect(reliability(evts("default", 50))).to.equal(0);
  });
});

describe("punctuality — proposal §6 piecewise-linear map", () => {
  it("no payment data → 80 (neutral)", () => {
    expect(punctuality([])).to.equal(PUNCTUALITY_NEUTRAL);
    expect(punctuality(evts("default", 5))).to.equal(80); // default carries no delta
  });

  it("breakpoints of punctualityOfAvg", () => {
    expect(punctualityOfAvg(-259_200n)).to.equal(100); // 3d early
    expect(punctualityOfAvg(-300_000n)).to.equal(100); // earlier still clamps
    expect(punctualityOfAvg(0n)).to.equal(80); // on the deadline
    expect(punctualityOfAvg(86_400n)).to.equal(60); // 1 day late
    expect(punctualityOfAvg(604_800n)).to.equal(30); // 7 days late
    expect(punctualityOfAvg(2_592_000n)).to.equal(0); // 30 days late
    expect(punctualityOfAvg(3_000_000n)).to.equal(0); // beyond 30d → 0
  });

  it("monotonic: earlier average never scores lower", () => {
    expect(punctualityOfAvg(-129_600n)).to.equal(90); // 1.5d early → midway 80..100
    expect(punctualityOfAvg(43_200n)).to.equal(70); // 0.5d late → midway 80..60
  });

  it("averages the payment window's deltas", () => {
    // two payments: 0s and 86_400s → avg 43_200 → 70.
    const h: BehavioralSignal[] = [
      { classification: "payment_on_time", deltaSeconds: 0n },
      { classification: "late_behavioral", deltaSeconds: 86_400n },
    ];
    expect(punctuality(h)).to.equal(70);
  });

  it("friction grace: a sub-1h-late payment counts as on time (delta floored to 0)", () => {
    // single payment 30min late → floored to 0 → 80, not 79.x.
    expect(punctuality([{ classification: "payment_on_time", deltaSeconds: 1_800n }])).to.equal(80);
  });

  it("excludes default / cycle_complete from the average", () => {
    // one on-time payment (delta 0) + noise → 80.
    const h: BehavioralSignal[] = [
      { classification: "default", deltaSeconds: null },
      { classification: "cycle_complete", deltaSeconds: null },
      { classification: "payment_on_time", deltaSeconds: 0n },
    ];
    expect(punctuality(h)).to.equal(80);
  });
});

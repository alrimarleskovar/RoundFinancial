/**
 * Exact-value coverage for `scoreFromSignals` (Phase C.3.3) — the pure
 * half of the score endpoint. No DB.
 *
 * Asserts the public response shape: the metrics, the
 * `formula_versao: "v1-provisional"` tag, the explicit `null` +
 * `pending` for the deferred metrics (commitment / recovery), and the
 * classification / polarity tallies. The DB-backed `loadSubjectScore`
 * (query + ordering) is operator-run (needs Postgres).
 */

import { expect } from "chai";

import type { BehavioralSignal } from "../src/reputationMetrics.js";
import { FORMULA_VERSAO, PENDING_METRICS, scoreFromSignals } from "../src/reputationScore.js";

function evts(
  c: BehavioralSignal["classification"],
  n: number,
  delta: bigint = 0n,
): BehavioralSignal[] {
  return Array.from({ length: n }, () => ({ classification: c, deltaSeconds: delta }));
}

describe("scoreFromSignals", () => {
  it("fresh wallet (no history) → honest default", () => {
    const s = scoreFromSignals("WALLET", []);
    expect(s.subject).to.equal("WALLET");
    expect(s.formula_versao).to.equal(FORMULA_VERSAO);
    expect(s.reliability).to.equal(0); // no evidence
    expect(s.punctuality).to.equal(80); // neutral
    expect(s.event_count).to.equal(0);
    expect(s.classification_counts).to.deep.equal({});
  });

  it("deferred metrics are null with an explicit pending list (never 0)", () => {
    const s = scoreFromSignals("W", evts("payment_on_time", 3));
    expect(s.commitment).to.equal(null);
    expect(s.recovery).to.equal(null);
    expect(s.pending).to.deep.equal(PENDING_METRICS);
    expect([...s.pending]).to.have.members(["commitment", "recovery"]);
  });

  it("50 on-time payments → reliability 100, punctuality 80", () => {
    const s = scoreFromSignals("W", evts("payment_on_time", 50));
    expect(s.reliability).to.equal(100);
    expect(s.punctuality).to.equal(80); // delta 0 → on the deadline
    expect(s.event_count).to.equal(50);
    expect(s.classification_counts.payment_on_time).to.equal(50);
  });

  it("tallies classification + polarity counts", () => {
    const history = [
      ...evts("payment_on_time", 5),
      ...evts("late_behavioral", 2),
      ...evts("default", 1),
      ...evts("cycle_complete", 3),
      ...evts("unspecified", 1),
    ];
    const s = scoreFromSignals("W", history);
    expect(s.event_count).to.equal(12);
    expect(s.classification_counts).to.deep.equal({
      payment_on_time: 5,
      late_behavioral: 2,
      default: 1,
      cycle_complete: 3,
      unspecified: 1,
    });
    // positive: 5 on_time + 3 cycle_complete = 8
    // neutral: 1 unspecified
    // negative: 2 late_behavioral + 1 default = 3
    expect(s.polarity_counts).to.deep.equal({ positive: 8, neutral: 1, negative: 3 });
  });

  it("reflects lateness in punctuality", () => {
    // two payments averaging 1 day late → punctuality 60.
    const s = scoreFromSignals("W", [
      { classification: "payment_on_time", deltaSeconds: 0n },
      { classification: "late_behavioral", deltaSeconds: 172_800n }, // avg 86_400 = 1d
    ]);
    expect(s.punctuality).to.equal(60);
  });
});

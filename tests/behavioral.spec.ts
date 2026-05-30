/**
 * Exact-value parity test for the canonical behavioral semantics
 * (`@roundfi/sdk/behavioral`).
 *
 * Per ADR 0009 / amendment #2: "field populated" is NOT a passing
 * criterion. This suite asserts the EXACT values the on-chain program
 * would produce, and proves `dueTs(c)` reproduces the `next_cycle_at`
 * that the program arrives at by iterated advances.
 *
 * On-chain cadence being mirrored:
 *   - join_pool.rs:302-307  — at activation: started_at = now,
 *     current_cycle = 0, next_cycle_at = started_at + cycle_duration.
 *   - claim_payout.rs:185-189 / skip_defaulted_payout.rs:88-90 — each
 *     advance: current_cycle += 1, next_cycle_at += cycle_duration.
 *   - contribute.rs:181 — on_time = unix_ts <= next_cycle_at.
 *   - settle_default.rs:160-172 — default eligible when
 *     now >= next_cycle_at + GRACE && contributions_paid < current_cycle
 *     && !defaulted.
 */

import { expect } from "chai";

import {
  GRACE_PERIOD_SECS,
  dueTs,
  deltaSeconds,
  isOnTime,
  usedGrace,
  classifyTiming,
  isDefaultEligible,
} from "@roundfi/sdk";

// Concrete, readable fixture. 30-day cycle (the POOL_DEFAULTS cadence),
// pool activated at an arbitrary but fixed UNIX second.
const STARTED_AT = 1_700_000_000n; // pool activation timestamp
const CYCLE = 2_592_000n; // 30 days, matches POOL_DEFAULTS.cycleDurationSec

describe("behavioral — canonical semantics (ADR 0009)", () => {
  it("pins GRACE_PERIOD_SECS to the on-chain value (7 days)", () => {
    expect(GRACE_PERIOD_SECS).to.equal(604_800);
  });

  describe("dueTs", () => {
    it("cycle 0 deadline == started_at + 1*cycle_duration (the activation next_cycle_at)", () => {
      expect(dueTs(STARTED_AT, CYCLE, 0)).to.equal(STARTED_AT + CYCLE);
    });

    it("uses (c + 1) — NOT c — so cycle 0 is one cycle out, cycle 1 is two cycles out", () => {
      expect(dueTs(STARTED_AT, CYCLE, 1)).to.equal(STARTED_AT + 2n * CYCLE);
      expect(dueTs(STARTED_AT, CYCLE, 5)).to.equal(STARTED_AT + 6n * CYCLE);
    });

    it("reproduces the program's iterated next_cycle_at advances exactly", () => {
      // Simulate join_pool activation + a run of claim/skip advances and
      // assert dueTs(currentCycle) equals the program's next_cycle_at at
      // every step (the SSOT anti-drift check).
      let currentCycle = 0;
      let nextCycleAt = STARTED_AT + CYCLE; // join_pool.rs activation
      for (let i = 0; i < 24; i++) {
        expect(dueTs(STARTED_AT, CYCLE, currentCycle)).to.equal(nextCycleAt);
        // claim_payout.rs / skip_defaulted_payout.rs advance
        currentCycle += 1;
        nextCycleAt += CYCLE;
      }
    });

    it("returns null while the pool is not Active (started_at <= 0)", () => {
      expect(dueTs(0n, CYCLE, 0)).to.equal(null);
    });

    it("rejects a negative cycle", () => {
      expect(() => dueTs(STARTED_AT, CYCLE, -1)).to.throw();
    });
  });

  describe("isOnTime / deltaSeconds (contribute.rs:181, inclusive boundary)", () => {
    const due = dueTs(STARTED_AT, CYCLE, 0)!;

    it("exactly at the deadline is on-time (<= is inclusive) with delta 0", () => {
      expect(isOnTime(due, due)).to.equal(true);
      expect(deltaSeconds(due, due)).to.equal(0);
    });

    it("one second early is on-time with delta -1", () => {
      expect(isOnTime(due - 1n, due)).to.equal(true);
      expect(deltaSeconds(due - 1n, due)).to.equal(-1);
    });

    it("one second late is NOT on-time with delta +1", () => {
      expect(isOnTime(due + 1n, due)).to.equal(false);
      expect(deltaSeconds(due + 1n, due)).to.equal(1);
    });
  });

  describe("usedGrace — open interval (due, due + GRACE)", () => {
    const due = dueTs(STARTED_AT, CYCLE, 0)!;

    it("at the deadline: not late, so not grace", () => {
      expect(usedGrace(due, due)).to.equal(false);
    });

    it("1s into the window: grace used", () => {
      expect(usedGrace(due + 1n, due)).to.equal(true);
    });

    it("1s before the window closes: grace used", () => {
      expect(usedGrace(due + BigInt(GRACE_PERIOD_SECS) - 1n, due)).to.equal(true);
    });

    it("exactly at due + GRACE: NOT grace (boundary is default-eligible)", () => {
      expect(usedGrace(due + BigInt(GRACE_PERIOD_SECS), due)).to.equal(false);
    });
  });

  describe("classifyTiming", () => {
    const due = dueTs(STARTED_AT, CYCLE, 0)!;

    it("on_time at/under the deadline", () => {
      expect(classifyTiming(due, due)).to.equal("on_time");
    });

    it("late_within_grace inside the window", () => {
      expect(classifyTiming(due + 100n, due)).to.equal("late_within_grace");
    });

    it("late_past_grace at/after due + GRACE", () => {
      expect(classifyTiming(due + BigInt(GRACE_PERIOD_SECS), due)).to.equal("late_past_grace");
    });
  });

  describe("isDefaultEligible (settle_default.rs:160-172)", () => {
    const nextCycleAt = STARTED_AT + CYCLE; // current-cycle deadline
    const base = {
      nextCycleAt,
      contributionsPaid: 0,
      currentCycle: 1,
      defaulted: false,
    };

    it("eligible exactly at next_cycle_at + GRACE when behind and not defaulted", () => {
      expect(isDefaultEligible({ ...base, now: nextCycleAt + BigInt(GRACE_PERIOD_SECS) })).to.equal(
        true,
      );
    });

    it("NOT eligible one second before grace elapses", () => {
      expect(
        isDefaultEligible({ ...base, now: nextCycleAt + BigInt(GRACE_PERIOD_SECS) - 1n }),
      ).to.equal(false);
    });

    it("NOT eligible if caught up (contributions_paid == current_cycle)", () => {
      expect(
        isDefaultEligible({
          ...base,
          contributionsPaid: 1,
          now: nextCycleAt + BigInt(GRACE_PERIOD_SECS) + 10n,
        }),
      ).to.equal(false);
    });

    it("NOT eligible if already defaulted (one-directional)", () => {
      expect(
        isDefaultEligible({
          ...base,
          defaulted: true,
          now: nextCycleAt + BigInt(GRACE_PERIOD_SECS) + 10n,
        }),
      ).to.equal(false);
    });
  });
});

/**
 * Pure-function tests for the settle gating logic:
 *
 *   - isEligibleForSettle: mirrors handler:163 (MemberNotBehind) + the
 *     "already defaulted" + "already paid out" early returns. Misclassifying
 *     here means paying gas for a guaranteed revert.
 *
 *   - classifyDefaultReason: PAYMENT_MISSED vs INFRA_FAILURE — this is the
 *     hook the off-chain score-contestation UI uses. Drift in either
 *     direction is a real user-facing fairness bug.
 *
 * The settle CPI itself is integration-level (needs a live RoundFiClient
 * + funded keypair) and lives in the bankrun/litesvm lanes, not here.
 */

import type { MemberView, PoolView } from "@roundfi/sdk";
import { PublicKey } from "@solana/web3.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { crankState } from "../src/crankState.js";
import {
  classifyDefaultReason,
  isEligibleForSettle,
  outageOverlapSecs,
} from "../src/settleDefaults.js";

const SOME_PK = new PublicKey("11111111111111111111111111111111");

function makePool(overrides: Partial<PoolView> = {}): PoolView {
  return {
    address: SOME_PK,
    usdcMint: SOME_PK,
    currentCycle: 2,
    nextCycleAt: BigInt(1_700_000_000),
    status: "Active",
    ...overrides,
  } as PoolView;
}

function makeMember(overrides: Partial<MemberView> = {}): MemberView {
  return {
    address: SOME_PK,
    wallet: SOME_PK,
    slotIndex: 0,
    contributionsPaid: 1, // behind by one cycle (current=2)
    defaulted: false,
    paidOut: false,
    ...overrides,
  } as MemberView;
}

describe("isEligibleForSettle", () => {
  it("eligible when member is behind, not defaulted, not paid out", () => {
    expect(isEligibleForSettle(makeMember(), makePool()).ok).toBe(true);
  });

  it("skips when already defaulted (we don't double-settle)", () => {
    const r = isEligibleForSettle(makeMember({ defaulted: true }), makePool());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("already_defaulted");
  });

  it("skips when already paid out (claim happened first)", () => {
    const r = isEligibleForSettle(makeMember({ paidOut: true }), makePool());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("already_paid_out");
  });

  it("skips when contributions_paid >= current_cycle (handler MemberNotBehind)", () => {
    const r = isEligibleForSettle(
      makeMember({ contributionsPaid: 2 }),
      makePool({ currentCycle: 2 }),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not_behind");
  });

  it("skips when contributions_paid > current_cycle (sanity)", () => {
    const r = isEligibleForSettle(
      makeMember({ contributionsPaid: 5 }),
      makePool({ currentCycle: 2 }),
    );
    expect(r.ok).toBe(false);
  });
});

// Grace window for the tests: [WINDOW_START, DEADLINE], 7-day grace.
const WINDOW_START = 1_700_000_000;
const GRACE = 7 * 24 * 60 * 60;
const DEADLINE = WINDOW_START + GRACE;

/** Record a completed outage window [startSecs, endSecs] via the real setters. */
function recordOutage(startSecs: number, endSecs: number): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(startSecs * 1000));
  crankState.markRpcDown();
  vi.setSystemTime(new Date(endSecs * 1000));
  crankState.markRpcUp();
  vi.useRealTimers();
}

describe("outageOverlapSecs", () => {
  beforeEach(() => crankState.__resetForTest());
  afterEach(() => vi.useRealTimers());

  it("is 0 when there was no outage", () => {
    expect(outageOverlapSecs(WINDOW_START, DEADLINE)).toBe(0);
  });

  it("is the full duration when the outage is entirely inside the window", () => {
    recordOutage(WINDOW_START + 100, WINDOW_START + 400);
    expect(outageOverlapSecs(WINDOW_START, DEADLINE)).toBe(300);
  });

  it("clamps to the window when the outage starts before it", () => {
    recordOutage(WINDOW_START - 50, WINDOW_START + 50);
    expect(outageOverlapSecs(WINDOW_START, DEADLINE)).toBe(50);
  });

  it("is 0 when the outage fell entirely after the deadline", () => {
    recordOutage(DEADLINE + 100, DEADLINE + 200);
    expect(outageOverlapSecs(WINDOW_START, DEADLINE)).toBe(0);
  });
});

describe("classifyDefaultReason", () => {
  beforeEach(() => crankState.__resetForTest());
  afterEach(() => vi.useRealTimers());

  it("returns PAYMENT_MISSED when there was no outage", () => {
    expect(classifyDefaultReason(WINDOW_START, DEADLINE, DEADLINE + 10)).toBe("PAYMENT_MISSED");
  });

  it("DEFERS (INFRA_FAILURE) while inside the outage-extended deadline", () => {
    // 600s outage inside the grace window → deadline extended by 600s.
    recordOutage(WINDOW_START + 1000, WINDOW_START + 1600);
    expect(classifyDefaultReason(WINDOW_START, DEADLINE, DEADLINE + 100)).toBe("INFRA_FAILURE");
  });

  it("settles (PAYMENT_MISSED) once the extension has elapsed — no stall", () => {
    recordOutage(WINDOW_START + 1000, WINDOW_START + 1600); // 600s extension
    expect(classifyDefaultReason(WINDOW_START, DEADLINE, DEADLINE + 700)).toBe("PAYMENT_MISSED");
  });

  it("returns PAYMENT_MISSED when the outage fell entirely before the grace window", () => {
    recordOutage(WINDOW_START - 2000, WINDOW_START - 1000);
    expect(classifyDefaultReason(WINDOW_START, DEADLINE, DEADLINE + 10)).toBe("PAYMENT_MISSED");
  });

  it("an outage spanning the deadline DEFERS (regression: recovery no longer forces a liquidation)", () => {
    // The exact ECO-V52 bug: crank down across the deadline then recovered.
    // Old code cleared rpcDownSince on markRpcUp → classified PAYMENT_MISSED →
    // liquidated. Now the persisted outage window extends the deadline.
    recordOutage(DEADLINE - 100, DEADLINE + 100); // overlap with [start,deadline] = 100
    expect(classifyDefaultReason(WINDOW_START, DEADLINE, DEADLINE + 50)).toBe("INFRA_FAILURE");
  });
});

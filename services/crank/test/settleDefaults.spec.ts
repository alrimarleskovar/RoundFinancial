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
import { classifyDefaultReason, isEligibleForSettle } from "../src/settleDefaults.js";

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

describe("classifyDefaultReason", () => {
  beforeEach(() => {
    crankState.__resetForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns PAYMENT_MISSED when RPC has never been down", () => {
    expect(classifyDefaultReason(1_700_000_000)).toBe("PAYMENT_MISSED");
  });

  it("returns INFRA_FAILURE when RPC was down at/before the grace deadline", () => {
    // RPC went down "yesterday" (well before the deadline). Use
    // vi.setSystemTime so markRpcDown's `new Date()` records that.
    const downAt = new Date((1_700_000_000 - 86_400) * 1000);
    vi.useFakeTimers();
    vi.setSystemTime(downAt);
    crankState.markRpcDown();
    vi.useRealTimers();
    expect(classifyDefaultReason(1_700_000_000)).toBe("INFRA_FAILURE");
  });

  it("returns PAYMENT_MISSED when RPC went down AFTER the grace deadline", () => {
    // RPC went down 1 hour after the deadline — member's miss is on them.
    const downAt = new Date((1_700_000_000 + 3600) * 1000);
    vi.useFakeTimers();
    vi.setSystemTime(downAt);
    crankState.markRpcDown();
    vi.useRealTimers();
    expect(classifyDefaultReason(1_700_000_000)).toBe("PAYMENT_MISSED");
  });

  it("treats markRpcUp clearing rpcDownSince as PAYMENT_MISSED", () => {
    crankState.markRpcDown();
    crankState.markRpcUp();
    expect(classifyDefaultReason(1_700_000_000)).toBe("PAYMENT_MISSED");
  });
});

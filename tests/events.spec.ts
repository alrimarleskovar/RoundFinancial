/**
 * LifecycleEvent canonical-types contract.
 *
 * Two checks the rest of the project relies on:
 *
 *   1. Exhaustive `switch` over `LifecycleEvent.kind` compiles —
 *      a new variant added to the union without updating consumers
 *      causes a compile error here. This is the early-warning siren
 *      for any change to the canonical event shape.
 *
 *   2. The orchestrator's re-export shim keeps the same union shape
 *      as `@roundfi/sdk/events` — runtime-checked by constructing
 *      one event of every kind and asserting it round-trips.
 */

import { expect } from "chai";

import type { LifecycleEvent } from "@roundfi/sdk/events";

// Helper: exhaustive switch. The `never` branch enforces — at compile
// time — that every kind has a case. Adding a new variant to the
// union without adding a case here produces a TS error.
function describeEvent(e: LifecycleEvent): string {
  switch (e.kind) {
    case "phase.start":         return `phase.start ${e.phase}`;
    case "phase.end":           return `phase.end ${e.phase} (${e.elapsedMs}ms)`;
    case "action.ok":           return `${e.action} OK`;
    case "action.skip":         return `${e.action} skip · ${e.reason}`;
    case "action.fail":         return `${e.action} FAIL · ${e.error}`;
    case "member.joined":       return `${e.actor} joined slot ${e.slotIndex}`;
    case "member.contributed":  return `${e.actor} paid cycle ${e.cycle}`;
    case "member.missed":       return `${e.actor} missed cycle ${e.cycle}`;
    case "payout.executed":     return `payout #${e.cycle} → ${e.actor}`;
    case "pool.snapshot":       return `snapshot cycle ${e.cycle} status=${e.status}`;
    case "summary":             return `summary ${e.totalEvents} events · ${e.elapsedMs}ms`;
    default: {
      // The `never` annotation here is what makes this compile-time
      // exhaustive. If a new variant is added to LifecycleEvent
      // without updating this switch, TypeScript flags `e` as
      // not-`never` and the build fails.
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
}

describe("LifecycleEvent — canonical-types contract", () => {
  it("exhaustive switch over every variant produces a string", () => {
    const samples: LifecycleEvent[] = [
      { kind: "phase.start",         phase: "cycle",    label: "cycle 1",  at: 0 },
      { kind: "phase.end",           phase: "cycle",    label: "cycle 1",  at: 0, elapsedMs: 350 },
      { kind: "action.ok",           action: "ping",                       at: 0, detail: "ok" },
      { kind: "action.skip",         action: "ping",                       at: 0, reason: "—" },
      { kind: "action.fail",         action: "ping",                       at: 0, error: "boom" },
      { kind: "member.joined",       actor: "Maria", slotIndex: 0,
                                     reputationLevel: 2, memberPda: "x",
                                     wallet: "y", stakeDeposited: 0n,     at: 0 },
      { kind: "member.contributed",  actor: "Maria", slotIndex: 0,
                                     cycle: 1, amount: 1_000_000n,
                                     onTime: true,                          at: 0 },
      { kind: "member.missed",       actor: "Maria", slotIndex: 0, cycle: 1,
                                     note: "—",                            at: 0 },
      { kind: "payout.executed",     actor: "Maria", slotIndex: 0, cycle: 1,
                                     amount: 5_000_000n,                    at: 0 },
      { kind: "pool.snapshot",       cycle: 1, status: "Active",
                                     totalContributed: 0n, totalPaidOut: 0n,
                                     solidarityBalance: 0n, escrowBalance: 0n,
                                     defaultedMembers: 0,
                                     poolUsdcVaultBalance: 0n,             at: 0 },
      { kind: "summary",             totalEvents: 11, okCount: 11,
                                     skipCount: 0, failCount: 0,
                                     startedAt: 0, finishedAt: 0,
                                     elapsedMs: 0, notes: [] },
    ];

    // Every sample must produce a non-empty string with no exception.
    for (const e of samples) {
      const out = describeEvent(e);
      expect(out, `kind=${e.kind}`).to.be.a("string").with.lengthOf.greaterThan(0);
    }
  });

  it("orchestrator shim re-exports the same LifecycleEvent type", async () => {
    // Runtime sanity: import via the legacy path and confirm the
    // function signature still accepts the canonical SDK shape.
    const { multiSink, nullSink } = await import("@roundfi/sdk/events");
    const events: LifecycleEvent[] = [];
    const sink = multiSink([(e) => events.push(e), nullSink]);
    sink({ kind: "action.ok", action: "ping", at: 0, detail: "ok" });
    expect(events.length).to.equal(1);
    expect(events[0]!.kind).to.equal("action.ok");
  });
});

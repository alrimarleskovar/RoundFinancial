/**
 * Tests for runOneTick's gating + isolation contract. This is the
 * load-bearing piece of the daemon — drift here is the difference
 * between a quiet outage and a paged incident.
 *
 * Pins:
 *   - lease.tryAcquire returning false: tick is a no-op (NO markCycleSuccess,
 *     so a follower's /health doesn't piggyback on the holder's work).
 *   - RPC unreachable: tick returns without markCycleSuccess (lets /health
 *     degrade naturally after STALE_TICK_MS).
 *   - Per-pool isolation: an exception from pool A does NOT stop pool B
 *     from being processed.
 *   - Top-level catch: an exception from fetchActivePools never propagates
 *     out of runOneTick.
 *
 * We stub the SDK by passing a minimal `client` shape and a fake
 * `connection` with the one method `checkRpcHealth` uses (`getVersion`).
 * `fetchActivePools` reads from the real SDK module, so the test instead
 * exercises the tick through a wrapper that injects pools via vi.mock.
 */

import type { Connection } from "@solana/web3.js";
import type { RoundFiClient } from "@roundfi/sdk";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { crankState } from "../src/crankState.js";
import type { LeaseClient } from "../src/lease.js";

vi.mock("../src/fetchActivePools.js", () => ({
  fetchActivePools: vi.fn(),
}));

vi.mock("../src/settleDefaults.js", () => ({
  checkAndSettleDefaults: vi.fn(),
}));

// Imported AFTER vi.mock so the loop sees the mocked impls.
const { runOneTick } = await import("../src/pollingLoop.js");
const { fetchActivePools } = await import("../src/fetchActivePools.js");
const { checkAndSettleDefaults } = await import("../src/settleDefaults.js");

const fetchActivePoolsMock = vi.mocked(fetchActivePools);
const checkAndSettleDefaultsMock = vi.mocked(checkAndSettleDefaults);

function fakeConnection(ok: boolean): Connection {
  return {
    getVersion: ok
      ? vi.fn().mockResolvedValue({ "solana-core": "1.18.26" })
      : vi.fn().mockRejectedValue(new Error("ECONNRESET")),
  } as unknown as Connection;
}

function fakeClient(): RoundFiClient {
  // Fields touched in runOneTick path are mocked via the module mocks
  // above; the client is just passed through.
  return {} as RoundFiClient;
}

function alwaysLease(): LeaseClient {
  return {
    tryAcquire: vi.fn().mockResolvedValue(true),
    release: vi.fn().mockResolvedValue(undefined),
  };
}

function neverLease(): LeaseClient {
  return {
    tryAcquire: vi.fn().mockResolvedValue(false),
    release: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  crankState.__resetForTest();
  fetchActivePoolsMock.mockReset();
  checkAndSettleDefaultsMock.mockReset();
});

describe("runOneTick — lease guard", () => {
  it("returns early without calling RPC or settling when lease is held by another instance", async () => {
    const conn = fakeConnection(true);
    await runOneTick({
      connection: conn,
      client: fakeClient(),
      lease: neverLease(),
    });
    expect(conn.getVersion).not.toHaveBeenCalled();
    expect(fetchActivePoolsMock).not.toHaveBeenCalled();
    expect(crankState.snapshot.lastSuccessfulRun).toBeNull();
  });
});

describe("runOneTick — RPC health gate", () => {
  it("does NOT markCycleSuccess when RPC is down", async () => {
    await runOneTick({
      connection: fakeConnection(false),
      client: fakeClient(),
      lease: alwaysLease(),
    });
    expect(crankState.snapshot.lastSuccessfulRun).toBeNull();
    expect(crankState.snapshot.rpcDownSince).not.toBeNull();
    expect(fetchActivePoolsMock).not.toHaveBeenCalled();
  });

  it("markCycleSuccess only fires after RPC ok + pools processed", async () => {
    fetchActivePoolsMock.mockResolvedValue([]);
    await runOneTick({
      connection: fakeConnection(true),
      client: fakeClient(),
      lease: alwaysLease(),
    });
    expect(crankState.snapshot.lastSuccessfulRun).not.toBeNull();
  });
});

describe("runOneTick — per-pool isolation", () => {
  it("one failing pool does not stop the next pool from being processed", async () => {
    const poolA = { address: { toBase58: () => "POOL_A" } } as never;
    const poolB = { address: { toBase58: () => "POOL_B" } } as never;
    fetchActivePoolsMock.mockResolvedValue([poolA, poolB]);
    // A throws, B succeeds.
    checkAndSettleDefaultsMock
      .mockRejectedValueOnce(new Error("AnchorError"))
      .mockResolvedValueOnce([]);

    await runOneTick({
      connection: fakeConnection(true),
      client: fakeClient(),
      lease: alwaysLease(),
    });

    expect(checkAndSettleDefaultsMock).toHaveBeenCalledTimes(2);
    // Tick still counts as success — the loop itself worked, the failed
    // pool's error was surfaced in its own log line.
    expect(crankState.snapshot.lastSuccessfulRun).not.toBeNull();
  });
});

describe("runOneTick — top-level catch", () => {
  it("does NOT throw when fetchActivePools rejects", async () => {
    fetchActivePoolsMock.mockRejectedValue(new Error("getProgramAccounts timeout"));
    await expect(
      runOneTick({
        connection: fakeConnection(true),
        client: fakeClient(),
        lease: alwaysLease(),
      }),
    ).resolves.toBeUndefined();
    // markCycleSuccess never fires on a top-level failure — /health
    // will degrade after STALE_TICK_MS.
    expect(crankState.snapshot.lastSuccessfulRun).toBeNull();
  });
});

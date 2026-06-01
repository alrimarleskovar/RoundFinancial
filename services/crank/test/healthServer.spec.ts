/**
 * Pins the `starting` / `ok` / `degraded` transitions of computeHealth.
 *
 * The HTTP code mapping (200 vs 503) is what UptimeRobot keys on — drift
 * from `degraded → 503` to `degraded → 200` would silently disarm the
 * alert, which is exactly the failure mode Gap 3 was designed to detect.
 *
 * Uses a frozen `now` to test the BOOT_GRACE_MS / STALE_TICK_MS edges
 * deterministically (no setTimeout / no sleep).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { crankState } from "../src/crankState.js";
import { computeHealth } from "../src/healthServer.js";

const BOOT_GRACE_MS = 5 * 60 * 1000;
const STALE_TICK_MS = 5 * 60 * 1000;

beforeEach(() => {
  crankState.__resetForTest();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("computeHealth — starting bucket", () => {
  it("returns starting while within 5min of boot, even with no ticks", () => {
    const bootAt = crankState.snapshot.bootAt;
    const now = new Date(bootAt.getTime() + 60_000); // +1 min
    const { status, body } = computeHealth(now);
    expect(status).toBe("starting");
    expect(body.lastRun).toBeNull();
  });

  it("starting persists even one ms before the boot grace ends", () => {
    const bootAt = crankState.snapshot.bootAt;
    const now = new Date(bootAt.getTime() + BOOT_GRACE_MS - 1);
    expect(computeHealth(now).status).toBe("starting");
  });
});

describe("computeHealth — ok bucket", () => {
  it("returns ok when past boot grace AND last tick is recent", () => {
    const bootAt = crankState.snapshot.bootAt;
    const now = new Date(bootAt.getTime() + BOOT_GRACE_MS + 60_000);
    // Mark a successful tick 30s before `now`. vi.setSystemTime patches
    // the Date constructor so markCycleSuccess()'s `new Date()` records
    // the staged time.
    const tickAt = new Date(now.getTime() - 30_000);
    vi.useFakeTimers();
    vi.setSystemTime(tickAt);
    crankState.markCycleSuccess();
    vi.useRealTimers();
    const { status, body } = computeHealth(now);
    expect(status).toBe("ok");
    expect(body.secondsSinceLastRun).toBe(30);
  });
});

describe("computeHealth — degraded bucket", () => {
  it("returns degraded when past boot grace AND no tick ever", () => {
    const bootAt = crankState.snapshot.bootAt;
    const now = new Date(bootAt.getTime() + BOOT_GRACE_MS + 60_000);
    const { status, body } = computeHealth(now);
    expect(status).toBe("degraded");
    expect(body.lastRun).toBeNull();
  });

  it("returns degraded when last tick is older than STALE_TICK_MS", () => {
    const bootAt = crankState.snapshot.bootAt;
    const now = new Date(bootAt.getTime() + BOOT_GRACE_MS + STALE_TICK_MS + 60_000);
    // Tick that's just past the stale boundary.
    const tickAt = new Date(now.getTime() - STALE_TICK_MS - 1);
    vi.useFakeTimers();
    vi.setSystemTime(tickAt);
    crankState.markCycleSuccess();
    vi.useRealTimers();
    expect(computeHealth(now).status).toBe("degraded");
  });
});

describe("computeHealth — body shape", () => {
  it("surfaces rpcDownSince when the RPC is currently flagged down", () => {
    crankState.markRpcDown();
    const { body } = computeHealth();
    expect(body.rpcDownSince).not.toBeNull();
    expect(body.rpcDownSince).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO8601
  });

  it("emits null secondsSinceLastRun when no tick has run", () => {
    expect(computeHealth().body.secondsSinceLastRun).toBeNull();
  });

  it("body.status mirrors the outer status (no drift)", () => {
    const bootAt = crankState.snapshot.bootAt;
    const now = new Date(bootAt.getTime() + BOOT_GRACE_MS + 60_000);
    const r = computeHealth(now);
    expect(r.body.status).toBe(r.status);
  });
});

/**
 * Pins the INFRA / LOGIC / UNKNOWN bucket boundaries of classifyError.
 *
 * Drift here changes whether settle.failed shows up as a quiet WARN (INFRA,
 * "next tick will retry") or an escalation ERROR (LOGIC, "on-chain state
 * diverged — eng needed"). Both directions are bugs:
 *
 *   - LOGIC misclassified as INFRA → real bug retried silently every minute
 *   - INFRA misclassified as LOGIC → on-call paged for a 429
 *
 * Each case below ties to one of the strings the crank actually sees in
 * prod-shaped errors (Anchor, web3.js, node:fetch). Add a case here when a
 * new prod-incident message appears.
 */

import { describe, it, expect } from "vitest";

import { classifyError } from "../src/classifyError.js";

describe("classifyError — INFRA bucket", () => {
  it.each([
    "Transaction was not confirmed in 30.00 seconds",
    "fetch failed",
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "ENOTFOUND",
    "socket hang up",
    "Blockhash not found",
    "Node is behind by 200 slots",
    "429 Too Many Requests",
    "503 Service Unavailable",
    "rate limit exceeded",
    "network request failed",
  ])("classifies %s as INFRA", (msg) => {
    expect(classifyError(new Error(msg))).toBe("INFRA");
  });
});

describe("classifyError — LOGIC bucket", () => {
  it.each([
    "custom program error: 0x1771",
    "AnchorError occurred. Error Code: GracePeriodNotElapsed",
    "Error Code: MemberNotBehind. Error Number: 6005",
    "constraint violated",
    "Transaction simulation failed: ...",
    "instruction error",
    "WrongCycle",
    "PoolNotActive",
    "AlreadyContributed",
    "CooldownActive",
  ])("classifies %s as LOGIC", (msg) => {
    expect(classifyError(new Error(msg))).toBe("LOGIC");
  });
});

describe("classifyError — UNKNOWN bucket", () => {
  it("falls through to UNKNOWN on a novel message", () => {
    expect(classifyError(new Error("the printer is on fire"))).toBe("UNKNOWN");
  });

  it("handles non-Error throws (string)", () => {
    // web3.js historically throws plain strings from a few code paths;
    // the classifier must not blow up on them.
    expect(classifyError("ETIMEDOUT")).toBe("INFRA");
  });

  it("handles non-Error throws (object)", () => {
    expect(classifyError({ code: "ECONNRESET" })).toBe("INFRA");
  });

  it("handles null without throwing", () => {
    expect(classifyError(null)).toBe("UNKNOWN");
  });

  it("handles undefined without throwing", () => {
    expect(classifyError(undefined)).toBe("UNKNOWN");
  });
});

describe("classifyError — case insensitivity", () => {
  it("matches regardless of message case", () => {
    expect(classifyError(new Error("CUSTOM PROGRAM ERROR"))).toBe("LOGIC");
    expect(classifyError(new Error("Blockhash Not Found"))).toBe("INFRA");
  });
});

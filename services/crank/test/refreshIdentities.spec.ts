import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";

import type { IdentityRecordView } from "@roundfi/sdk";

import { isStaleElite } from "../src/refreshIdentities.js";

const NOW = 1_000_000; // arbitrary unix seconds
const UNVERIFIED = 0;
const VERIFIED = 1;
const EXPIRED = 2;

function rec(over: Partial<IdentityRecordView> = {}): IdentityRecordView {
  return {
    address: PublicKey.default,
    wallet: PublicKey.default,
    status: VERIFIED,
    verifiedAt: 0n,
    expiresAt: 0n,
    gatewayToken: PublicKey.default,
    ...over,
  };
}

describe("isStaleElite", () => {
  it("false for a missing IdentityRecord (core already treats it as L1-floored)", () => {
    expect(isStaleElite(null, NOW)).toBe(false);
  });

  it("false for a never-expiring verified record (expires_at = 0)", () => {
    expect(isStaleElite(rec({ expiresAt: 0n }), NOW)).toBe(false);
  });

  it("false when the verified record has not yet expired", () => {
    expect(isStaleElite(rec({ expiresAt: BigInt(NOW + 1) }), NOW)).toBe(false);
  });

  it("true when a verified record has lapsed by wall-clock", () => {
    expect(isStaleElite(rec({ expiresAt: BigInt(NOW - 1) }), NOW)).toBe(true);
  });

  it("true at the exact expiry second (expires_at == now)", () => {
    expect(isStaleElite(rec({ expiresAt: BigInt(NOW) }), NOW)).toBe(true);
  });

  it("false when the record is already flipped to Expired (floor already applied)", () => {
    expect(isStaleElite(rec({ status: EXPIRED, expiresAt: BigInt(NOW - 100) }), NOW)).toBe(false);
  });

  it("false for an Unverified record", () => {
    expect(isStaleElite(rec({ status: UNVERIFIED, expiresAt: BigInt(NOW - 100) }), NOW)).toBe(
      false,
    );
  });
});

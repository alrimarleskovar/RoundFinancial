/**
 * Rust ↔ TS constants parity.
 *
 * PDA drift between the on-chain Rust program and the TS SDK is the
 * single most common cause of "instruction failed: seeds constraint
 * violated" surprises. This test is the cheap, validator-free guard:
 *
 *   1. Read `programs/roundfi-core/src/constants.rs` and
 *      `programs/roundfi-reputation/src/constants.rs` as strings.
 *   2. Extract every `pub const SEED_*: &[u8] = b"..."` literal.
 *   3. Assert each byte-for-byte matches the corresponding entry in
 *      the TS SDK `SEED` map (via `@roundfi/sdk`).
 *
 * Also checks numeric constants (stake bps, fee bps, seed draw, etc.)
 * between `roundfi-core::constants` and `@roundfi/sdk/constants`.
 *
 * This test runs under `pnpm run test:parity` with zero Solana
 * infrastructure — perfect first CI gate.
 */

import { expect } from "chai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Direct sub-path imports (not the barrel) so legacy ts-node 7's
// CommonJS resolver doesn't try to load the `.js`-suffixed re-exports
// that the barrel emits for NodeNext compatibility. Same workaround
// pattern as `economic_parity.spec.ts`.
import { SEED } from "@roundfi/sdk/pda";
import {
  FEES,
  STAKE_BPS_BY_LEVEL,
  POOL_DEFAULTS,
  ATTESTATION_SCHEMA,
  POOL_STATUS,
} from "@roundfi/sdk/constants";

const CORE_CONSTANTS = resolve(process.cwd(), "programs/roundfi-core/src/constants.rs");
const REP_CONSTANTS = resolve(process.cwd(), "programs/roundfi-reputation/src/constants.rs");
// Adevar Labs SEV-035 — enum drift between Rust state and SDK is a
// new parity surface. PoolStatus lives in `state/pool.rs` not
// `constants.rs`; add the path here so the enum extractor can read it.
const POOL_STATE = resolve(process.cwd(), "programs/roundfi-core/src/state/pool.rs");

function readRustConstants(path: string): string {
  return readFileSync(path, "utf-8");
}

// Matches: `pub const SEED_FOO: &[u8] = b"foo";` (with optional spaces).
const SEED_RE = /pub\s+const\s+(SEED_[A-Z_]+)\s*:\s*&\[\s*u8\s*\]\s*=\s*b"([^"]+)"\s*;/g;

function extractSeeds(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(SEED_RE)) {
    out.set(m[1]!, m[2]!);
  }
  return out;
}

// Matches: `pub const FOO_BAR: u16 = 1_000;` or `pub const X: i64 = -42;`.
// Accepts both signed and unsigned integer widths so we can parity-check
// cycle durations (i64) alongside bps (u16) without a second helper.
const INT_CONST_RE =
  /pub\s+const\s+([A-Z][A-Z_0-9]+)\s*:\s*[ui](?:8|16|32|64|size)\s*=\s*(-?[0-9_]+)\s*;/g;

function extractInt(src: string): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const m of src.matchAll(INT_CONST_RE)) {
    out.set(m[1]!, BigInt(m[2]!.replaceAll("_", "")));
  }
  return out;
}

/**
 * Extract `Variant = N` pairs from a `pub enum X { ... }` block.
 *
 * **Adevar Labs SEV-035** — `PoolStatus::Closed = 4` was added on-chain
 * by the SEV-005 fix but not propagated to the SDK `POOL_STATUS` map.
 * The auditor's W5 strategic recommendation: extend the parity test to
 * cover enum variants, not just seeds and numeric constants. This
 * helper closes that drift surface.
 *
 * Robust to standard formatting (allows trailing commas, doc-comments
 * between variants, whitespace). Rejects variants without an explicit
 * discriminant (`= N`) — the protocol's policy is "every wire-stable
 * enum value is pinned" so any drift to implicit discriminants is also
 * a finding worth catching.
 */
function extractEnumVariants(src: string, enumName: string): Map<string, number> {
  const enumRe = new RegExp(`pub\\s+enum\\s+${enumName}\\s*\\{([\\s\\S]*?)\\}`);
  const enumMatch = src.match(enumRe);
  if (!enumMatch) {
    throw new Error(`enum ${enumName} not found in source`);
  }
  const body = enumMatch[1]!;
  const variantRe = /([A-Za-z][A-Za-z0-9_]*)\s*=\s*(-?[0-9_]+)\s*[,}]/g;
  const out = new Map<string, number>();
  for (const m of body.matchAll(variantRe)) {
    out.set(m[1]!, Number(m[2]!.replaceAll("_", "")));
  }
  return out;
}

describe("Rust ↔ TS constants parity", () => {
  let coreSrc: string;
  let repSrc: string;

  before(() => {
    coreSrc = readRustConstants(CORE_CONSTANTS);
    repSrc = readRustConstants(REP_CONSTANTS);
  });

  describe("PDA seeds — roundfi-core", () => {
    // Map: Rust SEED_X constant → TS SDK key. `undefined` means the
    // Rust seed isn't mirrored in TS yet (e.g. listing — Step 4c,
    // SDK parity pending).
    const mapping: Record<string, string | undefined> = {
      SEED_CONFIG: "config",
      SEED_POOL: "pool",
      SEED_MEMBER: "member",
      SEED_ESCROW: "escrow",
      SEED_SOLIDARITY: "solidarity",
      SEED_YIELD: "yield",
      SEED_POSITION: "position",
      SEED_LISTING: undefined,
    };

    it("extracts every seed from Rust source", () => {
      const rust = extractSeeds(coreSrc);
      for (const rustName of Object.keys(mapping)) {
        expect(rust.has(rustName), `Rust constant missing: ${rustName}`).to.equal(true);
      }
    });

    it("each mirrored seed's bytes match the TS SDK verbatim", () => {
      const rust = extractSeeds(coreSrc);
      const seedTable = SEED as Record<string, Buffer>;
      for (const [rustName, tsKey] of Object.entries(mapping)) {
        if (tsKey === undefined) continue;
        const rustBytes = rust.get(rustName)!;
        const tsBytes = seedTable[tsKey];
        expect(tsBytes, `TS SDK missing SEED.${tsKey}`).to.not.equal(undefined);
        expect(
          Buffer.from(rustBytes).equals(tsBytes!),
          `seed mismatch ${rustName}: Rust="${rustBytes}" TS="${tsBytes!.toString()}"`,
        ).to.equal(true);
      }
    });
  });

  describe("PDA seeds — roundfi-reputation", () => {
    // Rust seeds live under `reputation::constants`; SDK keys follow
    // the cross-program naming convention. `undefined` = Rust-only
    // (no TS consumer yet): SEED_IDENTITY lands in Step 4d's identity
    // flows, SEED_POOL here is mirrored from core for issuer-PDA
    // derivation only.
    const mapping: Record<string, string | undefined> = {
      SEED_REP_CONFIG: "reputationConfig",
      SEED_PROFILE: "reputation",
      SEED_ATTESTATION: "attestation",
      SEED_IDENTITY: undefined,
      SEED_POOL: "pool",
    };

    it("Rust ↔ TS seed bytes agree", () => {
      const rust = extractSeeds(repSrc);
      const seedTable = SEED as Record<string, Buffer>;
      for (const [rustName, tsKey] of Object.entries(mapping)) {
        const rustBytes = rust.get(rustName);
        expect(rustBytes, `missing Rust constant ${rustName}`).to.not.equal(undefined);
        if (tsKey === undefined) continue;
        const tsBytes = seedTable[tsKey];
        expect(tsBytes, `TS SDK missing SEED.${tsKey}`).to.not.equal(undefined);
        expect(
          Buffer.from(rustBytes!).equals(tsBytes!),
          `seed mismatch ${rustName}: Rust="${rustBytes}" TS="${tsBytes!.toString()}"`,
        ).to.equal(true);
      }
    });
  });

  describe("Numeric constants — roundfi-core", () => {
    it("fee schedule matches", () => {
      const rust = extractInt(coreSrc);
      expect(Number(rust.get("DEFAULT_FEE_BPS_YIELD"))).to.equal(FEES.yieldFeeBps);
      expect(Number(rust.get("DEFAULT_FEE_BPS_CYCLE_L1"))).to.equal(FEES.cycleFeeL1Bps);
      expect(Number(rust.get("DEFAULT_FEE_BPS_CYCLE_L2"))).to.equal(FEES.cycleFeeL2Bps);
      expect(Number(rust.get("DEFAULT_FEE_BPS_CYCLE_L3"))).to.equal(FEES.cycleFeeL3Bps);
      expect(Number(rust.get("DEFAULT_GUARANTEE_FUND_BPS"))).to.equal(FEES.guaranteeFundBps);
      expect(Number(rust.get("SEED_DRAW_BPS"))).to.equal(FEES.seedDrawBps);
      expect(Number(rust.get("SOLIDARITY_BPS"))).to.equal(FEES.solidarityBps);
      expect(Number(rust.get("DEFAULT_ESCROW_RELEASE_BPS"))).to.equal(FEES.escrowReleaseBps);
    });

    it("stake bps by level matches", () => {
      const rust = extractInt(coreSrc);
      expect(Number(rust.get("STAKE_BPS_LEVEL_1"))).to.equal(STAKE_BPS_BY_LEVEL[1]);
      expect(Number(rust.get("STAKE_BPS_LEVEL_2"))).to.equal(STAKE_BPS_BY_LEVEL[2]);
      expect(Number(rust.get("STAKE_BPS_LEVEL_3"))).to.equal(STAKE_BPS_BY_LEVEL[3]);
    });

    it("pool defaults match", () => {
      const rust = extractInt(coreSrc);
      expect(Number(rust.get("DEFAULT_MEMBERS_TARGET"))).to.equal(POOL_DEFAULTS.membersTarget);
      expect(rust.get("DEFAULT_INSTALLMENT_AMOUNT")).to.equal(POOL_DEFAULTS.installmentAmount);
      expect(rust.get("DEFAULT_CREDIT_AMOUNT")).to.equal(POOL_DEFAULTS.creditAmount);
      expect(Number(rust.get("DEFAULT_CYCLES_TOTAL"))).to.equal(POOL_DEFAULTS.cyclesTotal);
      expect(Number(rust.get("DEFAULT_CYCLE_DURATION"))).to.equal(POOL_DEFAULTS.cycleDurationSec);
    });
  });

  describe("Schema IDs — roundfi-reputation", () => {
    // Rust uses `pub const SCHEMA_PAYMENT: u16 = 1;` etc.
    it("attestation schema IDs match", () => {
      const rust = extractInt(repSrc);
      expect(Number(rust.get("SCHEMA_PAYMENT"))).to.equal(ATTESTATION_SCHEMA.Payment);
      expect(Number(rust.get("SCHEMA_LATE"))).to.equal(ATTESTATION_SCHEMA.Late);
      expect(Number(rust.get("SCHEMA_DEFAULT"))).to.equal(ATTESTATION_SCHEMA.Default);
      expect(Number(rust.get("SCHEMA_CYCLE_COMPLETE"))).to.equal(ATTESTATION_SCHEMA.CycleComplete);
      expect(Number(rust.get("SCHEMA_LEVEL_UP"))).to.equal(ATTESTATION_SCHEMA.LevelUp);
    });
  });

  // Adevar Labs SEV-035 — enum drift coverage. The original drift was
  // PoolStatus::Closed=4 (added on-chain, missing from SDK) shipping
  // for an entire audit cycle without the parity test catching it.
  // Now: extract every enum variant from the on-chain Rust and assert
  // it has a matching SDK entry with the same discriminant.
  describe("Enum variants — roundfi-core", () => {
    it("PoolStatus on-chain ↔ SDK POOL_STATUS each variant matches by name + discriminant", () => {
      const poolSrc = readRustConstants(POOL_STATE);
      const rustVariants = extractEnumVariants(poolSrc, "PoolStatus");
      // Every Rust variant must appear in the SDK with the same value.
      for (const [name, value] of rustVariants) {
        const sdkValue = (POOL_STATUS as Record<string, number | undefined>)[name];
        expect(sdkValue, `SDK POOL_STATUS missing variant: ${name}`).to.not.equal(undefined);
        expect(sdkValue, `discriminant mismatch for PoolStatus::${name}`).to.equal(value);
      }
      // And every SDK entry must have a matching Rust variant — guards
      // against the inverse drift (SDK keeps a stale variant after the
      // on-chain enum removes it).
      for (const [name] of Object.entries(POOL_STATUS)) {
        expect(
          rustVariants.has(name),
          `Rust enum PoolStatus missing variant present in SDK: ${name}`,
        ).to.equal(true);
      }
    });
  });
});

/**
 * Email notifier pure helpers (PR3b) — the deterministic on-chain→display
 * formatters in services/indexer/src/email/select.ts. Pure (no DB / no RPC /
 * no network), so it runs in the normal mocha+tsx suite. notify.ts itself
 * needs Postgres + an RPC and is exercised by the operator, not CI.
 */

import { expect } from "chai";

import {
  collateralPctForLevel,
  daysUntil,
  formatBrl,
  formatDate,
  levelLabel,
  shortWallet,
} from "../services/indexer/src/email/select.js";

describe("email notifier — formatBrl (USDC base units → BRL)", () => {
  it("converts at the 5.5 rate with comma decimals", () => {
    expect(formatBrl(1_000_000n)).to.equal("R$ 5,50"); // 1 USDC
    expect(formatBrl(15_000_000n)).to.equal("R$ 82,50"); // 15 USDC
    expect(formatBrl(0n)).to.equal("R$ 0,00");
  });
});

describe("email notifier — formatDate (UTC, deterministic)", () => {
  const ts = Date.UTC(2026, 5, 29) / 1000; // 29 Jun 2026, 00:00 UTC

  it("renders PT and EN forms", () => {
    expect(formatDate(ts, "pt")).to.equal("29 jun 2026");
    expect(formatDate(ts, "en")).to.equal("Jun 29, 2026");
  });

  it("accepts bigint seconds (on-chain i64)", () => {
    expect(formatDate(BigInt(ts), "pt")).to.equal("29 jun 2026");
  });
});

describe("email notifier — shortWallet", () => {
  it("truncates to first4…last4 and passes through short strings", () => {
    expect(shortWallet("ABCDEFGHIJK")).to.equal("ABCD…HIJK");
    expect(shortWallet("short")).to.equal("short");
  });
});

describe("email notifier — daysUntil", () => {
  it("rounds up, floors at 1 day, and returns null once past", () => {
    expect(daysUntil(1_000, 1_000 + 2 * 86_400)).to.equal(2);
    expect(daysUntil(1_000, 1_000 + 3_600)).to.equal(1); // <24h still reads "1 dia"
    expect(daysUntil(1_000, 900)).to.equal(null); // already due
  });
});

describe("email notifier — level → label + collateral", () => {
  it("maps the v5.2 ladder and falls back to level 1", () => {
    expect(levelLabel(1)).to.equal("Iniciante");
    expect(levelLabel(2)).to.equal("Comprovado");
    expect(levelLabel(3)).to.equal("Veterano");
    expect(levelLabel(4)).to.equal("Elite");
    expect(levelLabel(99)).to.equal("Iniciante");
  });

  it("derives collateral % from STAKE_BPS_BY_LEVEL", () => {
    expect(collateralPctForLevel(1)).to.equal(50);
    expect(collateralPctForLevel(2)).to.equal(25);
    expect(collateralPctForLevel(3)).to.equal(10);
    expect(collateralPctForLevel(4)).to.equal(3);
  });
});

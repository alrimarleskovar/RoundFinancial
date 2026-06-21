/**
 * Kamino pin verification — drift gate in the `js` CI lane.
 *
 * The adapter's `KAMINO_LEND_PROGRAM_ID` const must match the canonical
 * value pinned in `scripts/mainnet/kamino-pin.ts`. This spec runs
 * `verifyKaminoPin` against the on-disk adapter source so any drift in
 * EITHER side surfaces here, immediately, in every PR.
 *
 * Operator-side liveness against a live RPC is covered by
 * `scripts/mainnet/verify-kamino-pin.ts --verify-rpc` (not in CI; needs
 * mainnet RPC access pre-deploy).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect } from "chai";

import {
  ADAPTER_LIB_RS_RELATIVE_PATH,
  EXPECTED_KAMINO_LEND_PROGRAM_ID,
  extractKaminoLendProgramId,
  verifyKaminoPin,
} from "../scripts/mainnet/kamino-pin.js";

const ADAPTER_SRC = readFileSync(resolve(process.cwd(), ADAPTER_LIB_RS_RELATIVE_PATH), "utf8");

describe("extractKaminoLendProgramId — regex correctness", () => {
  it("extracts the value from the canonical anchor_lang::pubkey! form", () => {
    const src = [
      "pub const KAMINO_LEND_PROGRAM_ID: Pubkey =",
      '    anchor_lang::pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");',
    ].join("\n");
    expect(extractKaminoLendProgramId(src)).to.equal("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
  });

  it("tolerates extra whitespace + a single-line form", () => {
    // The string inside the macro must be valid base58 (no 0, O, I, l).
    const src = `pub  const  KAMINO_LEND_PROGRAM_ID : Pubkey = pubkey ! ( "AbcDeFghJkMnPqRsTuVwXyZ123456789abcdefghjk" );`;
    expect(extractKaminoLendProgramId(src)).to.equal("AbcDeFghJkMnPqRsTuVwXyZ123456789abcdefghjk");
  });

  it("returns null when the const is missing or reshaped", () => {
    expect(extractKaminoLendProgramId("// nothing here")).to.equal(null);
    expect(
      extractKaminoLendProgramId(
        `pub const SOMETHING_ELSE: Pubkey = anchor_lang::pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");`,
      ),
    ).to.equal(null);
  });

  it("rejects an invalid base58 alphabet inside the macro string", () => {
    // '0', 'O', 'I', 'l' are NOT in the Solana base58 alphabet — the
    // regex character class excludes them, so a malformed value returns null
    // rather than silently passing through.
    const src = `pub const KAMINO_LEND_PROGRAM_ID: Pubkey = anchor_lang::pubkey!("0000000000000000000000000000000000000000000");`;
    expect(extractKaminoLendProgramId(src)).to.equal(null);
  });
});

describe("verifyKaminoPin — adapter source vs canonical expected", () => {
  it("PASSES against the current on-disk adapter source", () => {
    const verdict = verifyKaminoPin({ source: ADAPTER_SRC });
    expect(verdict.ok, `verdict: ${JSON.stringify(verdict)}`).to.equal(true);
    if (verdict.ok) {
      expect(verdict.pinned).to.equal(EXPECTED_KAMINO_LEND_PROGRAM_ID);
    }
  });

  it("reports `drift` when the pinned and expected diverge", () => {
    const verdict = verifyKaminoPin({
      source: ADAPTER_SRC,
      expected: "DriftAddress11111111111111111111111111111",
    });
    expect(verdict.ok).to.equal(false);
    if (!verdict.ok && verdict.reason === "drift") {
      expect(verdict.pinned).to.equal(EXPECTED_KAMINO_LEND_PROGRAM_ID);
      expect(verdict.expected).to.equal("DriftAddress11111111111111111111111111111");
    }
  });

  it("reports `extraction_failed` when the const cannot be parsed out", () => {
    const verdict = verifyKaminoPin({ source: "// no const here" });
    expect(verdict.ok).to.equal(false);
    if (!verdict.ok) expect(verdict.reason).to.equal("extraction_failed");
  });
});

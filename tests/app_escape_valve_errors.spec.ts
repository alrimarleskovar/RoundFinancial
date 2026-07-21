/**
 * classifyEscapeValveListError (app/src/lib/escape-valve-errors.ts) — maps a
 * failed escape_valve_list revert to the right user-facing i18n key.
 *
 * The load-bearing case: the listing gate reuses `RoundfiError::MemberNotBehind`,
 * whose on-chain #[msg] ("Member is current on contributions — default not
 * applicable") is the settle_default text and reads as the OPPOSITE of the
 * truth for a behind seller. So the classifier MUST key off the error NAME in
 * the logs, never the (misleading) distilled message — this spec pins that.
 */

import { strict as assert } from "node:assert";

import { classifyEscapeValveListError } from "../app/src/lib/escape-valve-errors";

// A realistic Anchor simulation-log blob for a MemberNotBehind revert — note
// the message says "current", which is why we must match the NAME, not the msg.
const behindBlob = [
  "Transaction simulation failed",
  "Program log: Instruction: EscapeValveList",
  "Program log: AnchorError occurred. Error Code: MemberNotBehind. Error Number: 6085. Error Message: Member is current on contributions — default not applicable.",
  "Program …core… failed: custom program error: 0x17c5",
].join("\n");

describe("classifyEscapeValveListError — escape_valve_list revert → i18n key", () => {
  it("maps the behind-seller gate to the CORRECT key despite the misleading msg", () => {
    assert.equal(classifyEscapeValveListError(behindBlob), "modal.sell.err.behind");
  });

  it("does NOT let the misleading 'is current' message leak through as the reason", () => {
    // The distilled Anchor message would say the seller is current — the whole
    // point is that our key overrides it. Assert we returned the key, not null
    // (null would make the modal fall back to the raw/ distilled text).
    assert.notEqual(classifyEscapeValveListError(behindBlob), null);
  });

  it("maps a zero-price revert", () => {
    assert.equal(
      classifyEscapeValveListError("Error Code: InvalidListingPrice. Error Number: 6093."),
      "modal.sell.err.price",
    );
  });

  it("maps a defaulted-member revert", () => {
    assert.equal(
      classifyEscapeValveListError("… Error Code: DefaultedMember …"),
      "modal.sell.err.defaulted",
    );
  });

  it("maps an inactive-pool revert", () => {
    assert.equal(
      classifyEscapeValveListError("Error Code: PoolNotActive."),
      "modal.sell.err.poolInactive",
    );
  });

  it("maps the commit-reveal-required revert", () => {
    assert.equal(
      classifyEscapeValveListError("Error Code: CommitRevealRequired."),
      "modal.sell.err.commitReveal",
    );
  });

  it("maps an 'already in use' init collision to already-listed", () => {
    assert.equal(
      classifyEscapeValveListError("Allocate: account Address { … } already in use"),
      "modal.sell.err.alreadyListed",
    );
  });

  it("returns null for an unrecognized revert (caller falls back to raw)", () => {
    assert.equal(classifyEscapeValveListError("some random RPC 429 rate limit"), null);
    assert.equal(classifyEscapeValveListError(""), null);
  });
});

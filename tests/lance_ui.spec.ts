/**
 * Lance embutido — front-end eligibility math (ADR 0012 Fase 2).
 *
 * `app/src/lib/lance.ts` decides whether the "Dar lance" panel appears,
 * what it promises, and whether the CTA fires. Every number it produces
 * must agree with the gates in
 * `programs/roundfi-core/src/instructions/place_embedded_bid.rs`:
 *
 *     depth = contributions_paid − current_cycle − 1     (≥ 1 required)
 *     depth > pool.current_bid_depth                     (STRICTLY)
 *     member's drawn cycle > current_cycle
 *     !paid_out, !defaulted, Active + Sorteio pool
 *
 * Drift here is worse than a cosmetic bug: the panel would promise a bid
 * the program rejects, and the user pays gas to learn it. The on-chain
 * side of the same matrix is pinned by `tests/litesvm_lance_embutido.spec.ts`
 * — this spec is its off-chain mirror, and runs with no validator.
 */

import { expect } from "chai";

import {
  classifyLanceError,
  freeBidPhase,
  freeBidView,
  lanceView,
  showsFreeBidPanel,
  showsLancePanel,
  type FreeBidInputs,
  type LanceInputs,
} from "../app/src/lib/lance";

/** A live 6-cycle sorteio pool at cycle 1; the member is drawn for cycle 4. */
function inputs(over: Partial<LanceInputs> = {}): LanceInputs {
  return {
    isSorteio: true,
    poolActive: true,
    currentCycle: 1,
    cyclesTotal: 6,
    currentBidDepth: 0,
    myDrawnCycle: 4,
    contributionsPaid: 2, // paid through cycle 1 ⇒ depth 0 (merely current)
    defaulted: false,
    paidOut: false,
    ...over,
  };
}

describe("lanceView — mirrors place_embedded_bid's gates", () => {
  // ─── The −1 in the depth metric ────────────────────────────────────

  it("a merely up-to-date member has depth 0 and needs 1 prepay", () => {
    // contributions_paid == current_cycle + 1 is the NORMAL paid-this-cycle
    // state. Counting it as bid material would hand the cycle to anyone
    // who simply paid on time — the bug the on-chain `−1` exists to stop.
    const v = lanceView(inputs());
    expect(v.depth).to.equal(0);
    expect(v.requiredDepth).to.equal(1);
    expect(v.prepaysNeeded).to.equal(1);
    expect(v.status).to.equal("needsPrepay");
  });

  it("one prepaid installment reaches depth 1 → ready on a fresh cycle", () => {
    const v = lanceView(inputs({ contributionsPaid: 3 }));
    expect(v.depth).to.equal(1);
    expect(v.prepaysNeeded).to.equal(0);
    expect(v.status).to.equal("ready");
  });

  it("a BEHIND member has depth 0 (saturating), never negative", () => {
    // contributions_paid < current_cycle: the on-chain `saturating_sub`
    // floors at 0, so the UI must not render a negative depth.
    const v = lanceView(inputs({ contributionsPaid: 0 }));
    expect(v.depth).to.equal(0);
    expect(v.status).to.equal("needsPrepay");
  });

  // ─── Strictly-greater competition ──────────────────────────────────

  it("matching the standing bid is NOT enough — ties lose", () => {
    // depth 2 vs current_bid_depth 2 → the program rejects with
    // EmbeddedBidTooShallow. The UI must ask for one more.
    const v = lanceView(inputs({ contributionsPaid: 4, currentBidDepth: 2 }));
    expect(v.depth).to.equal(2);
    expect(v.requiredDepth).to.equal(3);
    expect(v.prepaysNeeded).to.equal(1);
    expect(v.status).to.equal("needsPrepay");
  });

  it("beating the standing bid by one is enough", () => {
    const v = lanceView(inputs({ contributionsPaid: 5, currentBidDepth: 2 }));
    expect(v.depth).to.equal(3);
    expect(v.status).to.equal("ready");
  });

  it("requiredDepth is never below 1, even on a fresh cycle", () => {
    expect(lanceView(inputs({ currentBidDepth: 0 })).requiredDepth).to.equal(1);
  });

  // ─── Runway: prepaying everything left may still not be enough ─────

  it("outOfRunway when even every remaining installment can't beat the book", () => {
    // 6-cycle pool at cycle 4 → contributions_paid tops out at 6, so the
    // deepest reachable bid is 6 − 4 − 1 = 1. A standing depth of 1 needs
    // 2 — unreachable. Offering "antecipe mais" there would be a lie.
    const v = lanceView(
      inputs({ currentCycle: 4, myDrawnCycle: 5, contributionsPaid: 5, currentBidDepth: 1 }),
    );
    expect(v.maxDepth).to.equal(1);
    expect(v.requiredDepth).to.equal(2);
    expect(v.status).to.equal("outOfRunway");
  });

  it("stays actionable while the runway still covers the required depth", () => {
    const v = lanceView(inputs({ currentCycle: 3, contributionsPaid: 4, currentBidDepth: 0 }));
    expect(v.maxDepth).to.equal(2);
    expect(v.status).to.equal("needsPrepay");
  });

  // ─── Gates that hide the panel entirely ────────────────────────────

  it("arrival-order pools are notApplicable (no DrawResult can ever exist)", () => {
    expect(lanceView(inputs({ isSorteio: false, contributionsPaid: 5 })).status).to.equal(
      "notApplicable",
    );
  });

  it("a non-member is notApplicable", () => {
    expect(lanceView(inputs({ contributionsPaid: null })).status).to.equal("notApplicable");
  });

  it("a defaulted member is notApplicable", () => {
    expect(lanceView(inputs({ defaulted: true, contributionsPaid: 5 })).status).to.equal(
      "notApplicable",
    );
  });

  it("an inactive (forming/completed) pool is notApplicable", () => {
    expect(lanceView(inputs({ poolActive: false, contributionsPaid: 5 })).status).to.equal(
      "notApplicable",
    );
  });

  it("awaitingDraw while the DrawResult hasn't been minted", () => {
    // Fail-closed, same as every other sorteio surface: pre-draw there is
    // no order to swap and the account doesn't exist on chain.
    expect(lanceView(inputs({ myDrawnCycle: null, contributionsPaid: 5 })).status).to.equal(
      "awaitingDraw",
    );
  });

  it("a paid-out member is contemplated — the second-payout gate", () => {
    // paid_out is checked BEFORE the draw lookup on-chain; mirror that so a
    // member who already received never sees a bid affordance.
    expect(lanceView(inputs({ paidOut: true, contributionsPaid: 6 })).status).to.equal(
      "contemplated",
    );
  });

  it("holding the current cycle already is contemplated, not biddable", () => {
    const v = lanceView(inputs({ myDrawnCycle: 1, contributionsPaid: 5 }));
    expect(v.status).to.equal("contemplated");
  });

  it("a past drawn cycle is contemplated too (defensive — implies paid_out)", () => {
    expect(lanceView(inputs({ myDrawnCycle: 0, contributionsPaid: 5 })).status).to.equal(
      "contemplated",
    );
  });

  // ─── Panel visibility ──────────────────────────────────────────────

  it("showsLancePanel is true exactly for the three actionable states", () => {
    expect(showsLancePanel("ready")).to.equal(true);
    expect(showsLancePanel("needsPrepay")).to.equal(true);
    expect(showsLancePanel("outOfRunway")).to.equal(true);
    expect(showsLancePanel("notApplicable")).to.equal(false);
    expect(showsLancePanel("awaitingDraw")).to.equal(false);
    expect(showsLancePanel("contemplated")).to.equal(false);
  });

  it("always reports the target cycle it would win", () => {
    expect(lanceView(inputs({ currentCycle: 2, contributionsPaid: 4 })).targetCycle).to.equal(2);
  });
});

describe("classifyLanceError — reverts → honest copy", () => {
  it("maps EmbeddedBidTooShallow (someone outbid you mid-flight)", () => {
    expect(classifyLanceError("Error Code: EmbeddedBidTooShallow. Error Number: 6061.")).to.equal(
      "modal.lance.err.tooShallow",
    );
  });

  it("maps EmbeddedBidUnavailable", () => {
    expect(classifyLanceError("Error Code: EmbeddedBidUnavailable.")).to.equal(
      "modal.lance.err.unavailable",
    );
  });

  it("maps AccountNotInitialized to the no-draw explanation", () => {
    // The account layer rejects before any constraint runs, so an
    // undrawn (or arrival-order) pool surfaces THIS, not the policy error.
    expect(
      classifyLanceError("AnchorError caused by account: draw. AccountNotInitialized"),
    ).to.equal("modal.lance.err.noDraw");
  });

  it("maps the shared pool/member gates", () => {
    expect(classifyLanceError("Error Code: DefaultedMember.")).to.equal(
      "modal.lance.err.defaulted",
    );
    expect(classifyLanceError("Error Code: PoolNotActive.")).to.equal(
      "modal.lance.err.poolInactive",
    );
    expect(classifyLanceError("Error Code: ProtocolPaused.")).to.equal("modal.lance.err.paused");
  });

  it("returns null for an unrecognized revert (caller keeps its fallback)", () => {
    expect(classifyLanceError("blockhash not found")).to.equal(null);
  });
});

describe("freeBidPhase — the seal is temporal (ADR 0012 Fase 3)", () => {
  const DEADLINE = 1_000_000;
  const GRACE = 86_400;

  it("bidding is open strictly BEFORE the cycle deadline", () => {
    expect(freeBidPhase(DEADLINE - 1, DEADLINE, GRACE)).to.equal("bidding");
  });

  it("revealing opens exactly where bidding closes — no gap, no overlap", () => {
    // The disjunction IS the seal: if both were open at the same instant, a
    // bidder could read a revealed amount and then seal a winning reply.
    expect(freeBidPhase(DEADLINE, DEADLINE, GRACE)).to.equal("revealing");
  });

  it("revealing runs to the grace deadline settle_default waits for", () => {
    expect(freeBidPhase(DEADLINE + GRACE - 1, DEADLINE, GRACE)).to.equal("revealing");
    expect(freeBidPhase(DEADLINE + GRACE, DEADLINE, GRACE)).to.equal("closed");
  });
});

describe("freeBidView — sealed-envelope state machine", () => {
  const DEADLINE = 1_000_000;
  const GRACE = 86_400;

  function fb(over: Partial<FreeBidInputs> = {}): FreeBidInputs {
    return {
      ...inputs(),
      nowSec: DEADLINE - 100,
      nextCycleAt: DEADLINE,
      graceSecs: GRACE,
      hasEnvelope: false,
      envelopeRevealed: false,
      ...over,
    };
  }

  it("offers sealing while bidding is open", () => {
    const v = freeBidView(fb());
    expect(v.status).to.equal("canSeal");
    expect(v.phase).to.equal("bidding");
    expect(v.secondsLeft).to.equal(100);
  });

  it("a sealed envelope waits — it cannot be re-sealed", () => {
    // Re-sealing after a peek is what the commit exists to stop, and the
    // program enforces it via `init`. The UI must not offer it either.
    expect(freeBidView(fb({ hasEnvelope: true })).status).to.equal("sealed");
  });

  it("offers opening once the window flips", () => {
    const v = freeBidView(fb({ nowSec: DEADLINE + 10, hasEnvelope: true }));
    expect(v.status).to.equal("canReveal");
    expect(v.secondsLeft).to.equal(GRACE - 10);
  });

  it("says missedBidding — not canSeal — when the window flipped with no envelope", () => {
    // The honest state: they can no longer seal AND have nothing to open.
    expect(freeBidView(fb({ nowSec: DEADLINE + 10 })).status).to.equal("missedBidding");
  });

  it("an opened envelope is terminal for the cycle", () => {
    expect(
      freeBidView(fb({ nowSec: DEADLINE + 10, hasEnvelope: true, envelopeRevealed: true })).status,
    ).to.equal("revealed");
  });

  it("closes at the grace deadline", () => {
    expect(freeBidView(fb({ nowSec: DEADLINE + GRACE, hasEnvelope: true })).status).to.equal(
      "closed",
    );
  });

  it("bounds the bid by the runway AND by what's actually unpaid", () => {
    // 6-cycle pool at cycle 1, paid through 2: maxDepth = 6−1−1 = 4, but
    // only 4 installments remain unpaid. Offering 5 would build an amount
    // the program rejects with PoolClosed.
    const v = freeBidView(fb({ currentCycle: 1, cyclesTotal: 6, contributionsPaid: 2 }));
    expect(v.maxParcels).to.equal(4);
  });

  it("won't offer sealing with no runway left", () => {
    // Paid through the end: nothing left to bid with.
    expect(
      freeBidView(fb({ currentCycle: 1, cyclesTotal: 6, contributionsPaid: 6 })).status,
    ).to.equal("notApplicable");
  });

  it("inherits every eligibility gate from lanceView", () => {
    expect(freeBidView(fb({ isSorteio: false })).status).to.equal("notApplicable");
    expect(freeBidView(fb({ myDrawnCycle: null })).status).to.equal("awaitingDraw");
    expect(freeBidView(fb({ paidOut: true })).status).to.equal("contemplated");
    expect(freeBidView(fb({ defaulted: true })).status).to.equal("notApplicable");
  });

  it("showsFreeBidPanel is true exactly for the actionable states", () => {
    expect(showsFreeBidPanel("canSeal")).to.equal(true);
    expect(showsFreeBidPanel("sealed")).to.equal(true);
    expect(showsFreeBidPanel("canReveal")).to.equal(true);
    expect(showsFreeBidPanel("missedBidding")).to.equal(false);
    expect(showsFreeBidPanel("revealed")).to.equal(false);
    expect(showsFreeBidPanel("closed")).to.equal(false);
    expect(showsFreeBidPanel("notApplicable")).to.equal(false);
  });
});

describe("classifyLanceError — Fase 3 reverts", () => {
  it("maps the sealed-bid window and envelope errors", () => {
    expect(classifyLanceError("Error Code: BidWindowClosed.")).to.equal(
      "modal.lance.err.windowClosed",
    );
    expect(classifyLanceError("Error Code: BidCommitMismatch.")).to.equal(
      "modal.lance.err.commitMismatch",
    );
    expect(classifyLanceError("Error Code: BidAlreadyRevealed.")).to.equal(
      "modal.lance.err.alreadyRevealed",
    );
    expect(classifyLanceError("Error Code: BidAmountNotMultiple.")).to.equal(
      "modal.lance.err.notMultiple",
    );
  });

  it("maps the anti-reseal init collision to its own copy", () => {
    // A second commit for the same cycle is the guard working, not a bug.
    expect(classifyLanceError("Allocate: account Address { .. } already in use")).to.equal(
      "modal.lance.err.alreadySealed",
    );
  });
});

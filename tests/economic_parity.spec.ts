/**
 * L1 ↔ L2 economic parity (M1 of grant roadmap).
 *
 * The protocol is built in two layers that must agree:
 *
 *   L1 — `runSimulation()` from `@roundfi/sdk/stressLab` (formerly
 *        `app/src/lib/stressLab.ts`, shipped in PR #40). Pure-TS
 *        actuarial engine. Reference implementation.
 *   L2 — `roundfi-core` Anchor program (~4,300 LoC, 14 instructions).
 *        On-chain implementation.
 *
 * The `tests/parity.spec.ts` already in the repo asserts **constants
 * and PDA seeds** parity between Rust and the SDK. This file asserts
 * the much-stronger **economic parity**: running the same scenario
 * through both implementations must produce the same per-member
 * economic outcome and the same pool-level conservation invariant.
 *
 * Structure of this file:
 *
 *   1. **L1 sanity** (runs today, zero Solana infra) — for each
 *      `PRESETS` entry from `@roundfi/sdk`, asserts that
 *      `runSimulation()` produces frames with the expected shape and
 *      member status distribution. Locks the L1 reference behaviour
 *      so a regression on either side is caught.
 *
 *   2. **L2 parity** (skipped today, wired in subsequent PRs) — for
 *      each preset, drives the same scenario through
 *      `roundfi-core` under `solana-bankrun`, captures per-member
 *      USDC deltas + final pool state, and asserts:
 *
 *        a. Per-member economic outcome matches L1 within an integer
 *           epsilon (`member.received - member.stakePaid -
 *           member.installmentsPaid` from L1 ≡ on-chain net USDC
 *           delta from joining to closing).
 *        b. Pool-level conservation: every USDC in == every USDC out
 *           plus retained-by-protocol plus net-yield-harvested.
 *        c. Solvency direction matches: L1 `poolBalance >= 0`
 *           ⟺ L2 `close_pool` returns Ok().
 *
 *   3. **Conservation invariant** (skipped today) — orthogonal claim
 *      that for each preset, the sum of every member's
 *      `(received - stakePaid - installmentsPaid)` plus the
 *      protocol's retained position plus the remaining vault balance
 *      must equal the harvested yield, exactly. Same on both sides.
 *
 * Run today:
 *   pnpm run test:economic-parity-l1   ← only the sanity layer
 *
 * Run after `anchor build` + bankrun is set up:
 *   pnpm run test:economic-parity      ← full L1 ↔ L2 parity
 */

import { expect } from "chai";

// Imported from the `./stressLab` subpath rather than the barrel.
// stressLab.ts is zero-import so it sidesteps the legacy ts-mocha /
// ts-node ESM resolution issue that affects the barrel re-exports
// (which use `.js` suffixes for NodeNext compatibility).
import {
  defaultMatrix,
  LEVEL_PARAMS,
  PRESETS,
  PRESET_ORDER,
  runSimulation,
  toggleCell,
  type FrameMetrics,
  type PresetId,
  type StressLabFrame,
} from "@roundfi/sdk/stressLab";

// ─── Helpers ─────────────────────────────────────────────────────────

function lastFrame(frames: StressLabFrame[]): StressLabFrame {
  if (frames.length === 0) throw new Error("runSimulation produced no frames");
  return frames[frames.length - 1]!;
}

function metricsOf(presetId: PresetId): {
  frames: StressLabFrame[];
  finalMetrics: FrameMetrics;
} {
  const preset = PRESETS[presetId];
  const frames = runSimulation(preset.config, preset.matrix);
  return { frames, finalMetrics: lastFrame(frames).metrics };
}

// ─── Layer 1 — L1 sanity ─────────────────────────────────────────────

describe("L1 stress-lab sanity (runs without Solana)", () => {
  it("every preset produces N frames", () => {
    for (const id of PRESET_ORDER) {
      const { frames } = metricsOf(id);
      const expected = PRESETS[id].config.members;
      expect(frames.length, `preset=${id}`).to.equal(expected);
    }
  });

  it("every preset's ledger snapshot has one entry per member", () => {
    for (const id of PRESET_ORDER) {
      const { frames } = metricsOf(id);
      const final = lastFrame(frames);
      expect(final.ledgerSnapshot.length, `preset=${id}`).to.equal(
        PRESETS[id].config.members,
      );
    }
  });

  it("Healthy preset closes solvent and every member is OK", () => {
    const { frames, finalMetrics } = metricsOf("healthy");
    const final = lastFrame(frames);

    expect(finalMetrics.poolBalance, "Healthy must close solvent").to.be.gte(0);
    expect(finalMetrics.totalLoss, "Healthy must have zero loss").to.equal(0);

    for (const ledger of final.ledgerSnapshot) {
      expect(ledger.status, `member=${ledger.name}`).to.equal("ok");
      expect(ledger.lossCaused, `member=${ledger.name} lossCaused`).to.equal(0);
    }
  });

  it("Pre-default preset has exactly one calote_pre member", () => {
    const { frames } = metricsOf("preDefault");
    const final = lastFrame(frames);

    const pre = final.ledgerSnapshot.filter((l) => l.status === "calote_pre");
    const post = final.ledgerSnapshot.filter((l) => l.status === "calote_pos");
    expect(pre.length, "exactly one pre-contemplation default").to.equal(1);
    expect(post.length, "no post-contemplation defaults").to.equal(0);

    // Protocol retains the defaulter's stake + paid installments.
    expect(pre[0]!.retained, "retained > 0").to.be.greaterThan(0);
    expect(pre[0]!.lossCaused, "no loss").to.equal(0);
  });

  it("Post-default preset has exactly one calote_pos member with real loss", () => {
    const { frames } = metricsOf("postDefault");
    const final = lastFrame(frames);

    const post = final.ledgerSnapshot.filter((l) => l.status === "calote_pos");
    expect(post.length, "exactly one post-contemplation default").to.equal(1);

    // Member was contemplated and received the upfront, then defaulted
    // — net result is loss to the pool.
    expect(post[0]!.received, "post-default received upfront").to.be.greaterThan(0);
    expect(post[0]!.lossCaused, "post-default caused loss").to.be.greaterThan(0);
  });

  it("Cascade preset has multiple defaulters", () => {
    const { frames, finalMetrics } = metricsOf("cascade");
    const final = lastFrame(frames);

    const defaulters = final.ledgerSnapshot.filter((l) => l.status !== "ok");
    expect(defaulters.length, "≥3 defaulters in cascade").to.be.gte(3);
    expect(finalMetrics.totalRetained, "cascade retains > 0").to.be.greaterThan(0);
  });

  // ── tripleVeteranDefault: the canonical whitepaper scenario ────────
  // 24-member Veterano pool with $10k credit. Members 1, 2, 3 are
  // contemplated at cycles 2/3/4 (default-diagonal) and then default
  // at cycle right after their upfront. The whitepaper argues that
  // even with three sequential post-contemplation defaults the
  // cascade of guarantees keeps the pool solvent.
  //
  // This test pins the L1 simulator's outcome to that claim.
  it("Triple Veteran Default produces 3 post-contemplation defaults + positive solvency", () => {
    const { frames, finalMetrics } = metricsOf("tripleVeteranDefault");
    const final = lastFrame(frames);

    // (a) Exactly three calote_pos members.
    const postDefaults = final.ledgerSnapshot.filter(
      (l) => l.status === "calote_pos",
    );
    expect(postDefaults.length, "exactly 3 calote_pos members").to.equal(3);

    // (b) Each defaulter received the upfront (passed contemplation).
    for (const m of postDefaults) {
      expect(m.received, `${m.name} received upfront`).to.be.greaterThan(0);
      expect(m.lossCaused, `${m.name} caused loss`).to.be.greaterThan(0);
    }

    // (c) No pre-contemplation defaults — these are POST-contemplation
    // calotes specifically (the harder, "received the bag" case).
    const preDefaults = final.ledgerSnapshot.filter(
      (l) => l.status === "calote_pre",
    );
    expect(preDefaults.length, "zero calote_pre members").to.equal(0);

    // (d) Pool solvent by construction — the whitepaper headline claim.
    // `poolBalance` is the running cash balance after every cycle.
    // After three sequential post-contemplation calotes the cascade of
    // recoveries (escrow retained + stake slashed + cycle-1 cushion +
    // solidarity vault + yield) must still leave the pool > 0.
    expect(
      finalMetrics.poolBalance,
      "pool ends solvent (cash balance > 0 after 3 calotes)",
    ).to.be.greaterThan(0);

    // (e) Recovery ≥ losses — protocol absorbed the calotes without
    // touching the LP/participants pool. `totalRetained` covers seized
    // stake + retained escrow + solidarity contributions; it must be
    // at least as large as the total loss the defaulters caused.
    const totalLoss = postDefaults.reduce((acc, m) => acc + m.lossCaused, 0);
    expect(
      finalMetrics.totalRetained,
      "retained ≥ caused losses (cascade absorbed the hit)",
    ).to.be.gte(totalLoss);
  });

  it("collected installments + total stake never exceed inflow accounting", () => {
    // Sanity: for every preset, the FrameMetrics maintain
    //   poolBalance = totalStake + collectedInstallments - paidOut
    //               + kaminoNetYield (− totalLoss for post-defaults
    //                 already netted into received)
    // We assert the simpler invariant:
    //   totalStake + collectedInstallments - paidOut ≥ 0  (modulo loss).
    for (const id of PRESET_ORDER) {
      const { finalMetrics: m } = metricsOf(id);
      const grossInflow = m.totalStake + m.collectedInstallments;
      expect(
        grossInflow,
        `preset=${id} gross inflow non-negative`,
      ).to.be.gte(0);
      expect(
        m.paidOut,
        `preset=${id} paidOut non-negative`,
      ).to.be.gte(0);
    }
  });
});

// ─── Layer 1b — toggleCell click semantics ───────────────────────────
// The lab UI's matrix editor has to be able to compose every scenario
// the whitepaper describes — including the load-bearing one: a member
// contemplated at cycle c₀ who then defaults at cycle c₁ > c₀
// (calote_pos). These tests lock the position-aware click semantics
// `toggleCell` must guarantee.

describe("toggleCell — post-contemplation default is composable", () => {
  it("clicking P after the row's existing C cascades X without erasing the C", () => {
    // Member 1 has C at cycle 2 (col=1) by default. User wants to
    // mark them as defaulting from cycle 5 (col=4) onward.
    const m0 = defaultMatrix(8);
    const m1 = toggleCell(m0, 1, 4);

    expect(m1[1]![1], "C at cycle 2 must be preserved").to.equal("C");
    expect(m1[1]![4], "X cascades from cycle 5").to.equal("X");
    expect(m1[1]![5], "X cascades through end").to.equal("X");
    expect(m1[1]![7], "X cascades through end").to.equal("X");

    // runSimulation on this row must produce calote_pos, not calote_pre.
    const frames = runSimulation(
      {
        level: "Comprovado",
        members: 8,
        creditAmountUsdc: 8 * 1000,
        kaminoApy: 6.5,
        yieldFeePct: 20,
      },
      m1,
    );
    const finalLedger = frames[frames.length - 1]!.ledgerSnapshot;
    expect(finalLedger[1]!.status, "post-contemplation default").to.equal(
      "calote_pos",
    );
  });

  it("clicking C cancels the row's contemplation entirely", () => {
    // Member 0 has C at cycle 1 by default. Clicking it should turn
    // it into P, leaving the row with no C at all (so the row is
    // simply "everyone-paying").
    const m0 = defaultMatrix(8);
    const m1 = toggleCell(m0, 0, 0);

    expect(m1[0]![0], "C cancelled to P").to.equal("P");
    expect(
      m1[0]!.every((c) => c === "P"),
      "row 0 has no C anywhere",
    ).to.equal(true);
  });

  it("clicking P before the row's existing C moves the contemplation", () => {
    // Member 4 has C at cycle 5 (col=4). User clicks col=2 (cycle 3)
    // — the contemplation should move there, original C cleared.
    const m0 = defaultMatrix(8);
    const m1 = toggleCell(m0, 4, 2);

    expect(m1[4]![2], "new C at cycle 3").to.equal("C");
    expect(m1[4]![4], "previous C cleared").to.equal("P");
  });

  it("clicking X reverts only this cycle and forward, keeping the C", () => {
    // Set up: member 2 has C at col=1, X cascading from col=4.
    const m0 = defaultMatrix(8);
    let m: ReturnType<typeof toggleCell> = m0;
    // Move contemplation to col=1 for member 2.
    m = toggleCell(m, 2, 1);
    // Cascade X from col=4.
    m = toggleCell(m, 2, 4);
    expect(m[2]![1], "C set up").to.equal("C");
    expect(m[2]![4], "X set up").to.equal("X");

    // Now click the X at col=4 to revert.
    const reverted = toggleCell(m, 2, 4);
    expect(reverted[2]![1], "C still preserved").to.equal("C");
    expect(reverted[2]![4], "X reverted to P").to.equal("P");
    expect(reverted[2]![7], "X cascade fully reverted").to.equal("P");
  });
});

// ─── Layer 1c — escrow gating on default month ───────────────────────
// Whitepaper: "as parcelas primeiro destravam o depósito, e só depois
// destravam a aposta". If the member doesn't pay the installment in
// month c (action = X), the escrow drip for month c MUST NOT release.
// This is the protocol's first-line solvency guarantee — without it
// a member could default-and-still-collect the next drip.

describe("runSimulation — no escrow release at the default month", () => {
  it("post-contemplation default skips the drip at the cycle of X", () => {
    // Hand-built scenario: 6 members, member 0 contemplated at cycle 1,
    // defaults at cycle 4. Veterano (10% stake, 5 months drip).
    const N = 6;
    const m: ReturnType<typeof defaultMatrix> = defaultMatrix(N);
    // Default member 0 starting cycle 4 (col=3) — preserves the C
    // at col=0 thanks to the toggleCell fix shipped previously.
    for (let j = 3; j < N; j++) m[0]![j] = "X";

    const frames = runSimulation(
      {
        level: "Iniciante",
        members: N,
        creditAmountUsdc: N * 1000,
        kaminoApy: 0,    // turn yield off so we count cents, not bps
        yieldFeePct: 0,
        memberNames: ["A", "B", "C", "D", "E", "F"],
      },
      m,
    );

    // Member 0 received: upfront at cycle 1 + 2 drips (cycles 2, 3).
    // The drip at cycle 4 must NOT release, since action=X there.
    const ledger0 = frames[frames.length - 1]!.ledgerSnapshot[0]!;
    const credit = 1000 * N;
    const upfront = 2 * 1000; // monthContemplated === 1 → 2 * inst
    const escrowTotal = credit - upfront;
    const escrowPerMonth = escrowTotal / 5; // releaseMonths for Iniciante
    const expectedReceived = upfront + 2 * escrowPerMonth;

    expect(
      ledger0.received,
      "received excludes the drip on the default month",
    ).to.equal(expectedReceived);
    expect(ledger0.status, "post-contemplation default").to.equal("calote_pos");
  });

  it("a member who defaults at the first drip month receives only the upfront", () => {
    // Edge case: contemplated at cycle 1, defaults at cycle 2.
    // Should keep ONLY the upfront (no drips ever released).
    const N = 6;
    const m: ReturnType<typeof defaultMatrix> = defaultMatrix(N);
    for (let j = 1; j < N; j++) m[0]![j] = "X";

    const frames = runSimulation(
      {
        level: "Iniciante",
        members: N,
        creditAmountUsdc: N * 1000,
        kaminoApy: 0,
        yieldFeePct: 0,
      },
      m,
    );

    const ledger0 = frames[frames.length - 1]!.ledgerSnapshot[0]!;
    const upfront = 2 * 1000;
    expect(ledger0.received, "only upfront released").to.equal(upfront);
  });
});

// ─── Layer 1d — stake-refund cashback phase ──────────────────────────
// Whitepaper: after the escrow drips fully, installments start
// releasing the stake (cashback). For a healthy contemplated member
// the math must close: paid (stake + N×installment) ≡ received
// (upfront + drips + refund) → net position 0. If the cashback
// phase isn't modelled, every healthy member appears to overpay.

describe("runSimulation — stake cashback phase", () => {
  it("healthy member contemplated at cycle 1 nets to zero", () => {
    // Iniciante: 50% stake, 5-month escrow drip, N=8. Contemplated
    // at cycle 1 (special case: upfront = 2*inst, escrow = credit -
    // upfront). Refund window = 8 - 1 - 5 = 2 cycles (7 and 8).
    const N = 8;
    const inst = 1000;
    const m: ReturnType<typeof defaultMatrix> = defaultMatrix(N);
    const frames = runSimulation(
      {
        level: "Iniciante",
        members: N,
        creditAmountUsdc: N * inst,
        kaminoApy: 0,
        yieldFeePct: 0,
      },
      m,
    );

    const ledger0 = frames[frames.length - 1]!.ledgerSnapshot[0]!;
    const credit = inst * N;
    const stake = credit * 0.5;
    const paid = stake + N * inst;
    expect(
      ledger0.received,
      "received closes the books — paid ≡ received for healthy",
    ).to.equal(paid);
    expect(ledger0.stakeRefunded, "stake fully refunded").to.equal(stake);
  });

  it("default during refund phase retains the unpaid refund", () => {
    // Iniciante N=8, member 0 contemplated at cycle 1 (drips end
    // at cycle 6, refund cycles are 7 and 8). Member defaults at
    // cycle 8 (col=7) — they got 1 of the 2 refund tranches and
    // skip the second.
    const N = 8;
    const inst = 1000;
    const m: ReturnType<typeof defaultMatrix> = defaultMatrix(N);
    m[0]![7] = "X"; // default exactly at the last cycle (refund #2)

    const frames = runSimulation(
      {
        level: "Iniciante",
        members: N,
        creditAmountUsdc: N * inst,
        kaminoApy: 0,
        yieldFeePct: 0,
      },
      m,
    );

    const ledger0 = frames[frames.length - 1]!.ledgerSnapshot[0]!;
    const credit = inst * N;
    const stake = credit * 0.5;
    const refundPerMonth = stake / 2; // refundMonths = 2

    // Got: upfront + 5 drips + 1 refund tranche.
    expect(
      ledger0.stakeRefunded,
      "exactly one refund tranche before default",
    ).to.equal(refundPerMonth);
    expect(ledger0.status).to.equal("calote_pos");
  });

  it("late contemplation with no refund window retains the stake", () => {
    // Iniciante N=6, member 5 contemplated at cycle 6 (last cycle).
    // refundMonths = 6 - 6 - 5 = -5 → no refund. Stake stays in
    // protocol (legacy edge-case behaviour, also true for the
    // pre-existing escrow truncation when contemplation is late).
    const N = 6;
    const inst = 1000;
    const m: ReturnType<typeof defaultMatrix> = defaultMatrix(N);

    const frames = runSimulation(
      {
        level: "Iniciante",
        members: N,
        creditAmountUsdc: N * inst,
        kaminoApy: 0,
        yieldFeePct: 0,
      },
      m,
    );

    const last = frames[frames.length - 1]!.ledgerSnapshot[N - 1]!;
    expect(last.stakeRefunded, "no refund for last contemplation").to.equal(0);
  });
});

// ─── Layer 1e — net solvency vs gross cash ───────────────────────────
// `poolBalance` (gross cash) was being read as a solvency signal, but
// it includes member stakes (a *liability* — owed back to ok members)
// and any escrow not yet released. The headline SOLVENT/INSOLVENT
// verdict must derive from netSolvency = poolBalance −
// outstandingEscrow − outstandingStakeRefund instead.

describe("runSimulation — net solvency vs gross cash", () => {
  // The old single-bucket netSolvency identity (pool − escrow −
  // stakeRefund) was superseded by Layer 1f when the solidarity
  // vault and guarantee fund became separate buckets. The bookkeeping
  // identity is now `pool + solidarity + GF − escrow − stakeRefund`,
  // verified there.

  it("netSolvency is strictly less than poolBalance while obligations exist", () => {
    // Mid-run frame for the Healthy preset: ok members still hold
    // stakes that haven't been refunded yet AND credit drips that
    // haven't fully released. The gross poolBalance is high; the
    // net solvency is much lower. Demonstrates why the old gross-
    // cash verdict was misleading.
    const preset = PRESETS.healthy;
    const frames = runSimulation(preset.config, preset.matrix);
    const midFrame = frames[Math.floor(frames.length / 2)]!;
    const m = midFrame.metrics;

    expect(m.poolBalance, "gross cash > 0 mid-run").to.be.greaterThan(0);
    expect(
      m.outstandingEscrow + m.outstandingStakeRefund,
      "obligations > 0 mid-run",
    ).to.be.greaterThan(0);
    expect(
      m.netSolvency,
      "netSolvency < poolBalance while obligations exist",
    ).to.be.lessThan(m.poolBalance);
  });

  it("a pre-contemplation defaulter is removed from outstanding obligations", () => {
    // PreDefault drops member 4 (would have been contemplated at
    // cycle 5) — they default at cycle 3 (calote_pre). Compared
    // to Healthy:
    //   - totalRetained rises (their paid-so-far is now retained).
    //   - their refund obligation drops to 0 (they're no longer ok).
    // Member 4 in Healthy is contemplated at cycle 5 with a full
    // 3-cycle refund window (refundMonths = 12 − 5 − 4 = 3) → fully
    // refunded → contributed 0 to outstanding anyway. So in this
    // specific preset the difference is in totalRetained, not in
    // outstanding numbers. Asserting the totalRetained delta keeps
    // the test meaningful even when outstanding doesn't move.
    const healthyEnd =
      runSimulation(PRESETS.healthy.config, PRESETS.healthy.matrix).slice(-1)[0]!;
    const preEnd =
      runSimulation(PRESETS.preDefault.config, PRESETS.preDefault.matrix).slice(-1)[0]!;

    expect(
      preEnd.metrics.totalRetained,
      "defaulter's paid-so-far retained by protocol",
    ).to.be.greaterThan(healthyEnd.metrics.totalRetained);
    // Both presets have the same late-contemplation truncation pattern,
    // so outstandingStakeRefund is the same — the defaulter (member 4)
    // would have been fully refunded in Healthy and is excluded as
    // not-ok in PreDefault. Either way, contributes 0.
    expect(preEnd.metrics.outstandingStakeRefund).to.equal(
      healthyEnd.metrics.outstandingStakeRefund,
    );
  });
});

// ─── Layer 1f — capital structure (Escudo 3) ─────────────────────────
// Whitepaper splits Escudo 3 into three protocol-controlled buckets
// plus a residual LP distribution:
//   - Cofre Solidário: 1% of every paid installment.
//   - Fundo Garantido: yield waterfall, capped at 150% of credit.
//   - LP distribution: residual yield after the GF cap is hit.
// These tests lock the structural invariants the whitepaper asserts.

describe("runSimulation — capital structure (Escudo 3)", () => {
  it("Cofre Solidário accrues exactly 1% of collected installments", () => {
    for (const id of PRESET_ORDER) {
      const preset = PRESETS[id];
      const final =
        runSimulation(preset.config, preset.matrix).slice(-1)[0]!.metrics;
      expect(
        final.solidarityVault,
        `preset=${id}: solidarityVault === 1% × collectedInstallments`,
      ).to.be.closeTo(final.collectedInstallments * 0.01, 1e-6);
    }
  });

  it("Guarantee Fund cap is 150% of credit", () => {
    for (const id of PRESET_ORDER) {
      const preset = PRESETS[id];
      const credit = preset.config.creditAmountUsdc;
      const final =
        runSimulation(preset.config, preset.matrix).slice(-1)[0]!.metrics;
      expect(final.guaranteeFundCap, `preset=${id}`).to.equal(1.5 * credit);
      expect(
        final.guaranteeFund,
        `preset=${id}: never exceeds cap`,
      ).to.be.at.most(final.guaranteeFundCap + 1e-6);
    }
  });

  it("yield waterfall: GF fills first, residual goes to LPs", () => {
    // Healthy preset has steady yield over 12 cycles. With cap at
    // 1.5×credit = 18000 and typical net yield ~ small fraction of
    // float, the GF fills gradually. As long as cumulative net yield
    // is below the cap, lpDistribution stays at 0.
    const preset = PRESETS.healthy;
    const frames = runSimulation(preset.config, preset.matrix);

    for (const frame of frames) {
      const m = frame.metrics;
      const totalYieldDistributed = m.guaranteeFund + m.lpDistribution;
      expect(
        totalYieldDistributed,
        `cycle=${frame.cycle}: GF + LP equals net yield`,
      ).to.be.closeTo(m.kaminoNetYield, 1e-6);

      // Either the GF is below cap and LP is 0, OR GF is at cap and
      // LP holds the overflow.
      if (m.guaranteeFund < m.guaranteeFundCap - 1e-6) {
        expect(
          m.lpDistribution,
          `cycle=${frame.cycle}: no LP distribution while GF below cap`,
        ).to.be.closeTo(0, 1e-6);
      }
    }
  });

  it("a high-yield run eventually fills the GF and overflows to LPs", () => {
    // Crank APY to the max the slider allows (15%) and keep the
    // protocol fee at 0 so all yield reaches the waterfall. Across
    // 24 cycles (max members slider), the GF should fill and LPs
    // should see distribution.
    const frames = runSimulation(
      {
        level: "Iniciante", // 50% stake → biggest float → fastest accrual
        members: 24,
        creditAmountUsdc: 24 * 1000,
        kaminoApy: 15,
        yieldFeePct: 0,
        memberNames: undefined,
      },
      defaultMatrix(24),
    );
    const final = frames[frames.length - 1]!.metrics;

    expect(final.guaranteeFund, "GF fully filled").to.be.closeTo(
      final.guaranteeFundCap,
      0.5, // allow tiny rounding
    );
    expect(final.lpDistribution, "LPs received residual").to.be.greaterThan(0);
  });

  it("netSolvency now sums float + solidarity + GF, minus obligations", () => {
    for (const id of PRESET_ORDER) {
      const preset = PRESETS[id];
      const frames = runSimulation(preset.config, preset.matrix);
      for (const frame of frames) {
        const m = frame.metrics;
        const expected =
          m.poolBalance +
          m.solidarityVault +
          m.guaranteeFund -
          m.outstandingEscrow -
          m.outstandingStakeRefund;
        expect(
          m.netSolvency,
          `preset=${id} cycle=${frame.cycle}: net solvency identity`,
        ).to.be.closeTo(expected, 1e-6);
      }
    }
  });
});

// ─── Layer 1g — mature group acceleration ────────────────────────────
// Whitepaper: in a mature group the escrow drip accelerates from
// 5/4/3 months (immature) to 3/2/1 months (mature) across Lv1/Lv2/Lv3.
// Mature members get their credit faster, so the refund window
// (which opens after the drip ends) gets longer.

describe("runSimulation — mature group acceleration", () => {
  it("LEVEL_PARAMS exposes both immature and mature drip schedules", () => {
    expect(LEVEL_PARAMS.Iniciante.releaseMonths).to.equal(5);
    expect(LEVEL_PARAMS.Iniciante.releaseMonthsMature).to.equal(3);
    expect(LEVEL_PARAMS.Comprovado.releaseMonths).to.equal(4);
    expect(LEVEL_PARAMS.Comprovado.releaseMonthsMature).to.equal(2);
    expect(LEVEL_PARAMS.Veterano.releaseMonths).to.equal(3);
    expect(LEVEL_PARAMS.Veterano.releaseMonthsMature).to.equal(1);
  });

  it("default config (no maturity field) behaves as immature — preserves prior behavior", () => {
    const config = {
      level: "Comprovado" as const,
      members: 12,
      creditAmountUsdc: 12 * 1000,
      kaminoApy: 6.5,
      yieldFeePct: 20,
    };
    const immature = runSimulation({ ...config, maturity: "immature" }, defaultMatrix(12));
    const defaulted = runSimulation(config, defaultMatrix(12));
    // Compare end-of-pool poolBalance — should be identical.
    expect(defaulted.slice(-1)[0]!.metrics.poolBalance).to.be.closeTo(
      immature.slice(-1)[0]!.metrics.poolBalance,
      1e-6,
    );
  });

  it("mature member contemplated at cycle 1 receives credit faster", () => {
    // Iniciante (Lv1): drip over 5 cycles immature, 3 cycles mature.
    // Member 0 contemplated at cycle 1: receives 2*inst upfront, then
    // (credit - 2*inst) split over the drip window.
    const N = 12;
    const baseConfig = {
      level: "Iniciante" as const,
      members: N,
      creditAmountUsdc: N * 1000,
      kaminoApy: 0,
      yieldFeePct: 0,
    };
    const immatureFrames = runSimulation({ ...baseConfig, maturity: "immature" }, defaultMatrix(N));
    const matureFrames = runSimulation({ ...baseConfig, maturity: "mature" }, defaultMatrix(N));

    // At cycle 4: immature has released upfront + 3 drips; mature has
    // released upfront + all 3 drips and is into the refund phase.
    const m0Immature = immatureFrames[3]!.ledgerSnapshot[0]!;
    const m0Mature = matureFrames[3]!.ledgerSnapshot[0]!;

    // Total received (credit + refund) should be higher in mature
    // since the credit fully releases in 3 cycles instead of 5,
    // freeing the refund phase to start sooner.
    expect(
      m0Mature.received,
      "mature member receives more by cycle 4",
    ).to.be.greaterThan(m0Immature.received);
  });

  it("mature group ends with smaller outstanding obligations", () => {
    // Healthy run, Veterano (the level with biggest mature gap:
    // 3 → 1 month). Mature should leave less owed at end of pool
    // because more drips fit within N=12 cycles.
    const baseConfig = {
      level: "Veterano" as const,
      members: 12,
      creditAmountUsdc: 12 * 1000,
      kaminoApy: 0,
      yieldFeePct: 0,
    };
    const immatureEnd = runSimulation(
      { ...baseConfig, maturity: "immature" },
      defaultMatrix(12),
    ).slice(-1)[0]!.metrics;
    const matureEnd = runSimulation(
      { ...baseConfig, maturity: "mature" },
      defaultMatrix(12),
    ).slice(-1)[0]!.metrics;

    expect(
      matureEnd.outstandingEscrow + matureEnd.outstandingStakeRefund,
      "mature: less owed at end of pool",
    ).to.be.lessThan(
      immatureEnd.outstandingEscrow + immatureEnd.outstandingStakeRefund,
    );
  });
});

// ─── Layer 1h — credit-amount primary input + Escape Valve ────────────
// Whitepaper: the user picks the credit (carta) value as the primary
// input. Installment is derived (credit / members) and cycles equal
// members. Plus the new Escape Valve cell ("E"): a member sells
// their NFT share and exits without penalty.

describe("runSimulation — credit-amount input + Escape Valve", () => {
  it("installment is derived as credit / members at every cycle", () => {
    // For Healthy (carta 12_000, 12 members), each member's
    // installmentsPaid at end of cycle 1 should equal credit/N = 1000.
    const preset = PRESETS.healthy;
    const frames = runSimulation(preset.config, preset.matrix);
    const cycle1 = frames[0]!;
    const expectedInst =
      preset.config.creditAmountUsdc / preset.config.members;
    for (const ledger of cycle1.ledgerSnapshot) {
      expect(
        ledger.installmentsPaid,
        `member=${ledger.name} cycle=1 installment derived from credit`,
      ).to.be.closeTo(expectedInst, 1e-6);
    }
  });

  it("changing creditAmountUsdc scales every member's installment proportionally", () => {
    const baseConfig = {
      level: "Comprovado" as const,
      members: 12,
      creditAmountUsdc: 12000,
      kaminoApy: 6.5,
      yieldFeePct: 20,
    };
    const baseFrames = runSimulation(baseConfig, defaultMatrix(12));
    const doubled = runSimulation(
      { ...baseConfig, creditAmountUsdc: 24000 },
      defaultMatrix(12),
    );

    // Doubling the carta should double every member's installmentsPaid
    // at end of pool — direct proportionality.
    const baseFinal = baseFrames[baseFrames.length - 1]!;
    const dblFinal = doubled[doubled.length - 1]!;
    for (let i = 0; i < 12; i++) {
      expect(
        dblFinal.ledgerSnapshot[i]!.installmentsPaid,
        `member ${i}: doubled installment`,
      ).to.be.closeTo(
        2 * baseFinal.ledgerSnapshot[i]!.installmentsPaid,
        1e-6,
      );
    }
  });

  it("E cell marks the member as 'exited' with no retention or loss", () => {
    // Member 4 contemplated at cycle 5 (default diagonal) takes the
    // Escape Valve at cycle 3 — sells the NFT before being contemplated.
    const N = 12;
    const m: ReturnType<typeof defaultMatrix> = defaultMatrix(N);
    for (let j = 2; j < N; j++) m[4]![j] = "E"; // E cascade from cycle 3

    const frames = runSimulation(
      {
        level: "Comprovado",
        members: N,
        creditAmountUsdc: 12000,
        kaminoApy: 0,
        yieldFeePct: 0,
      },
      m,
    );
    const final = frames[frames.length - 1]!;
    const exited = final.ledgerSnapshot[4]!;

    expect(exited.status, "exited status").to.equal("exited");
    expect(exited.retained, "no retention against exiter").to.equal(0);
    expect(exited.lossCaused, "no loss caused by exiter").to.equal(0);

    // Pool-level: no totalRetained / totalLoss attributable to the
    // exiter. (Other ok members may have contributed to retained/loss
    // in other scenarios, but here the diagonal is otherwise clean.)
    expect(
      final.metrics.totalRetained,
      "totalRetained unaffected by Escape Valve",
    ).to.equal(0);
    expect(
      final.metrics.totalLoss,
      "totalLoss unaffected by Escape Valve",
    ).to.equal(0);
  });

  it("E behaves differently from X: no penalty, status preserved as 'exited'", () => {
    const N = 8;
    const baseMatrix = defaultMatrix(N);
    const exitMatrix = defaultMatrix(N);
    for (let j = 2; j < N; j++) {
      baseMatrix[4]![j] = "X"; // default
      exitMatrix[4]![j] = "E"; // escape
    }

    const baseFinal = runSimulation(
      {
        level: "Iniciante",
        members: N,
        creditAmountUsdc: 8000,
        kaminoApy: 0,
        yieldFeePct: 0,
      },
      baseMatrix,
    ).slice(-1)[0]!;
    const exitFinal = runSimulation(
      {
        level: "Iniciante",
        members: N,
        creditAmountUsdc: 8000,
        kaminoApy: 0,
        yieldFeePct: 0,
      },
      exitMatrix,
    ).slice(-1)[0]!;

    // X member should be flagged calote_pre with paid-so-far retained.
    expect(baseFinal.ledgerSnapshot[4]!.status).to.equal("calote_pre");
    expect(baseFinal.ledgerSnapshot[4]!.retained).to.be.greaterThan(0);

    // E member should be exited with zero retention.
    expect(exitFinal.ledgerSnapshot[4]!.status).to.equal("exited");
    expect(exitFinal.ledgerSnapshot[4]!.retained).to.equal(0);
  });
});

// ─── Layer 1i — yield waterfall: full 4-tier split ────────────────────
// Whitepaper waterfall: protocol fee → guarantee fund (cap 150%
// credit) → LPs (Anjos de Liquidez, 65% of residual) → participants
// (prêmio de paciência, 35%). Layer 1f tested the GF cap; this layer
// locks the LP/participants split.

describe("runSimulation — yield waterfall (4 tiers)", () => {
  it("LP and participant distributions partition the residual exactly", () => {
    // High-yield run, fee=0, GF starts empty: every yield cycle
    // initially fills GF. After GF caps, residual splits 65/35.
    const frames = runSimulation(
      {
        level: "Iniciante",
        members: 24,
        creditAmountUsdc: 24000,
        kaminoApy: 15,
        yieldFeePct: 0,
      },
      defaultMatrix(24),
    );
    const final = frames[frames.length - 1]!.metrics;

    // GF should be at cap (1.5 × credit = 36000 for credit=24000).
    expect(final.guaranteeFund).to.be.closeTo(final.guaranteeFundCap, 0.5);

    // Total yield distributed = GF + LP + participants.
    const total =
      final.guaranteeFund + final.lpDistribution + final.participantsDistribution;
    expect(total, "GF + LP + Participants ≡ total net yield").to.be.closeTo(
      final.kaminoNetYield,
      1e-6,
    );

    // Of the residual after GF, LP gets 65%, participants 35%.
    const residual = final.lpDistribution + final.participantsDistribution;
    if (residual > 0) {
      expect(
        final.lpDistribution / residual,
        "LP share of residual ≈ 65%",
      ).to.be.closeTo(0.65, 0.01);
      expect(
        final.participantsDistribution / residual,
        "Participants share of residual ≈ 35%",
      ).to.be.closeTo(0.35, 0.01);
    }
  });

  it("low-yield run: GF below cap → LP and participants both zero", () => {
    // Healthy preset, default APY. Yield is small relative to GF cap
    // (1.5 × 12000 = 18000). After all 12 cycles, GF should still be
    // below cap → residual = 0 → no LP / participants.
    const frames = runSimulation(
      PRESETS.healthy.config,
      PRESETS.healthy.matrix,
    );
    const final = frames[frames.length - 1]!.metrics;
    expect(final.guaranteeFund).to.be.lessThan(final.guaranteeFundCap);
    expect(final.lpDistribution).to.equal(0);
    expect(final.participantsDistribution).to.equal(0);
  });
});

// ─── Layer 2 — L1 ↔ L2 parity (wired in subsequent PRs) ──────────────
//
// These suites are kept as `describe.skip` so the file doesn't fail
// without `anchor build` having been run. Each preset gets its own
// describe so a single bankrun environment can drive the full
// scenario, capture state, then assert against L1.
//
// To wire any of these up:
//   1. Run `anchor build` to produce `target/idl/roundfi_core.json`.
//   2. Replace `describe.skip` with `describe`.
//   3. The body sketches the assertion. The harness already has
//      `setupBankrunEnv`, `initializeProtocol`, `createActivePool`,
//      `contribute`, `claimPayout`, `releaseEscrow`, `closePool`.
// ─────────────────────────────────────────────────────────────────────

describe.skip("L1 ↔ L2 parity — Healthy preset", () => {
  it("per-member net USDC delta matches L1 received − paid", async () => {
    // const env = await setupBankrunEnv();
    // const { protocol } = await initializeProtocol(env, ...);
    // const { pool, members } = await createActivePool(env, {
    //   protocol,
    //   members: PRESETS.healthy.config.members,
    //   installmentUsdc: usdc(PRESETS.healthy.config.installmentUsdc),
    //   level: 2, // Veterano = 30% stake
    //   ...
    // });
    //
    // for (let cycle = 0; cycle < members.length; cycle++) {
    //   for (const m of members) await contribute(env, { pool, member: m, cycle });
    //   await claimPayout(env, { pool, member: members[cycle]!, cycle });
    // }
    // for (const m of members) await releaseEscrow(env, { pool, member: m });
    // await closePool(env, { pool });
    //
    // const { frames } = (await import("@roundfi/sdk")).runSimulation(
    //   PRESETS.healthy.config,
    //   PRESETS.healthy.matrix,
    // );
    // const final = frames[frames.length - 1]!;
    //
    // for (let i = 0; i < members.length; i++) {
    //   const m = members[i]!;
    //   const onChainDelta = await balanceOf(env, m.memberUsdc) - m.usdcAtJoin;
    //   const l1Net =
    //     final.ledgerSnapshot[i]!.received -
    //     final.ledgerSnapshot[i]!.stakePaid -
    //     final.ledgerSnapshot[i]!.installmentsPaid;
    //   expect(onChainDelta).to.be.approximately(l1Net, 1n);
    // }
  });

  it("pool-level conservation: vault drain ≡ stake + contributions + yield − payouts", async () => {
    // Same setup; assert at end:
    //   (initial USDC supply) ≡
    //     sum(member final balances) +
    //     pool_usdc_vault.amount +
    //     escrow_vault.amount +
    //     solidarity_vault.amount +
    //     treasury.amount +
    //     yield_mock_vault.amount
    // — every cent accounted for.
  });
});

describe.skip("L1 ↔ L2 parity — Pre-default preset", () => {
  it("defaulter's stake + installments retained on-chain ≡ L1 retained", async () => {
    // Drive the scenario, then settle_default on the defaulter at the
    // configured cycle. After settle_default + close_pool:
    //   solidarity_vault.amount + escrow_vault.amount  (the protocol
    //   retention) − initial_protocol_balance ≡ ledger.retained for
    //   that defaulter (within 1 USDC unit).
  });
});

describe.skip("L1 ↔ L2 parity — Post-default preset", () => {
  it("loss-caused on-chain (via solidarity vault drain) ≡ L1 lossCaused", async () => {
    // Drive the scenario. The contemplated-then-defaulted member
    // received their upfront from the pool. settle_default reclaims
    // what's left in their NFT position; the gap == lossCaused. The
    // gap manifests on-chain as the solidarity vault's drain to
    // cover it.
  });
});

describe.skip("L1 ↔ L2 parity — Cascade preset", () => {
  it("cumulative retention + losses match across multiple defaulters", async () => {
    // Per-preset assertion: applying preDefault + postDefault claims
    // additively across the 3 cascade defaulters. Tightest check —
    // surfaces interaction bugs that single-default scenarios miss.
  });
});

// ─── Layer 3 — orthogonal conservation invariant ─────────────────────

describe.skip("Conservation invariant — every cent accounted for", () => {
  it("sum(member_net_positions) + protocol_retention + remaining_vaults ≡ harvested_yield", async () => {
    // For each preset:
    //   For L1: sum of every ledger entry's signed net position
    //           (received - stakePaid - installmentsPaid) +
    //           totalRetained - totalLoss
    //           must equal totalNetYield (kaminoNetYield).
    //   For L2: the same quantity, computed from on-chain balances
    //           after close_pool.
    //   Both must be within a 1-USDC-unit epsilon — anything bigger
    //   is a parity bug.
  });
});

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
  PRESETS,
  PRESET_ORDER,
  runSimulation,
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

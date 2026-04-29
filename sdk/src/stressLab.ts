// Stress Lab — pure actuarial simulation engine.
// Mirrors what the on-chain roundfi-core program will compute, so the
// /lab route can validate the Triple Shield math against arbitrary
// default scenarios before contracts ship. M1 of the grant roadmap
// uses this module as the reference implementation; M2's Anchor
// programs will run parity tests against runSimulation() outputs.

// Canonical 3-tier ladder per data/score.ts and docs:
// Lv1 Iniciante (50% stake) → Lv2 Comprovado (30%) → Lv3 Veterano (10%, ✦ VIP).
// "VIP" is a visual badge on Lv3, not a separate level.
export type GroupLevel = "Iniciante" | "Comprovado" | "Veterano";
export type MatrixCell = "P" | "C" | "X";
export type MemberStatus = "ok" | "calote_pre" | "calote_pos";

export interface MemberLedger {
  name: string;
  stakePaid: number;
  installmentsPaid: number;
  /**
   * Cumulative cash sent back to this member by the protocol —
   * upfront payout + escrow drips + stake refund cashback. Same
   * units as `installmentsPaid` so `received - stakePaid -
   * installmentsPaid` is the net position.
   */
  received: number;
  /**
   * Of `received`, how much is stake-refund cashback. Tracked
   * separately so the UI can render "credit released" vs "stake
   * coming back" as distinct rows in the per-member modal. Drip +
   * upfront amounts go to `received - stakeRefunded`.
   */
  stakeRefunded: number;
  status: MemberStatus;
  retained: number;     // protocol-favorable retention (drop-out / negative-loss)
  lossCaused: number;   // damage to the fund (calote pos-contemplação)
}

export interface FrameMetrics {
  collectedInstallments: number;
  kaminoNetYield: number;
  protocolFeeRevenue: number;
  poolBalance: number;
  paidOut: number;
  totalStake: number;
  totalRetained: number;
  totalLoss: number;
}

export interface StressLabFrame {
  cycle: number;
  metrics: FrameMetrics;
  ledgerSnapshot: MemberLedger[];
}

export interface LevelParams {
  stakePct: number;     // % of credit locked as initial stake
  upfrontPct: number;   // 0..1, share of credit released at contemplation
  escrowPct: number;    // 0..1, share retained in escrow
  releaseMonths: number; // how long the escrow drips out
}

// Spec: 50/30/10 stake rule + adaptive escrow per level. Veterans
// graduate from heavier upfront releases to longer escrow drips.
export const LEVEL_PARAMS: Record<GroupLevel, LevelParams> = {
  Iniciante:  { stakePct: 50, upfrontPct: 0.5,  escrowPct: 0.5,  releaseMonths: 5 },
  Comprovado: { stakePct: 30, upfrontPct: 0.45, escrowPct: 0.55, releaseMonths: 4 },
  Veterano:   { stakePct: 10, upfrontPct: 0.35, escrowPct: 0.65, releaseMonths: 3 },
};

export const ALL_NAMES = [
  "Ana", "Bruno", "Clara", "David", "Elena", "Fábio",
  "Gabi", "Hugo", "Igor", "Júlia", "Kaio", "Lara",
  "Malu", "Noah", "Olívia", "Pedro", "Quinn", "Ravi",
  "Sofia", "Theo", "Uma", "Vitor", "Wendy", "Xuxa",
];

export interface StressLabConfig {
  level: GroupLevel;
  members: number;
  installmentUsdc: number;
  kaminoApy: number;    // % annual
  yieldFeePct: number;  // % of yield kept by the protocol as admin fee
  memberNames?: string[];
}

// ── Matrix helpers ────────────────────────────────────────
export function defaultMatrix(N: number): MatrixCell[][] {
  return Array.from({ length: N }, (_, m) =>
    Array.from({ length: N }, (_, c) => (m === c ? "C" : "P")),
  );
}

// Row m, col c. Position-aware click semantics so the UI can
// reproduce every scenario the whitepaper describes — including the
// load-bearing one: a member contemplated at cycle c₀ who then
// defaults at cycle c₁ > c₀ (post-contemplation default, the case
// `runSimulation` flags as `calote_pos`).
//
// - P  before the row's existing C  →  promote to C (move the
//   contemplation here; clear the previous C in this row + any
//   conflicting C in the same column).
// - P  after the row's existing C   →  X (post-contemplation default
//   starting at this cycle; the C at c₀ is preserved). This is the
//   key fix: previously this path had to go through C, which
//   overwrote the existing contemplation.
// - P  with no C in this row        →  promote to C (first
//   contemplation; clear conflicting C in this column).
// - C                                →  P (cancel the row's
//   contemplation entirely; everything stays as P).
// - X                                →  P (revert from this cycle
//   onward, recovering the row's existing C if it sat before col).
export function toggleCell(
  matrix: MatrixCell[][],
  row: number,
  col: number,
): MatrixCell[][] {
  const N = matrix.length;
  const next = matrix.map((r) => [...r]);
  const current = next[row][col];
  const existingContemplationCol = next[row].findIndex((c) => c === "C");

  if (current === "X") {
    // Revert this cycle and everything after it back to P. Any C
    // sitting before `col` is preserved (X can't appear before its
    // own row's C — that's enforced by the other branches).
    for (let j = col; j < N; j++) next[row][j] = "P";
  } else if (current === "C") {
    // Cancel contemplation. Just turn the cell into P.
    next[row][col] = "P";
  } else if (
    existingContemplationCol >= 0 &&
    col > existingContemplationCol
  ) {
    // P after the existing C → cascade X from `col` onward.
    // Preserves the contemplation at existingContemplationCol so
    // `runSimulation` sees `monthContemplated > 0` and flags this
    // member as `calote_pos`.
    for (let j = col; j < N; j++) next[row][j] = "X";
  } else {
    // P before the row's C (or no C in this row): promote to C.
    // Clear any conflicting C in this column + any earlier C in
    // this row, then mark prior cells as P.
    for (let i = 0; i < N; i++) if (next[i][col] === "C") next[i][col] = "P";
    for (let j = 0; j < N; j++) if (next[row][j] === "C") next[row][j] = "P";
    next[row][col] = "C";
    for (let j = 0; j < col; j++) next[row][j] = "P";
  }

  return next;
}

// ── Simulation ─────────────────────────────────────────────
// Pre-calculates every cycle's frame so the UI can step through them
// without any further math (or animate at any speed).
export function runSimulation(
  config: StressLabConfig,
  matrix: MatrixCell[][],
): StressLabFrame[] {
  const N = config.members;
  const inst = config.installmentUsdc;
  const credit = inst * N;
  const params = LEVEL_PARAMS[config.level];
  const stake = credit * (params.stakePct / 100);
  const apy = config.kaminoApy;
  const adminFee = config.yieldFeePct;

  const names = (config.memberNames ?? ALL_NAMES).slice(0, N);

  const ledger: MemberLedger[] = names.map((name) => ({
    name,
    stakePaid: stake,
    installmentsPaid: 0,
    received: 0,
    stakeRefunded: 0,
    status: "ok",
    retained: 0,
    lossCaused: 0,
  }));

  let totalPoolBalance = stake * N;
  let totalNetYield = 0;
  let totalProtocolFeeRevenue = 0;
  let totalInstallments = 0;
  let totalPaidOut = 0;
  let totalRetained = 0;
  let totalLoss = 0;

  const frames: StressLabFrame[] = [];

  for (let c = 1; c <= N; c++) {
    let cycleInstallments = 0;
    let cyclePaidOut = 0;

    for (let m = 0; m < N; m++) {
      const action = matrix[m][c - 1];

      // Find the cycle in which member m gets contemplated (if at all).
      let monthContemplated = -1;
      for (let i = 0; i < N; i++) {
        if (matrix[m][i] === "C") monthContemplated = i + 1;
      }

      if (action === "P" || action === "C") {
        cycleInstallments += inst;
        ledger[m].installmentsPaid += inst;
      }

      if (
        monthContemplated > 0 &&
        monthContemplated <= c &&
        ledger[m].status === "ok" &&
        action !== "X"
      ) {
        // Whitepaper rule: the installment first unlocks that
        // month's escrow drip; once the escrow is fully drained,
        // the next installments unlock the stake refund (cashback).
        // Default at cycle c (action=X) skips the entire payout —
        // the X branch below then marks calote_pos so future cycles
        // also skip.
        let payoutThisMonth = 0;
        let refundThisMonth = 0;
        const upfrontTotal =
          monthContemplated === 1 ? 2 * inst : credit * params.upfrontPct;
        const escrowTotal =
          monthContemplated === 1 ? credit - upfrontTotal : credit * params.escrowPct;
        const escrowPerMonth = escrowTotal / params.releaseMonths;
        // Stake-refund window opens the cycle AFTER the escrow drip
        // ends, runs through cycle N. If contemplation is too late
        // for any refund window to fit, refundMonths <= 0 and the
        // stake stays retained by the protocol (same way the tail
        // of the escrow drip stays retained when contemplation is
        // late — modelled as protocol-favourable carry).
        const refundMonths = N - monthContemplated - params.releaseMonths;
        const refundPerMonth = refundMonths > 0 ? stake / refundMonths : 0;

        if (c === monthContemplated) {
          payoutThisMonth = upfrontTotal;
        } else if (
          c > monthContemplated &&
          c - monthContemplated <= params.releaseMonths
        ) {
          payoutThisMonth = escrowPerMonth;
        } else if (
          c > monthContemplated + params.releaseMonths &&
          refundPerMonth > 0
        ) {
          refundThisMonth = refundPerMonth;
        }

        if (payoutThisMonth > 0 || refundThisMonth > 0) {
          const total = payoutThisMonth + refundThisMonth;
          cyclePaidOut += total;
          ledger[m].received += total;
          ledger[m].stakeRefunded += refundThisMonth;
        }
      }

      if (action === "X" && ledger[m].status === "ok") {
        const paidSoFar = ledger[m].stakePaid + ledger[m].installmentsPaid;

        if (monthContemplated === -1 || c <= monthContemplated) {
          // Pre-contemplation default: protocol keeps everything.
          ledger[m].status = "calote_pre";
          ledger[m].retained = paidSoFar;
          totalRetained += paidSoFar;
        } else {
          // Post-contemplation default: net difference between received and paid.
          ledger[m].status = "calote_pos";
          const diff = ledger[m].received - paidSoFar;
          if (diff > 0) {
            ledger[m].lossCaused = diff;
            totalLoss += diff;
          } else {
            ledger[m].retained = Math.abs(diff);
            totalRetained += Math.abs(diff);
          }
        }
      }
    }

    totalInstallments += cycleInstallments;
    totalPaidOut += cyclePaidOut;
    totalPoolBalance += cycleInstallments - cyclePaidOut;

    if (totalPoolBalance > 0) {
      const cycleGrossYield = (totalPoolBalance * (apy / 100)) / 12;
      const cycleProtocolFee = cycleGrossYield * (adminFee / 100);
      const cycleNetYield = cycleGrossYield - cycleProtocolFee;

      totalProtocolFeeRevenue += cycleProtocolFee;
      totalNetYield += cycleNetYield;
      totalPoolBalance += cycleNetYield; // Only net yield reinforces the vault.
    }

    frames.push({
      cycle: c,
      metrics: {
        collectedInstallments: totalInstallments,
        kaminoNetYield: totalNetYield,
        protocolFeeRevenue: totalProtocolFeeRevenue,
        poolBalance: totalPoolBalance,
        paidOut: totalPaidOut,
        totalStake: stake * N,
        totalRetained,
        totalLoss,
      },
      // Deep clone so future cycles can't retroactively mutate snapshots.
      ledgerSnapshot: ledger.map((l) => ({ ...l })),
    });
  }

  return frames;
}

export function emptyFrame(): StressLabFrame {
  return {
    cycle: 0,
    metrics: {
      collectedInstallments: 0,
      kaminoNetYield: 0,
      protocolFeeRevenue: 0,
      poolBalance: 0,
      paidOut: 0,
      totalStake: 0,
      totalRetained: 0,
      totalLoss: 0,
    },
    ledgerSnapshot: [],
  };
}

// ── Scenario presets ───────────────────────────────────────
// Canonical fixtures the /lab UI exposes as one-click scenarios.
// Same fixtures will drive the parity tests against roundfi-core
// in M1 — running each preset through runSimulation() and through
// the Anchor program must produce identical FrameMetrics.

export type PresetId = "healthy" | "preDefault" | "postDefault" | "cascade";

export interface ScenarioPreset {
  id: PresetId;
  config: Omit<StressLabConfig, "memberNames">;
  matrix: MatrixCell[][];
}

// Helper: starts from a default-diagonal matrix and applies X bursts.
// Each burst: row defaults from `cycle` onward (1-indexed cycle).
function withDefaults(
  N: number,
  defaults: Array<{ row: number; cycle: number }>,
): MatrixCell[][] {
  const m = defaultMatrix(N);
  for (const { row, cycle } of defaults) {
    for (let j = cycle - 1; j < N; j++) m[row][j] = "X";
  }
  return m;
}

const BASE_CONFIG = {
  // Lv2 Comprovado (30% stake) is the canonical mid-ladder default —
  // demonstrates the protocol's middle of the leverage curve without
  // committing to either extreme.
  level: "Comprovado" as GroupLevel,
  members: 12,
  installmentUsdc: 1000,
  kaminoApy: 6.5,
  yieldFeePct: 20,
};

export const PRESETS: Record<PresetId, ScenarioPreset> = {
  healthy: {
    id: "healthy",
    config: BASE_CONFIG,
    matrix: defaultMatrix(12),
  },
  // Member 4 (Elena, would be C at cycle 5) drops out at cycle 3.
  // Pre-contemplation default → protocol retains stake + paid installments.
  preDefault: {
    id: "preDefault",
    config: BASE_CONFIG,
    matrix: withDefaults(12, [{ row: 4, cycle: 3 }]),
  },
  // Member 1 (Bruno, contemplated at cycle 2) defaults at cycle 5
  // after receiving the upfront. Protocol takes a real loss.
  postDefault: {
    id: "postDefault",
    config: BASE_CONFIG,
    matrix: withDefaults(12, [{ row: 1, cycle: 5 }]),
  },
  // Three rolling defaults — pre-contemplation cluster.
  cascade: {
    id: "cascade",
    config: BASE_CONFIG,
    matrix: withDefaults(12, [
      { row: 5, cycle: 4 },
      { row: 7, cycle: 5 },
      { row: 9, cycle: 6 },
    ]),
  },
};

export const PRESET_ORDER: PresetId[] = [
  "healthy",
  "preDefault",
  "postDefault",
  "cascade",
];

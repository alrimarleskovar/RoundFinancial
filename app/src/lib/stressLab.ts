// Stress Lab — pure actuarial simulation engine.
// Mirrors what the on-chain roundfi-core program will compute, so the
// /lab route can validate the Triple Shield math against arbitrary
// default scenarios before contracts ship. M1 of the grant roadmap
// uses this module as the reference implementation; M2's Anchor
// programs will run parity tests against runSimulation() outputs.

export type GroupLevel = "Iniciante" | "Veterano" | "VIP";
export type MatrixCell = "P" | "C" | "X";
export type MemberStatus = "ok" | "calote_pre" | "calote_pos";

export interface MemberLedger {
  name: string;
  stakePaid: number;
  installmentsPaid: number;
  received: number;
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
  Iniciante: { stakePct: 50, upfrontPct: 0.5,  escrowPct: 0.5,  releaseMonths: 5 },
  Veterano:  { stakePct: 30, upfrontPct: 0.45, escrowPct: 0.55, releaseMonths: 4 },
  VIP:       { stakePct: 10, upfrontPct: 0.35, escrowPct: 0.65, releaseMonths: 3 },
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

// Row m, col c. Cycles through P -> C -> X -> P with side-effects:
// - Setting C clears any other C in the same row/col + sets P up to that cycle.
// - Setting X turns everything from that cycle forward into X (defaulted from there on).
// - Setting back to P from X resets the row from that cycle forward.
export function toggleCell(
  matrix: MatrixCell[][],
  row: number,
  col: number,
): MatrixCell[][] {
  const N = matrix.length;
  const next = matrix.map((r) => [...r]);
  const current = next[row][col];

  if (current === "P") {
    // Promote to C: clear conflicting Cs, set prior cells in this row to P.
    for (let i = 0; i < N; i++) if (next[i][col] === "C") next[i][col] = "P";
    for (let j = 0; j < N; j++) if (next[row][j] === "C") next[row][j] = "P";
    next[row][col] = "C";
    for (let j = 0; j < col; j++) next[row][j] = "P";
  } else if (current === "C") {
    // C -> X: this member defaults from this cycle onward.
    for (let j = col; j < N; j++) next[row][j] = "X";
  } else {
    // X -> P: revert from this cycle onward.
    for (let j = col; j < N; j++) next[row][j] = "P";
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
        ledger[m].status === "ok"
      ) {
        let payoutThisMonth = 0;
        const upfrontTotal =
          monthContemplated === 1 ? 2 * inst : credit * params.upfrontPct;
        const escrowTotal =
          monthContemplated === 1 ? credit - upfrontTotal : credit * params.escrowPct;
        const escrowPerMonth = escrowTotal / params.releaseMonths;

        if (c === monthContemplated) {
          payoutThisMonth = upfrontTotal;
        } else if (
          c > monthContemplated &&
          c - monthContemplated <= params.releaseMonths
        ) {
          payoutThisMonth = escrowPerMonth;
        }

        if (payoutThisMonth > 0) {
          cyclePaidOut += payoutThisMonth;
          ledger[m].received += payoutThisMonth;
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
  level: "Veterano" as GroupLevel,
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

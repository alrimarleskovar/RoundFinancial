import {
  runSimulation,
  PRESETS,
  defaultMatrix,
  type MatrixCell,
  type StressLabConfig,
} from "../../sdk/src/stressLab.ts";

function last(frames: ReturnType<typeof runSimulation>) {
  return frames[frames.length - 1]!.metrics;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function report(label: string, frames: ReturnType<typeof runSimulation>) {
  const m = last(frames);
  // also find min netSolvency across all frames
  let minSolv = Infinity;
  let minCycle = -1;
  for (const f of frames) {
    if (f.metrics.netSolvency < minSolv) {
      minSolv = f.metrics.netSolvency;
      minCycle = f.cycle;
    }
  }
  console.log(`\n=== ${label} ===`);
  console.log(`  final netSolvency : ${fmt(m.netSolvency)}`);
  console.log(`  MIN netSolvency   : ${fmt(minSolv)} (cycle ${minCycle})`);
  console.log(`  poolBalance       : ${fmt(m.poolBalance)}`);
  console.log(`  outstandingEscrow : ${fmt(m.outstandingEscrow)}`);
  console.log(`  outstandingStakeRf: ${fmt(m.outstandingStakeRefund)}`);
  console.log(`  solidarityVault   : ${fmt(m.solidarityVault)}`);
  console.log(`  guaranteeFund     : ${fmt(m.guaranteeFund)}`);
  console.log(`  totalRetained     : ${fmt(m.totalRetained)}`);
  console.log(`  totalLoss         : ${fmt(m.totalLoss)}`);
  console.log(`  paidOut           : ${fmt(m.paidOut)}`);
  console.log(`  collectedInst     : ${fmt(m.collectedInstallments)}`);
  console.log(`  SOLVENT?          : ${m.netSolvency >= 0 ? "YES" : "NO  *** INSOLVENT ***"}`);
}

// 1. Canonical preset
report("tripleVeteranDefault (canonical)", runSimulation(PRESETS.tripleVeteranDefault.config, PRESETS.tripleVeteranDefault.matrix));

// helper: build matrix where rows default the cycle right after contemplation (diagonal C at row r => cycle r+1, default at r+2)
function postContemplationDefaults(N: number, rows: number[]): MatrixCell[][] {
  const m = defaultMatrix(N);
  for (const r of rows) {
    const cFrom = r + 2; // 1-indexed cycle after contemplation (contemplated at r+1)
    for (let j = cFrom - 1; j < N; j++) m[r]![j] = "X";
  }
  return m;
}

const vetCfg: StressLabConfig = {
  level: "Veterano",
  members: 24,
  creditAmountUsdc: 10_000,
  kaminoApy: 6.5,
  yieldFeePct: 20,
};

// 2. Escalate: how many early post-contemplation defaults until insolvent?
for (const k of [3, 4, 5, 6, 8, 10, 12]) {
  const rows = Array.from({ length: k }, (_, i) => i + 1); // rows 1..k contemplated cycles 2..k+1
  report(`Veterano: ${k} sequential post-contemplation defaults`, runSimulation(vetCfg, postContemplationDefaults(24, rows)));
}

// 3. Worst case: EVERY contemplated member defaults the cycle after payout (full death spiral)
{
  const N = 24;
  const m = defaultMatrix(N);
  for (let r = 0; r < N; r++) {
    const cFrom = r + 2;
    for (let j = cFrom - 1; j < N; j++) m[r]![j] = "X";
  }
  report("Veterano: ALL 24 default post-contemplation (death spiral)", runSimulation(vetCfg, m));
}

// 4. Iniciante (50% stake) version of triple default
report("Iniciante: 3 post-contemplation defaults", runSimulation({ ...vetCfg, level: "Iniciante" }, postContemplationDefaults(24, [1, 2, 3])));

// 5. Comprovado triple
report("Comprovado: 3 post-contemplation defaults", runSimulation({ ...vetCfg, level: "Comprovado" }, postContemplationDefaults(24, [1, 2, 3])));

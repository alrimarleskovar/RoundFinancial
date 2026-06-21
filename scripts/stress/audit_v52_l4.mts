// Re-audit v5.2 — quantify L4 Elite (3% stake = 33x leverage) default recovery
// vs the canonical Veterano (10%) headline stress test.
import * as SL from "../../sdk/src/stressLab.ts";
const { runSimulation, defaultMatrix, LEVEL_PARAMS } = SL as any;

// Inject the 4th tier the Stress Lab does NOT model. On-chain: STAKE_BPS_LEVEL_4 = 300 (3%).
// Upfront/escrow: extrapolate the descending-upfront ladder (Ini .50/.50, Comp .45/.55, Vet .35/.65).
// Elite plausibly .30/.70; release fastest (1mo mature / 2mo immature ~ veteran-ish). Use vet-like drip.
LEVEL_PARAMS.Elite = { stakePct: 3, upfrontPct: 0.30, escrowPct: 0.70, releaseMonths: 3, releaseMonthsMature: 1 };
// Also correct L2 to the on-chain v5.2 value (25%, not the stale 30% the sim still ships).
const L2_stale = LEVEL_PARAMS.Comprovado.stakePct;

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

function postContempDefaults(N: number, rows: number[]) {
  const m = defaultMatrix(N);
  for (const r of rows) for (let j = r + 1; j < N; j++) m[r]![j] = "X";
  return m;
}

function run(label: string, level: string, apy: number, rows: number[]) {
  const cfg = { level, members: 24, creditAmountUsdc: 10_000, kaminoApy: apy, yieldFeePct: 20 };
  const frames = runSimulation(cfg, postContempDefaults(24, rows));
  const m = frames[frames.length - 1]!.metrics;
  console.log(
    `${label.padEnd(42)} | final netSolv=${fmt(m.netSolvency).padStart(11)} | totalLoss=${fmt(m.totalLoss).padStart(10)} | totalRetained=${fmt(m.totalRetained).padStart(11)} | poolBal=${fmt(m.poolBalance).padStart(10)}`,
  );
  return m;
}

console.log(`\nNOTE: Stress Lab still ships L2=${L2_stale}% (on-chain v5.2 = 25%); Elite (3%) tier is UNMODELED — injected here.\n`);

console.log("## Triple post-contemplation default @ 6.5% APY, by tier (lower stake = worse recovery)");
run("Iniciante (50% stake, 2x lev)", "Iniciante", 6.5, [1,2,3]);
run("Comprovado (30% stale-sim)", "Comprovado", 6.5, [1,2,3]);
run("Veterano (10% stake, 10x lev) = HEADLINE", "Veterano", 6.5, [1,2,3]);
run("Elite (3% stake, 33x lev) = UNMODELED", "Elite", 6.5, [1,2,3]);

console.log("\n## Same, @ 0% APY (strip the yield buffer — structural recovery only)");
run("Veterano (10%) @ 0%", "Veterano", 0, [1,2,3]);
run("Elite (3%) @ 0%", "Elite", 0, [1,2,3]);

console.log("\n## Escalating Elite defaults @ 6.5% — where does an all-Elite pool break?");
for (const k of [3, 4, 5, 6, 8]) run(`Elite, k=${k} defaults`, "Elite", 6.5, Array.from({length:k},(_,i)=>i+1));

console.log("\n## Per-default recovery delta: Veterano vs Elite (single default, isolate the stake leg)");
const v1 = run("Veterano single default @ 0%", "Veterano", 0, [1]);
const e1 = run("Elite single default @ 0%", "Elite", 0, [1]);
console.log(`\n  Stake-leg gap per default (Vet 10% - Elite 3% = 7% of $10k credit = $700 expected):`);
console.log(`  Veterano totalRetained=${fmt(v1.totalRetained)} vs Elite totalRetained=${fmt(e1.totalRetained)} | delta=${fmt(v1.totalRetained - e1.totalRetained)}`);

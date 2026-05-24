import {
  runSimulation,
  PRESETS,
  defaultMatrix,
  type StressLabConfig,
} from "../../sdk/src/stressLab.ts";

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 }).padStart(13);
}

function trace(label: string, frames: ReturnType<typeof runSimulation>) {
  console.log(`\n=== ${label} ===`);
  console.log(
    "cyc |   netSolv   |  poolBal   |  outEscrow  | outStakeRf  |  solidar   |   guarFund",
  );
  for (const f of frames) {
    const m = f.metrics;
    console.log(
      `${String(f.cycle).padStart(3)} |${fmt(m.netSolvency)}|${fmt(m.poolBalance)}|${fmt(
        m.outstandingEscrow,
      )}|${fmt(m.outstandingStakeRefund)}|${fmt(m.solidarityVault)}|${fmt(m.guaranteeFund)}`,
    );
  }
}

// Healthy 24-member Veterano (no defaults) — does it ALSO show -229k at cycle 1?
const vetCfg: StressLabConfig = {
  level: "Veterano",
  members: 24,
  creditAmountUsdc: 10_000,
  kaminoApy: 6.5,
  yieldFeePct: 20,
};
trace("HEALTHY Veterano 24 (no defaults)", runSimulation(vetCfg, defaultMatrix(24)));

trace("HEALTHY Comprovado 12 (base healthy preset)", runSimulation(PRESETS.healthy.config, PRESETS.healthy.matrix));

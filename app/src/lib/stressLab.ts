// Re-export of the L1 actuarial simulator. The canonical source is
// `sdk/src/stressLab.ts` so both the `/lab` route and the
// `tests/economic_parity.spec.ts` parity check import the same module
// — a single source of truth for the L1 reference implementation that
// the on-chain roundfi-core program is parity-tested against.

export {
  defaultMatrix,
  emptyFrame,
  LEVEL_PARAMS,
  PRESETS,
  PRESET_ORDER,
  ALL_NAMES,
  resizeMatrix,
  runSimulation,
  toggleCell,
  toggleCellEscape,
  type FrameMetrics,
  type GroupLevel,
  type GroupMaturity,
  type LevelParams,
  type MatrixCell,
  type MemberLedger,
  type MemberStatus,
  type PresetId,
  type ScenarioPreset,
  type StressLabConfig,
  type StressLabFrame,
} from "@roundfi/sdk";

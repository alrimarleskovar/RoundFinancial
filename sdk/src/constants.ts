/**
 * RoundFi protocol constants — mirrors docs/architecture.md §3.1 and §7.
 * These values are asserted by on-chain tests; do not change here without
 * updating the architecture spec and the on-chain ProtocolConfig defaults.
 */

/** Fee schedule in basis points (1 bp = 0.01%). */
export const FEES = {
  /** Yield spread captured by protocol treasury. */
  yieldFeeBps: 2_000, // 20%
  /** Per-cycle fee charged to Level 1 members. */
  cycleFeeL1Bps: 200, // 2%
  /** Per-cycle fee charged to Level 2 members. */
  cycleFeeL2Bps: 100, // 1%
  /** Per-cycle fee charged to Level 3 (Veteran) members — exempt. */
  cycleFeeL3Bps: 0,
  /** Guarantee Fund fill target, expressed as bps of protocol yield. Configurable in ProtocolConfig. */
  guaranteeFundBps: 15_000, // 150%
  /** Portion of each installment routed to the Solidarity Vault. */
  solidarityBps: 100, // 1%
  /** Month-1 Seed Draw retention floor — pool must retain >= this fraction before first full payout. */
  seedDrawBps: 9_160, // 91.6%
  /** Default Adaptive Escrow release per milestone; per-pool override in Pool.escrow_release_bps. */
  escrowReleaseBps: 2_500, // 25%
} as const;

/** Stake requirement (as bps of credit amount) by reputation level. Snapshotted at join. */
export const STAKE_BPS_BY_LEVEL = {
  1: 5_000, // 50%
  2: 3_000, // 30%
  3: 1_000, // 10%
} as const;

/** Default ROSCA pool parameters. */
export const POOL_DEFAULTS = {
  membersTarget: 24,
  /** Monthly installment in USDC base units (6 decimals): 600 USDC = 600_000_000.
   *  Bumped from 416 USDC by Adevar Labs SEV-025 — old defaults made the pool
   *  inviable (24 × 416 × 0.74 = 7388 USDC pool float < 10_000 USDC credit,
   *  failed cycle-0 Seed Draw guard). Now 24 × 600 × 0.74 = 10_656 USDC. */
  installmentAmount: 600_000_000n,
  /** Credit amount released per cycle: 10,000 USDC. */
  creditAmount: 10_000_000_000n,
  cyclesTotal: 24,
  /** Cycle duration in seconds (30 days). */
  cycleDurationSec: 2_592_000,
} as const;

/** Attestation schema IDs — mirrors roundfi-reputation::SchemaId. */
export const ATTESTATION_SCHEMA = {
  Payment: 1,
  Late: 2,
  Default: 3,
  CycleComplete: 4,
  LevelUp: 5,
} as const;

/** PoolStatus enum values — mirrors roundfi-core::PoolStatus. */
export const POOL_STATUS = {
  Forming: 0,
  Active: 1,
  Completed: 2,
  Liquidated: 3,
  /** Terminal state set by close_pool. Distinct from Completed so the
   *  close_pool entry constraint rejects subsequent invocations
   *  (Adevar Labs SEV-005 fix; SDK sync added in SEV-035). */
  Closed: 4,
} as const;

/** EscapeValveStatus enum values — mirrors roundfi-core::state::listing::EscapeValveStatus.
 *  W5 follow-up: extended parity test coverage beyond PoolStatus (the SEV-035 drift class). */
export const ESCAPE_VALVE_STATUS = {
  Active: 0,
  Filled: 1,
  Cancelled: 2,
  /** Listing committed (hash on chain) but not yet revealed. Cannot be
   *  bought. Cancellable by the seller. Used by the #232 commit-reveal
   *  MEV mitigation. */
  Pending: 3,
} as const;

/** IdentityProvider enum values — mirrors roundfi-reputation::state::identity::IdentityProvider.
 *  HumanPassport discriminant=2 inherited from the prior Civic variant
 *  for byte-compat with already-allocated IdentityRecord PDAs (#227). */
export const IDENTITY_PROVIDER = {
  None: 0,
  Sas: 1,
  HumanPassport: 2,
} as const;

/** IdentityStatus enum values — mirrors roundfi-reputation::state::identity::IdentityStatus. */
export const IDENTITY_STATUS = {
  Unverified: 0,
  Verified: 1,
  Expired: 2,
  Revoked: 3,
} as const;

/** Default crank intervals (seconds). Overridable via env. */
export const CRANK_DEFAULTS = {
  harvestIntervalSec: 21_600, // 6h
  bonusPollIntervalSec: 300, // 5m
  defaultGraceSec: 604_800, // 7d
} as const;

/** Seconds per year — used by yield-mock accrual math. */
export const SECONDS_PER_YEAR = 31_536_000;

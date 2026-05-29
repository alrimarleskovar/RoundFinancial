/**
 * @roundfi/sdk entrypoint.
 *
 * Re-exports the public surface:
 *   - constants (fees, stake ladder, pool defaults, schema IDs, status),
 *   - PDA derivations (one source of truth shared with on-chain seeds),
 *   - the RoundFiClient factory + types,
 *   - action wrappers (one per user-facing instruction),
 *   - read helpers + normalized *View types,
 *   - stress-lab actuarial simulator (L1 reference impl, parity-tested
 *     against the roundfi-core program in `tests/economic_parity.spec.ts`),
 *   - behavioral semantics (canonical due_ts / on-time / grace / default
 *     definitions shared by the indexer + admin console; ADR 0009).
 */

export * from "./constants.js";
export * from "./pda.js";
export * from "./client.js";
export * from "./actions.js";
export * from "./reads.js";
export * from "./onchain-raw.js";
export * from "./stressLab.js";
export * from "./events.js";
export * from "./behavioral.js";
export * from "./yield.js";

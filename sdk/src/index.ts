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
 *     against the roundfi-core program in `tests/economic_parity.spec.ts`).
 */

export * from "./constants.js";
export * from "./pda.js";
export * from "./client.js";
export * from "./actions.js";
export * from "./reads.js";
export * from "./stressLab.js";

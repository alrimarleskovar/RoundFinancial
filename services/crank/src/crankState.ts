/**
 * Shared in-process state for the crank — visible to the polling loop,
 * the health endpoint, and the default classifier.
 *
 * Kept in a tiny module (not globals on `globalThis`) so:
 *   - tests can import and reset between cases,
 *   - the health server, the loop, and settleDefaults all read/write
 *     through the same surface (no risk of two copies drifting),
 *   - intent is explicit at call sites (`crankState.markCycleSuccess()`
 *     reads better than a bare `lastSuccessfulRun = new Date()`).
 *
 * State semantics:
 *   bootAt:               set once at process start; used by /health to
 *                         emit `starting` (not `degraded`) during the
 *                         first 5 min so Railway redeploys don't trip
 *                         UptimeRobot every time.
 *   lastSuccessfulRun:    advanced ONLY when a full polling tick
 *                         completed without a fatal error AND the RPC
 *                         health check passed. Stays null until then.
 *   rpcDownSince:         set when the RPC health check first fails;
 *                         cleared the next tick the RPC is reachable.
 *                         Drives the INFRA_FAILURE vs PAYMENT_MISSED
 *                         classification in settleDefaults — if the
 *                         crank was unreachable across a member's grace
 *                         deadline, the default is not the member's
 *                         fault and the score contestation can use this
 *                         to flip the verdict off-chain.
 */

export interface CrankState {
  bootAt: Date;
  lastSuccessfulRun: Date | null;
  rpcDownSince: Date | null;
}

function makeInitialState(): CrankState {
  return {
    bootAt: new Date(),
    lastSuccessfulRun: null,
    rpcDownSince: null,
  };
}

let state: CrankState = makeInitialState();

export const crankState = {
  /** Read-only snapshot. Don't mutate; use the setters below. */
  get snapshot(): Readonly<CrankState> {
    return state;
  },
  markCycleSuccess(): void {
    state.lastSuccessfulRun = new Date();
  },
  markRpcDown(): void {
    if (!state.rpcDownSince) state.rpcDownSince = new Date();
  },
  markRpcUp(): void {
    state.rpcDownSince = null;
  },
  /** TEST-ONLY: reset between cases. Not exported via index.ts. */
  __resetForTest(): void {
    state = makeInitialState();
  },
};

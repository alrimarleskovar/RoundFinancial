/**
 * Shared in-memory state for the cranker process.
 *
 * The polling loop writes; the healthcheck server reads. Single
 * process, single object — no locks needed because Node is single-
 * threaded and every mutation is synchronous.
 *
 * Owner: Gabriel (healthcheck consumes this) — but the loop also
 * writes to it. Both files import from here.
 */

export interface CrankerState {
  startedAt: number;
  lastPollAt: number | null;
  lastSuccessAt: number | null;
  pollsTotal: number;
  candidatesDetected: number;
  settlementsAttempted: number;
  settlementsSucceeded: number;
  settlementsFailed: number;
  lastError: string | null;
}

export function newState(): CrankerState {
  return {
    startedAt: Date.now(),
    lastPollAt: null,
    lastSuccessAt: null,
    pollsTotal: 0,
    candidatesDetected: 0,
    settlementsAttempted: 0,
    settlementsSucceeded: 0,
    settlementsFailed: 0,
    lastError: null,
  };
}

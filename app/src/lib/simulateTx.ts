// Simulate-before-sign guard (frontend-security checklist §2.2).
//
// Every fund-movement path builds a fully-populated legacy `Transaction`
// (recentBlockhash + feePayer set) and then hands it to the wallet
// adapter's `sendTransaction`, which signs + submits in one step. That
// means the user signs BEFORE anyone knows whether the transaction would
// actually succeed on-chain — a hostile/stale RPC, a changed pool state,
// or a wrong amount only surfaces AFTER the signature.
//
// `simulateOrThrow` inserts a dry-run between "tx built" and "wallet
// signs": it asks the RPC to execute the message with `sigVerify` OFF
// (the wallet hasn't signed yet) and throws if the runtime rejects it.
// The caller's `try/catch` then renders the reason and the user never
// signs a doomed transaction.
//
// This is valuable on devnet too (clearer pre-sign errors), but it's a
// hard requirement before mainnet, where a doomed signature can still
// cost fees and a malicious simulation-divergence is a real threat.

import type { Connection, Transaction, SimulatedTransactionResponse } from "@solana/web3.js";

/**
 * Thrown by {@link simulateOrThrow} when the pre-sign dry-run reports an
 * error. Carries the structured `err` and the program `logs` so the
 * calling modal can show a concise reason (via {@link summarizeSimError})
 * plus the raw logs for power users.
 */
export class TransactionSimulationError extends Error {
  readonly err: unknown;
  readonly logs: string[];
  constructor(message: string, err: unknown, logs: string[]) {
    super(message);
    this.name = "TransactionSimulationError";
    this.err = err;
    this.logs = logs;
  }
}

/**
 * Pure: distill a failed simulation into a one-line, user-facing reason.
 *
 * Preference order:
 *   1. Anchor's "Error Message: <reason>." log line (the friendliest).
 *   2. The last `Program log:` line (next-best on-chain hint).
 *   3. The structured `err` (e.g. `{ InstructionError: [0, { Custom: 6001 }] }`).
 *   4. A generic fallback.
 */
export function summarizeSimError(err: unknown, logs: readonly string[]): string {
  const anchorMsg = logs.find((l) => /Error Message:/i.test(l));
  if (anchorMsg) {
    const m = anchorMsg.match(/Error Message:\s*(.+?)\.?\s*$/i);
    if (m && m[1]) return m[1].trim();
  }
  const lastProgramLog = [...logs].reverse().find((l) => /^Program log:/i.test(l));
  if (lastProgramLog) {
    const stripped = lastProgramLog.replace(/^Program log:\s*/i, "").trim();
    if (stripped) return stripped;
  }
  if (err != null) return `Transaction would fail on-chain: ${JSON.stringify(err)}`;
  return "Transaction would fail on-chain";
}

/**
 * Dry-run a fully-built (feePayer + recentBlockhash set) transaction
 * before the wallet signs it. Resolves if simulation succeeds; throws
 * {@link TransactionSimulationError} if the runtime rejects it.
 *
 * `sigVerify` is OFF — the wallet hasn't signed yet, so we pass no
 * signers. This still exercises every instruction's account/logic/balance
 * constraints, which is the point.
 *
 * The original `tx` is left untouched: web3.js' legacy `simulateTransaction`
 * may re-fetch and overwrite `recentBlockhash`, which would desync the
 * caller's `confirmTransaction({ blockhash, lastValidBlockHeight })`, so
 * the pinned blockhash + feePayer are restored in a `finally`.
 */
export async function simulateOrThrow(connection: Connection, tx: Transaction): Promise<void> {
  const pinnedBlockhash = tx.recentBlockhash;
  const pinnedFeePayer = tx.feePayer;
  let value: SimulatedTransactionResponse;
  try {
    ({ value } = await connection.simulateTransaction(tx));
  } finally {
    if (pinnedBlockhash) tx.recentBlockhash = pinnedBlockhash;
    if (pinnedFeePayer) tx.feePayer = pinnedFeePayer;
  }
  if (value.err) {
    throw new TransactionSimulationError(
      summarizeSimError(value.err, value.logs ?? []),
      value.err,
      value.logs ?? [],
    );
  }
}

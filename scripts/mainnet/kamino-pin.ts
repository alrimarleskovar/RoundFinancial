/**
 * Kamino program-id pin verification — pure functions (no I/O).
 *
 * The `roundfi-yield-kamino` adapter hardcodes the Kamino Lend program ID
 * as a `const` in `programs/roundfi-yield-kamino/src/lib.rs`. If that
 * value drifts away from the canonical mainnet Kamino Lend program ID,
 * every yield CPI lands on the wrong program — silently, until the first
 * harvest reverts (or worse, succeeds against a malicious look-alike).
 *
 * The adapter's own module comment flags this as a pre-mainnet operator
 * check that has stayed pending since the audit. This module ships the
 * automatable half:
 *
 *   1. `extractKaminoLendProgramId(source)` — regex-extract the pinned
 *      `KAMINO_LEND_PROGRAM_ID` value from the lib.rs source. PURE; runs
 *      in the `js` CI lane against the on-disk source as a drift gate.
 *   2. The CLI in `verify-kamino-pin.ts` calls this + a `getAccountInfo`
 *      against mainnet to confirm the program is actually deployed +
 *      executable at that address.
 *
 * The canonical expected value is pinned BELOW. Re-verification against
 * Kamino's published deploy address (e.g. their docs / Squads multisig
 * announcement) is the operator's job before each mainnet deploy of the
 * adapter — that is what the CLI's `--verify-rpc` flag enforces.
 */

/**
 * Canonical Kamino Lend mainnet program ID. The single source of truth
 * the spec/CLI compare the on-disk constant against. If Kamino ever
 * rotates the program (via a governance upgrade or redeploy), update
 * BOTH this constant AND the `KAMINO_LEND_PROGRAM_ID` in
 * `programs/roundfi-yield-kamino/src/lib.rs` in the same PR — the spec
 * will fail if they drift.
 */
export const EXPECTED_KAMINO_LEND_PROGRAM_ID = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";

/** Pinned-source location of the adapter constant, for error messages. */
export const ADAPTER_LIB_RS_RELATIVE_PATH = "programs/roundfi-yield-kamino/src/lib.rs";

/**
 * Extract `KAMINO_LEND_PROGRAM_ID` value from the adapter's lib.rs source.
 *
 * Targets the exact pattern shipped today:
 *
 *   pub const KAMINO_LEND_PROGRAM_ID: Pubkey =
 *       anchor_lang::pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
 *
 * Tolerates extra whitespace/newlines between tokens. Returns null on
 * any divergence so the caller can decide whether to error or report.
 */
export function extractKaminoLendProgramId(source: string): string | null {
  // anchor_lang::pubkey!("...") OR pubkey!("...") — both Anchor variants.
  const pattern =
    /pub\s+const\s+KAMINO_LEND_PROGRAM_ID\s*:\s*Pubkey\s*=\s*(?:anchor_lang\s*::\s*)?pubkey\s*!\s*\(\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"\s*\)/;
  const match = source.match(pattern);
  return match ? (match[1] ?? null) : null;
}

export type KaminoPinVerdict =
  | { ok: true; pinned: string }
  | { ok: false; reason: "extraction_failed"; pinned: null }
  | { ok: false; reason: "drift"; pinned: string; expected: string };

/**
 * Decide whether the on-disk pinned value matches the canonical expected
 * value. Pure: takes the source text + expected as args. The CLI wraps
 * this with file I/O.
 */
export function verifyKaminoPin(args: { source: string; expected?: string }): KaminoPinVerdict {
  const expected = args.expected ?? EXPECTED_KAMINO_LEND_PROGRAM_ID;
  const pinned = extractKaminoLendProgramId(args.source);
  if (pinned === null) {
    return { ok: false, reason: "extraction_failed", pinned: null };
  }
  if (pinned !== expected) {
    return { ok: false, reason: "drift", pinned, expected };
  }
  return { ok: true, pinned };
}

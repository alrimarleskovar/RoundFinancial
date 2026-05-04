/**
 * Time / clock helpers for tests that care about cycle boundaries,
 * grace windows, and slot monotonicity.
 *
 * The `solana-test-validator` that backs `anchor test` does NOT
 * support arbitrary clock warping the way Foundry does on Ethereum.
 * Two usable tactics:
 *
 *   1. `sleep()` — coarse, real-time wait. Fine for short boundaries
 *      like "wait 60s for next_cycle_at" when `MIN_CYCLE_DURATION=60`.
 *
 *   2. Construct pool fixtures with tiny `cycle_duration` (e.g. 1s).
 *      Then real-time `sleep()` is cheap enough to drive a dozen
 *      cycles in a test run. Preferred over warping.
 *
 * For the 7-day grace window on settle_default we can't `sleep(7d)`.
 * The planned approach (Step 5f) is to also pass a per-pool
 * `grace_override_secs` via a localnet-only feature flag, OR drive
 * the crank with a synthetic `now` threaded through the handler.
 * Both are 5f decisions — 5a just exposes the primitives.
 */

/** Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Shorthand for `sleep(seconds * 1000)`. */
export function sleepSec(seconds: number): Promise<void> {
  return sleep(seconds * 1000);
}

/**
 * Wait until a wall-clock unix timestamp (seconds) has passed.
 * Useful for `next_cycle_at` deadlines on pools with tiny
 * cycle_duration (1–5s). Caps the wait at `maxMs` to avoid
 * hanging CI if a deadline is mis-set.
 */
export async function waitUntilUnix(targetSec: number, maxMs = 60_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() / 1000 < targetSec) {
    if (Date.now() > deadline) {
      throw new Error(`waitUntilUnix: exceeded ${maxMs}ms while waiting for ${targetSec}`);
    }
    await sleep(100);
  }
}

/**
 * Current Solana unix timestamp from the cluster clock sysvar,
 * via the RPC. Prefer this over `Date.now()` when asserting
 * against on-chain timestamps (drift between local and cluster
 * clocks is small but nonzero).
 */
import { Connection, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";

export async function onchainUnix(connection: Connection): Promise<number> {
  const acct = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
  if (!acct) throw new Error("clock sysvar missing — RPC issue");
  // Clock layout: slot(8) epoch_start(8) epoch(8) leader_schedule_epoch(8) unix_ts(8)
  const ts = acct.data.readBigInt64LE(32);
  return Number(ts);
}

/**
 * Gap 2 of the canary audit — continuous polling loop.
 *
 * The orchestrator's `runCycle` was a single-shot demo runner;
 * production cycles of 48h + 24h grace cannot be advanced by a human
 * running a script. This loop polls every POLL_INTERVAL_MS (default
 * 60s — frequent enough to catch grace-deadline crossings within a
 * minute, infrequent enough to keep RPC quota low) and:
 *
 *   1. checks RPC health — skip the tick if it's down (Gap 4), do NOT
 *      mark cycle success (so /health degrades after BOOT_GRACE);
 *   2. fetches active pools (Gap 5);
 *   3. for each pool, checks-and-settles defaults (Gap 1);
 *   4. marks the tick successful.
 *
 * Error handling is per-pool: an error processing pool A does NOT stop
 * pool B from being processed in the same tick. Errors are NOT
 * rethrown — the loop keeps running. The lastSuccessfulRun is still
 * advanced on a partial-success tick (some pools settled, some failed)
 * because the loop *itself* worked; the failed pools' errors are
 * surfaced in their own log lines for ops to triage.
 */

import type { Connection } from "@solana/web3.js";
import type { RoundFiClient } from "@roundfi/sdk";

import { classifyError } from "./classifyError.js";
import { crankState } from "./crankState.js";
import { fetchActivePools } from "./fetchActivePools.js";
import { type LeaseClient, noopLease } from "./lease.js";
import { logger } from "./logger.js";
import { checkRpcHealth } from "./rpcHealth.js";
import { refreshStaleElites } from "./refreshIdentities.js";
import { checkAndSettleDefaults } from "./settleDefaults.js";

export interface PollingLoopOptions {
  connection: Connection;
  client: RoundFiClient;
  /** ms between ticks. Defaults to POLL_INTERVAL_MS env or 60_000. */
  intervalMs?: number;
  /** Multi-instance lease. Defaults to noopLease (single-replica). */
  lease?: LeaseClient;
}

export interface PollingLoopHandle {
  /** Resolves when the loop has stopped (after `stop()` was called). */
  done: Promise<void>;
  stop: () => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// SEV-E identity-refresh sweep throttle (module state across ticks). The sweep
// enumerates every L4 profile, so it runs on a slow cadence (identity expiry is
// wall-clock / days), not on every settle tick.
let lastRefreshSweepMs = 0;

export function startPollingLoop(opts: PollingLoopOptions): PollingLoopHandle {
  const intervalMs = opts.intervalMs ?? Number(process.env.POLL_INTERVAL_MS ?? 60_000);
  let stopped = false;

  const done = (async () => {
    logger.info(
      { event_type: "loop.start", intervalMs },
      `Polling loop started (interval ${intervalMs}ms)`,
    );
    while (!stopped) {
      await runOneTick(opts);
      if (stopped) break;
      await sleep(intervalMs);
    }
    logger.info({ event_type: "loop.stopped" }, "Polling loop stopped");
  })();

  return {
    done,
    stop: () => {
      stopped = true;
    },
  };
}

/** Exported for tests + the one-shot CLI mode. */
export async function runOneTick(opts: PollingLoopOptions): Promise<void> {
  const tickStart = Date.now();
  const lease = opts.lease ?? noopLease;
  try {
    // Lease guard FIRST — if another instance holds it, this tick is a
    // no-op. We deliberately don't markCycleSuccess: the holder is the
    // one doing real work and advancing its own lastSuccessfulRun;
    // followers' /health would otherwise show "ok" via lease-piggyback.
    const haveLease = await lease.tryAcquire();
    if (!haveLease) {
      logger.info(
        { event_type: "tick.no_lease" },
        "Lease held by another instance — skipping tick",
      );
      return;
    }

    const rpcOk = await checkRpcHealth(opts.connection);
    if (!rpcOk) {
      // Do NOT markCycleSuccess — that would mask the outage and the
      // /health endpoint would keep returning ok. Returning here lets
      // /health naturally degrade after STALE_TICK_MS.
      return;
    }

    const pools = await fetchActivePools(opts.client);
    const summary = {
      pools: pools.length,
      settled: 0,
      failed: 0,
      skipped: 0,
    };

    for (const pool of pools) {
      try {
        const results = await checkAndSettleDefaults(opts.client, pool);
        for (const r of results) {
          if (r.status === "settled") summary.settled++;
          else if (r.status === "failed") summary.failed++;
          else summary.skipped++;
        }
      } catch (err) {
        // Per-pool catch: keep going with the next pool.
        const errorKind = classifyError(err);
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          {
            event_type: "tick.pool_failed",
            pool: pool.address.toBase58(),
            errorKind,
            error: msg,
          },
          `Pool processing failed (${errorKind}) — continuing`,
        );
      }
    }

    // SEV-E: periodically refresh stale L4 "Elite" identities so a passport
    // that lapsed by wall-clock can't keep the discounted tier into the next
    // join. Throttled + isolated — a refresh error never fails the settle tick.
    const refreshIntervalMs = Number(process.env.REFRESH_IDENTITY_INTERVAL_MS ?? 600_000);
    if (tickStart - lastRefreshSweepMs >= refreshIntervalMs) {
      lastRefreshSweepMs = tickStart;
      try {
        const refreshed = await refreshStaleElites(opts.client);
        const failed = refreshed.filter((r) => r.status === "failed").length;
        if (refreshed.length > 0) {
          logger.info(
            { event_type: "refresh.sweep", acted: refreshed.length, failed },
            `Elite identity sweep: refreshed ${refreshed.length - failed}, ${failed} failed`,
          );
        }
      } catch (err) {
        const errorKind = classifyError(err);
        logger.error(
          {
            event_type: "refresh.sweep_failed",
            errorKind,
            error: err instanceof Error ? err.message : String(err),
          },
          `Elite identity refresh sweep failed (${errorKind}) — continuing`,
        );
      }
    }

    crankState.markCycleSuccess();
    logger.info(
      { event_type: "tick.complete", ...summary, ms: Date.now() - tickStart },
      "Tick complete",
    );
  } catch (err) {
    // Top-level catch: never rethrow, never stop the loop. If we got
    // here, the error wasn't per-pool — likely from fetchActivePools
    // or rpcHealth misbehaving. Still surface and continue.
    const errorKind = classifyError(err);
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      {
        event_type: "tick.failed",
        errorKind,
        error: msg,
        ms: Date.now() - tickStart,
      },
      `Tick failed (${errorKind}) — loop continues`,
    );
  }
}

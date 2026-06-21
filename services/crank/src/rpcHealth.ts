/**
 * RPC health check — Gap 4 of the canary audit.
 *
 * Why a dedicated pre-cycle probe instead of just relying on the cycle
 * itself to fail: a flaky RPC + `getProgramAccounts` returning [] (no
 * pools) is indistinguishable from "no active pools" without an
 * up-front liveness check. The crank would then *appear* to succeed
 * (mark lastSuccessfulRun), the /health endpoint stays "ok", and the
 * UptimeRobot never alerts — silent stall, exactly the failure mode the
 * audit's Gap 4 describes.
 *
 * `getVersion()` is the canonical cheap liveness call on a Solana RPC
 * (constant-time, no slot lookups). We treat any throw or network error
 * as down; the caller is expected to skip the tick and NOT advance
 * `lastSuccessfulRun`. The state module tracks `rpcDownSince` so the
 * default classifier can later distinguish PAYMENT_MISSED (member
 * skipped while infra was healthy) from INFRA_FAILURE (member's grace
 * deadline elapsed while the crank's RPC was unreachable — not the
 * member's fault, eligible for off-chain score contestation).
 */

import type { Connection } from "@solana/web3.js";

import { crankState } from "./crankState.js";
import { logger } from "./logger.js";

export async function checkRpcHealth(conn: Connection): Promise<boolean> {
  try {
    // `getVersion` is the standard cheap liveness call. We deliberately
    // don't `await` anything heavier — the goal is binary up/down, not
    // a slot delta measurement.
    await conn.getVersion();
    if (crankState.snapshot.rpcDownSince) {
      logger.info(
        {
          event_type: "rpc.recovered",
          downSince: crankState.snapshot.rpcDownSince.toISOString(),
        },
        "RPC reachable again after outage",
      );
      crankState.markRpcUp();
    }
    return true;
  } catch (err) {
    crankState.markRpcDown();
    logger.error(
      {
        event_type: "rpc.unreachable",
        error: err instanceof Error ? err.message : String(err),
      },
      "RPC liveness check failed — skipping cycle",
    );
    return false;
  }
}

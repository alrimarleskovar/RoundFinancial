/**
 * /health endpoint — Gap 3 of the canary audit.
 *
 * Used by UptimeRobot (or any HTTP poller) to detect crank degradation.
 * Returns one of three states:
 *
 *   starting (HTTP 200):  process is in its first 5 minutes — common
 *                          on Railway redeploys, so we don't trip the
 *                          alert on every restart.
 *   ok       (HTTP 200):  lastSuccessfulRun is recent (< 5 min ago).
 *   degraded (HTTP 503):  past the boot grace AND no successful tick
 *                          in the last 5 min. Caller should alert.
 *
 * 503 vs 200 is the right shape for UptimeRobot: it treats 5xx as
 * down by default. A 200 with `{status: "degraded"}` would require a
 * keyword check.
 *
 * Why node:http instead of fastify/express: one route, no schema, no
 * middleware. Adding a dep here would dwarf the implementation.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { crankState } from "./crankState.js";
import { logger } from "./logger.js";

/** First 5 min of process life report `starting` (Railway redeploy grace). */
const BOOT_GRACE_MS = 5 * 60 * 1000;
/** A tick older than this means the crank is degraded. */
const STALE_TICK_MS = 5 * 60 * 1000;

export type HealthStatus = "starting" | "ok" | "degraded";

export interface HealthBody {
  status: HealthStatus;
  bootAt: string;
  lastRun: string | null;
  rpcDownSince: string | null;
  /** Seconds since the last successful tick — null when there's none yet. */
  secondsSinceLastRun: number | null;
}

export function computeHealth(now: Date = new Date()): { status: HealthStatus; body: HealthBody } {
  const snap = crankState.snapshot;
  const sinceBoot = now.getTime() - snap.bootAt.getTime();
  const sinceLastRun = snap.lastSuccessfulRun
    ? now.getTime() - snap.lastSuccessfulRun.getTime()
    : null;

  let status: HealthStatus;
  if (sinceBoot < BOOT_GRACE_MS) {
    status = "starting";
  } else if (sinceLastRun !== null && sinceLastRun < STALE_TICK_MS) {
    status = "ok";
  } else {
    status = "degraded";
  }

  return {
    status,
    body: {
      status,
      bootAt: snap.bootAt.toISOString(),
      lastRun: snap.lastSuccessfulRun?.toISOString() ?? null,
      rpcDownSince: snap.rpcDownSince?.toISOString() ?? null,
      secondsSinceLastRun: sinceLastRun !== null ? Math.floor(sinceLastRun / 1000) : null,
    },
  };
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  // Only one route — anything else is 404.
  if (req.url !== "/health" && req.url !== "/") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  const { status, body } = computeHealth();
  const code = status === "degraded" ? 503 : 200;
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export interface HealthServerHandle {
  server: Server;
  close: () => Promise<void>;
}

/**
 * Start the health server. Binds to 0.0.0.0 by default so Railway
 * (and any container orchestrator) can reach it.
 */
export function startHealthServer(
  opts: {
    port?: number;
    host?: string;
  } = {},
): Promise<HealthServerHandle> {
  const port = opts.port ?? Number(process.env.HEALTH_PORT ?? 3000);
  const host = opts.host ?? "0.0.0.0";

  return new Promise((resolve, reject) => {
    const server = createServer(handleRequest);
    server.once("error", reject);
    server.listen(port, host, () => {
      logger.info({ event_type: "health.listen", port, host }, "Health server listening");
      resolve({
        server,
        close: () =>
          new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
  });
}

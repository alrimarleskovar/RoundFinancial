/**
 * Healthcheck HTTP server — bare node:http, zero dependencies.
 *
 * Exposes:
 *   GET /health   → JSON · 200 if recent poll succeeded, 503 if stale
 *   GET /metrics  → Prometheus exposition format (text/plain)
 *
 * "Stale" = no successful poll in the last 5 minutes. Used by uptime
 * checks (UptimeRobot / Better Uptime / etc.) and by k8s liveness
 * probes if we ever containerize.
 *
 * Owner: Gabriel. This file is independent of the polling logic — it
 * just reads from CrankerState. Tests should mock the state object.
 */

import { createServer, type Server } from "node:http";

import type { Logger } from "./settler.js";
import type { CrankerState } from "./state.js";

const STALE_AFTER_MS = 5 * 60_000;

export function startHealthServer(state: CrankerState, port: number, log: Logger): Server {
  const server = createServer((req, res) => {
    const url = req.url ?? "/";

    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "text/plain" });
      res.end("method not allowed");
      return;
    }

    if (url === "/health") {
      const ageMs = state.lastPollAt == null ? Infinity : Date.now() - state.lastPollAt;
      const stale = ageMs > STALE_AFTER_MS;
      res.writeHead(stale ? 503 : 200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          {
            ok: !stale,
            startedAt: new Date(state.startedAt).toISOString(),
            uptimeSec: Math.floor((Date.now() - state.startedAt) / 1000),
            lastPollAt: state.lastPollAt ? new Date(state.lastPollAt).toISOString() : null,
            lastSuccessAt: state.lastSuccessAt
              ? new Date(state.lastSuccessAt).toISOString()
              : null,
            lastPollAgeSec: state.lastPollAt
              ? Math.floor((Date.now() - state.lastPollAt) / 1000)
              : null,
            pollsTotal: state.pollsTotal,
            candidatesDetected: state.candidatesDetected,
            settlementsAttempted: state.settlementsAttempted,
            settlementsSucceeded: state.settlementsSucceeded,
            settlementsFailed: state.settlementsFailed,
            lastError: state.lastError,
          },
          null,
          2,
        ) + "\n",
      );
      return;
    }

    if (url === "/metrics") {
      const ageSec = state.lastPollAt
        ? Math.floor((Date.now() - state.lastPollAt) / 1000)
        : -1;
      const lines = [
        `# HELP cranker_polls_total Total polling iterations`,
        `# TYPE cranker_polls_total counter`,
        `cranker_polls_total ${state.pollsTotal}`,
        `# HELP cranker_candidates_detected_total Settle candidates detected`,
        `# TYPE cranker_candidates_detected_total counter`,
        `cranker_candidates_detected_total ${state.candidatesDetected}`,
        `# HELP cranker_settlements_attempted_total settle_default calls attempted`,
        `# TYPE cranker_settlements_attempted_total counter`,
        `cranker_settlements_attempted_total ${state.settlementsAttempted}`,
        `# HELP cranker_settlements_succeeded_total settle_default calls confirmed`,
        `# TYPE cranker_settlements_succeeded_total counter`,
        `cranker_settlements_succeeded_total ${state.settlementsSucceeded}`,
        `# HELP cranker_settlements_failed_total settle_default calls failed (post-retry)`,
        `# TYPE cranker_settlements_failed_total counter`,
        `cranker_settlements_failed_total ${state.settlementsFailed}`,
        `# HELP cranker_last_poll_age_seconds Seconds since last poll attempt`,
        `# TYPE cranker_last_poll_age_seconds gauge`,
        `cranker_last_poll_age_seconds ${ageSec}`,
        ``,
      ];
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
      res.end(lines.join("\n"));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  server.listen(port, () => log(`healthcheck listening on :${port}`));
  return server;
}

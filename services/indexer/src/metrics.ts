/**
 * Prometheus metrics surface for the RoundFi indexer.
 *
 * Closes item #1 of `docs/observability/README.md` "Pre-deployment
 * readiness" — converts `/metrics` from JSON to Prometheus exposition
 * format so the alerts in `docs/observability/prometheus-alerts.yaml`
 * can scrape against real data instead of a stub.
 *
 * **Scope decision — what this module emits (Pass 1):**
 *
 * Only metrics derivable from the indexer's existing Prisma schema
 * (`Pool`, `Member`, `ContributeEvent`, `ClaimEvent`, `DefaultEvent`,
 * `IndexerCursor`). The exposition format migration is the gate
 * unblocker; metric coverage grows incrementally as data sources
 * are wired.
 *
 *   - `roundfi_indexer_last_slot` (gauge) — IndexerCursor.lastSlot.
 *     Pairs with Solana's own `solana_cluster_slot` to compute the
 *     `roundfi:indexer_lag_slots` recording rule and fire
 *     `IndexerLagHigh` alert.
 *   - `roundfi_indexer_last_update_timestamp_seconds` (gauge) — unix
 *     ts of the last cursor update. Detects a frozen indexer even if
 *     Solana's slot exporter is also stuck.
 *   - `roundfi_indexer_pool_count{status}` (gauge) — pool counts by
 *     status. Supports dashboards + cap-related sanity views.
 *   - `roundfi_indexer_member_count` (gauge) — total member rows.
 *   - `roundfi_indexer_event_count{kind}` (gauge, derived from
 *     SELECT COUNT) — total events by kind. Used to dashboard
 *     throughput.
 *   - `roundfi_reconciler_unresolved_count{table}` (gauge) — events
 *     with NULL `resolvedAt`. Powers the
 *     `roundfi:reconciler_unresolved_total` recording rule.
 *
 * **What this module does NOT emit (deferred):**
 *
 * Metrics from `docs/observability/prometheus-alerts.yaml` that
 * require data sources the indexer doesn't have today:
 *
 *   - `roundfi_protocol_config_hash`, `roundfi_protocol_paused`,
 *     `roundfi_committed_protocol_tvl_usdc`,
 *     `roundfi_max_protocol_tvl_usdc` — need a `ProtocolConfig` RPC
 *     fetch on each scrape (separate cron job, distinct lifecycle)
 *   - `roundfi_pool_usdc_vault_balance`,
 *     `roundfi_pool_accounted_balance` — per-pool RPC reads + DB
 *     join (reconciler-cron territory)
 *   - `roundfi_program_cpi_failed_total`,
 *     `roundfi_program_harvest_reverted_total`,
 *     `roundfi_principal_loss_total` — need failed-tx + event-kind
 *     tracking in the webhook handler (no schema columns today)
 *   - `roundfi_treasury_outflow_usdc_total` — needs treasury-flow
 *     event-stream wiring
 *
 * Each gap is filed as a TODO comment in the alert that depends on
 * it. The exposition format change here unblocks deployment of the
 * 4 alerts that DO have data (`IndexerLagHigh`, and the 3 derived
 * recording rules that don't fire on their own).
 */

import { Registry, Gauge, collectDefaultMetrics } from "prom-client";
import type { PrismaClient } from "@prisma/client";

// Dedicated registry so the indexer's metrics are isolated from any
// other library that might register globals. Also lets the unit test
// (when it lands) clear state between cases.
export const registry = new Registry();

// Default Node.js metrics — process_cpu_seconds_total, heap stats,
// event loop lag, GC pause histogram. Useful for ops dashboards
// independent of any RoundFi-specific data.
collectDefaultMetrics({ register: registry, prefix: "roundfi_indexer_node_" });

// ─── Metric instances ────────────────────────────────────────────────

const indexerLastSlot = new Gauge({
  name: "roundfi_indexer_last_slot",
  help: "Highest Solana slot the indexer has processed (from IndexerCursor). Pair with solana_cluster_slot to compute lag.",
  registers: [registry],
});

const indexerLastUpdateTimestampSeconds = new Gauge({
  name: "roundfi_indexer_last_update_timestamp_seconds",
  help: "Unix timestamp (seconds) of the most recent IndexerCursor update. Detects a frozen indexer even if the slot exporter is also stuck.",
  registers: [registry],
});

const indexerPoolCount = new Gauge({
  name: "roundfi_indexer_pool_count",
  help: "Count of indexed Pool rows by PoolStatus.",
  labelNames: ["status"] as const,
  registers: [registry],
});

const indexerMemberCount = new Gauge({
  name: "roundfi_indexer_member_count",
  help: "Total count of indexed Member rows.",
  registers: [registry],
});

const indexerEventCount = new Gauge({
  name: "roundfi_indexer_event_count",
  help: "Total count of indexed event rows by kind (contribute|claim|default).",
  labelNames: ["kind"] as const,
  registers: [registry],
});

const reconcilerUnresolvedCount = new Gauge({
  name: "roundfi_reconciler_unresolved_count",
  help: "Count of event rows where resolvedAt IS NULL, grouped by source table. Powers the roundfi:reconciler_unresolved_total recording rule.",
  labelNames: ["table"] as const,
  registers: [registry],
});

// ─── Scrape-time collection ─────────────────────────────────────────

/**
 * Refresh all DB-derived gauge values from Prisma, then return the
 * Prometheus exposition-format text. Called from the
 * `/metrics` Fastify handler.
 *
 * Each query is independent so a slow / failing one doesn't stall the
 * others. Errors per-metric are logged via `console.error` and the
 * gauge retains its previous value (better than crashing the scrape).
 *
 * Returns the full registry serialization as a string suitable for
 * `Content-Type: text/plain; version=0.0.4; charset=utf-8`.
 */
export async function collectIndexerMetrics(prisma: PrismaClient): Promise<string> {
  await Promise.allSettled([
    refreshCursorMetrics(prisma),
    refreshPoolMetrics(prisma),
    refreshMemberMetrics(prisma),
    refreshEventMetrics(prisma),
    refreshReconcilerMetrics(prisma),
  ]);

  return registry.metrics();
}

async function refreshCursorMetrics(prisma: PrismaClient): Promise<void> {
  try {
    const cursor = await prisma.indexerCursor.findFirst({
      orderBy: { updatedAt: "desc" },
    });
    if (cursor) {
      // BigInt → Number conversion: lastSlot is a slot number which
      // is safely under 2^53 for the foreseeable future (Solana's
      // current slot is ~3e8, 25 orders of magnitude away from the
      // f64 safe-integer ceiling).
      indexerLastSlot.set(Number(cursor.lastSlot));
      indexerLastUpdateTimestampSeconds.set(Math.floor(cursor.updatedAt.getTime() / 1000));
    } else {
      indexerLastSlot.set(0);
      indexerLastUpdateTimestampSeconds.set(0);
    }
  } catch (err) {
    console.error("[metrics] refreshCursorMetrics failed:", err);
  }
}

async function refreshPoolMetrics(prisma: PrismaClient): Promise<void> {
  try {
    const grouped = await prisma.pool.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    // Reset all known labels to 0 first so a status that used to
    // exist but doesn't anymore reports 0 instead of staying at its
    // last seen value (stale-gauge gotcha).
    for (const status of ["Forming", "Active", "Completed", "Liquidated", "Closed"]) {
      indexerPoolCount.set({ status }, 0);
    }
    for (const row of grouped) {
      indexerPoolCount.set({ status: row.status }, row._count._all);
    }
  } catch (err) {
    console.error("[metrics] refreshPoolMetrics failed:", err);
  }
}

async function refreshMemberMetrics(prisma: PrismaClient): Promise<void> {
  try {
    const count = await prisma.member.count();
    indexerMemberCount.set(count);
  } catch (err) {
    console.error("[metrics] refreshMemberMetrics failed:", err);
  }
}

async function refreshEventMetrics(prisma: PrismaClient): Promise<void> {
  try {
    const [contribute, claim, defaultEv] = await Promise.all([
      prisma.contributeEvent.count(),
      prisma.claimEvent.count(),
      prisma.defaultEvent.count(),
    ]);
    indexerEventCount.set({ kind: "contribute" }, contribute);
    indexerEventCount.set({ kind: "claim" }, claim);
    indexerEventCount.set({ kind: "default" }, defaultEv);
  } catch (err) {
    console.error("[metrics] refreshEventMetrics failed:", err);
  }
}

async function refreshReconcilerMetrics(prisma: PrismaClient): Promise<void> {
  try {
    const [contribute, claim, defaultEv] = await Promise.all([
      prisma.contributeEvent.count({ where: { resolvedAt: null } }),
      prisma.claimEvent.count({ where: { resolvedAt: null } }),
      prisma.defaultEvent.count({ where: { resolvedAt: null } }),
    ]);
    reconcilerUnresolvedCount.set({ table: "contribute_events" }, contribute);
    reconcilerUnresolvedCount.set({ table: "claim_events" }, claim);
    reconcilerUnresolvedCount.set({ table: "default_events" }, defaultEv);
  } catch (err) {
    console.error("[metrics] refreshReconcilerMetrics failed:", err);
  }
}

/**
 * Prometheus exposition format Content-Type — pinned to the version
 * the prom-client 15.x line emits. Drives the response header in the
 * Fastify route so scrapers parse correctly.
 */
export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

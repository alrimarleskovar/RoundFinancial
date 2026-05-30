# RoundFi Observability — Spec + Deploy Pack

> **Status:** specs ready, platform deployment pending. The 3 files in this directory are deployable artifacts (Grafana JSONs, Prometheus alert rules, PagerDuty runbook). Whoever stands up the actual platforms (Grafana Cloud + Loki + Prometheus + PagerDuty, OR Datadog) imports these directly. See [Issue #271](https://github.com/alrimarleskovar/RoundFinancial/issues/271) for procurement + DevOps onboarding.

## Why this exists

The team's mainnet-prep review flagged that we need alerts for: **config change, TVL cap, failed CPI, harvest revert, PrincipalLoss, vault mismatch, protocol pause, treasury changes** — 8 specific alerts. Plus 4 dashboards from issue #271 (indexer lag, reconciler `_unresolved` count, RPC quorum divergence, backfill cron health).

This package converts those requirements into concrete config that can be `kubectl apply -f` / Grafana imported / PagerDuty scripted when the platform exists.

## What's in here

| File                                                 | Purpose                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`grafana-dashboards.md`](./grafana-dashboards.md)   | 4 dashboard JSON specs — copy/paste into Grafana → Import dashboard                    |
| [`prometheus-alerts.yaml`](./prometheus-alerts.yaml) | 8 alert rules + 4 supporting recording rules. Drop into Prometheus' `rule_files:` path |
| [`pagerduty-runbook.md`](./pagerduty-runbook.md)     | Escalation matrix + on-call rotation + 8 alert response procedures (one per alert)     |

## Pre-deployment readiness

Before the platform stand-up, three gaps on the indexer side. **All three closed as of 2026-05-19** (Pass-14 observability scaffolding):

1. ~~**Migrate `/metrics` to Prometheus exposition format.**~~ ✅ **Done** — `services/indexer/src/server.ts` `/metrics` route now serves `prom-client` registry output with `Content-Type: text/plain; version=0.0.4`. Catalogued metrics in `services/indexer/src/metrics.ts`; Pass-1 surface covers `roundfi_indexer_last_slot`, `roundfi_indexer_last_update_timestamp_seconds`, `roundfi_indexer_pool_count{status}`, `roundfi_indexer_member_count`, `roundfi_indexer_event_count{kind}`, `roundfi_reconciler_unresolved_count{table}` + default Node.js runtime metrics under the `roundfi_indexer_node_` prefix. Alert-spec metrics that require RPC reads or webhook-handler instrumentation (config hash, protocol paused, TVL caps, CPI failure counters, principal-loss counter, treasury outflow, per-pool vault balances) are listed as deferred-with-source in the `metrics.ts` header docstring.

2. ~~**Emit structured logs in `services/indexer/src/reconciler.ts`.**~~ ✅ **Done** — new `services/indexer/src/log.ts` module emits the fixed-shape JSON `{ ts, level, service, msg, event_type?, slot?, signature?, error? }` plus arbitrary passthrough context. `reconciler.ts` + `backfill.ts` both migrated to use `createLogger({ service: "..." })` instead of free-text `console.log`. BigInts get stringified, errors get flattened to `{ name, message, stack }`. Pino migration option stays open — replace `createLogger()` with a pino instance + keep call sites untouched.

3. ~~**Add `getProgramAccounts` cron health metric.**~~ ✅ **Done** — new `BackfillRun` Prisma model (one row per `backfill.ts` invocation, status = `running` → `ok` | `error` on completion, with `startedAt`, `finishedAt`, `durationMs`, `poolsTouched`, `membersTouched`, `errorMessage` for audit history). Three new `/metrics` gauges in `services/indexer/src/metrics.ts`: `roundfi_indexer_last_backfill_run_timestamp_seconds` (most recent `startedAt`), `roundfi_indexer_last_backfill_status` (0=ok / 1=error / 2=running / 3=no-runs-yet), `roundfi_indexer_last_backfill_duration_ms` (capacity planning). The 3-status-code discrimination lets PromQL distinguish "cron failed" from "cron never ran" from "cron mid-flight" — different ops responses.

## Stack choice

Two options, both viable:

| Stack                                | Pros                                                         | Cost (year 1) |
| ------------------------------------ | ------------------------------------------------------------ | ------------- |
| **Grafana Cloud + Loki + PagerDuty** | Lowest cost, full self-host fallback available               | ~$200/mo      |
| **Datadog**                          | Turnkey, single vendor, better Solana ecosystem integrations | ~$600/mo      |

Recommendation: Grafana Cloud free-tier through canary, switch to Datadog if op velocity matters more than cost post-GA.

## Deployment one-liner sequence (when platform exists)

```bash
# 1. Import dashboards (Grafana CLI or UI)
grafana-cli dashboards import docs/observability/grafana-dashboards.md  # extract embedded JSON

# 2. Drop alerts into Prometheus
cp docs/observability/prometheus-alerts.yaml /etc/prometheus/rules/roundfi.yaml
sudo systemctl reload prometheus

# 3. Configure PagerDuty service + integration key, then update Alertmanager config
#    See pagerduty-runbook.md §"PagerDuty setup" for the exact 5-step flow

# 4. Smoke-test by triggering each alert manually (e.g. pause the protocol → alert fires → page goes out)
#    See pagerduty-runbook.md §"Tabletop drill" for the 30-min exercise
```

## SLO targets (post-canary)

| Metric                        | Target           | Source                                    |
| ----------------------------- | ---------------- | ----------------------------------------- |
| Indexer lag                   | ≤ 64 slots (p99) | `lastIndexedSlot` vs cluster current slot |
| Reconciler unresolved events  | ≤ 100 per table  | `_unresolved` row count                   |
| Webhook latency (Helius → DB) | ≤ 5s (p95)       | timestamp delta                           |
| Backfill cron success rate    | ≥ 99% / week     | `lastBackfillStatus` over 7d window       |
| PagerDuty P1 ack time         | ≤ 15min          | manual                                    |
| PagerDuty P1 mitigate time    | ≤ 60min          | manual                                    |

## See also

- [Issue #271](https://github.com/alrimarleskovar/RoundFinancial/issues/271) — observability stack tracking issue (pre-mainnet blocker)
- [`docs/operations/indexer-reorg-recovery.md`](../operations/indexer-reorg-recovery.md) — runbook the PagerDuty escalation links to
- [`services/indexer/src/server.ts`](../../services/indexer/src/server.ts) — `/metrics` + `/healthz` endpoints
- [`services/indexer/src/reconciler.ts`](../../services/indexer/src/reconciler.ts) — reconciler logic + structured logging touchpoints

# Grafana Dashboards — RoundFi Mainnet

> 4 dashboards per [Issue #271](https://github.com/alrimarleskovar/RoundFinancial/issues/271). Each JSON below is importable directly via Grafana UI: Dashboards → New → Import → paste JSON.
>
> Assumes Prometheus data source named `roundfi-prometheus`. Rename in `datasource.uid` if your source differs.
>
> The metric names assume the indexer migrates `/metrics` from JSON to Prometheus exposition format (see [`README.md`](./README.md)). Pre-migration, dashboards are spec-only.

## Dashboard 1: Indexer health

Tracks `lastIndexedSlot` lag against cluster current slot. Target: ≤ 64 slots (p99).

```json
{
  "dashboard": {
    "title": "RoundFi — Indexer Health",
    "tags": ["roundfi", "indexer", "mainnet"],
    "timezone": "UTC",
    "refresh": "30s",
    "time": { "from": "now-6h", "to": "now" },
    "panels": [
      {
        "id": 1,
        "title": "Indexer lag (slots)",
        "type": "timeseries",
        "gridPos": { "x": 0, "y": 0, "w": 24, "h": 8 },
        "targets": [
          {
            "expr": "roundfi:indexer_lag_slots",
            "legendFormat": "lag",
            "refId": "A"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "thresholds": {
              "mode": "absolute",
              "steps": [
                { "value": null, "color": "green" },
                { "value": 64, "color": "yellow" },
                { "value": 256, "color": "red" }
              ]
            },
            "unit": "short"
          }
        }
      },
      {
        "id": 2,
        "title": "Indexer cursor age (seconds since last update)",
        "type": "stat",
        "gridPos": { "x": 0, "y": 8, "w": 8, "h": 4 },
        "targets": [
          {
            "expr": "time() - roundfi_indexer_last_update_unix",
            "refId": "A"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "s",
            "thresholds": {
              "mode": "absolute",
              "steps": [
                { "value": null, "color": "green" },
                { "value": 30, "color": "yellow" },
                { "value": 120, "color": "red" }
              ]
            }
          }
        }
      },
      {
        "id": 3,
        "title": "Webhook latency (Helius → DB, p50/p95/p99)",
        "type": "timeseries",
        "gridPos": { "x": 8, "y": 8, "w": 8, "h": 4 },
        "targets": [
          {
            "expr": "histogram_quantile(0.50, roundfi_webhook_latency_seconds_bucket)",
            "legendFormat": "p50",
            "refId": "A"
          },
          {
            "expr": "histogram_quantile(0.95, roundfi_webhook_latency_seconds_bucket)",
            "legendFormat": "p95",
            "refId": "B"
          },
          {
            "expr": "histogram_quantile(0.99, roundfi_webhook_latency_seconds_bucket)",
            "legendFormat": "p99",
            "refId": "C"
          }
        ],
        "fieldConfig": { "defaults": { "unit": "s" } }
      },
      {
        "id": 4,
        "title": "Webhook ingest rate (events/sec)",
        "type": "timeseries",
        "gridPos": { "x": 16, "y": 8, "w": 8, "h": 4 },
        "targets": [
          {
            "expr": "rate(roundfi_webhook_events_received_total[1m])",
            "legendFormat": "events/s",
            "refId": "A"
          }
        ]
      }
    ]
  }
}
```

## Dashboard 2: Reconciler health

Tracks `_unresolved` row counts per event table. Target: ≤ 100 per table.

```json
{
  "dashboard": {
    "title": "RoundFi — Reconciler Health",
    "tags": ["roundfi", "reconciler", "mainnet"],
    "refresh": "1m",
    "time": { "from": "now-24h", "to": "now" },
    "panels": [
      {
        "id": 1,
        "title": "Unresolved events by table",
        "type": "timeseries",
        "gridPos": { "x": 0, "y": 0, "w": 24, "h": 8 },
        "targets": [
          {
            "expr": "roundfi:reconciler_unresolved_total",
            "legendFormat": "{{ table }}",
            "refId": "A"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "thresholds": {
              "mode": "absolute",
              "steps": [
                { "value": null, "color": "green" },
                { "value": 100, "color": "yellow" },
                { "value": 1000, "color": "red" }
              ]
            },
            "unit": "short"
          }
        }
      },
      {
        "id": 2,
        "title": "Reconciler run cadence (last successful run)",
        "type": "stat",
        "gridPos": { "x": 0, "y": 8, "w": 8, "h": 4 },
        "targets": [
          {
            "expr": "time() - roundfi_reconciler_last_run_unix",
            "refId": "A"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "s",
            "thresholds": {
              "mode": "absolute",
              "steps": [
                { "value": null, "color": "green" },
                { "value": 300, "color": "yellow" },
                { "value": 900, "color": "red" }
              ]
            }
          }
        }
      },
      {
        "id": 3,
        "title": "Reconciler errors (rate)",
        "type": "timeseries",
        "gridPos": { "x": 8, "y": 8, "w": 16, "h": 4 },
        "targets": [
          {
            "expr": "rate(roundfi_reconciler_errors_total[5m])",
            "legendFormat": "{{ error_class }}",
            "refId": "A"
          }
        ]
      }
    ]
  }
}
```

## Dashboard 3: RPC quorum + reorg surface

Tracks divergence between RPC providers (Helius, Triton, public). High divergence → potential reorg.

```json
{
  "dashboard": {
    "title": "RoundFi — RPC Quorum + Reorg",
    "tags": ["roundfi", "rpc", "mainnet"],
    "refresh": "1m",
    "time": { "from": "now-6h", "to": "now" },
    "panels": [
      {
        "id": 1,
        "title": "RPC quorum divergence (counter)",
        "type": "timeseries",
        "gridPos": { "x": 0, "y": 0, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "increase(roundfi_rpc_quorum_divergence_total[5m])",
            "legendFormat": "divergences/5m",
            "refId": "A"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "thresholds": {
              "mode": "absolute",
              "steps": [
                { "value": null, "color": "green" },
                { "value": 1, "color": "yellow" },
                { "value": 5, "color": "red" }
              ]
            }
          }
        }
      },
      {
        "id": 2,
        "title": "Confirmed-vs-finalized slot gap",
        "type": "timeseries",
        "gridPos": { "x": 12, "y": 0, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "solana_cluster_slot{commitment=\"confirmed\"} - solana_cluster_slot{commitment=\"finalized\"}",
            "legendFormat": "confirmed - finalized",
            "refId": "A"
          }
        ]
      },
      {
        "id": 3,
        "title": "Orphaned event rows",
        "type": "timeseries",
        "gridPos": { "x": 0, "y": 8, "w": 24, "h": 8 },
        "targets": [
          {
            "expr": "sum by (table) (roundfi_orphaned_events_count)",
            "legendFormat": "{{ table }}",
            "refId": "A"
          }
        ]
      }
    ]
  }
}
```

## Dashboard 4: Backfill cron health

Tracks the `getProgramAccounts` backfill cron — runs every 6h to catch any events the webhook missed.

```json
{
  "dashboard": {
    "title": "RoundFi — Backfill Cron Health",
    "tags": ["roundfi", "backfill", "mainnet"],
    "refresh": "5m",
    "time": { "from": "now-7d", "to": "now" },
    "panels": [
      {
        "id": 1,
        "title": "Last backfill run + status",
        "type": "stat",
        "gridPos": { "x": 0, "y": 0, "w": 12, "h": 4 },
        "targets": [
          {
            "expr": "time() - roundfi_backfill_last_run_unix",
            "legendFormat": "age (s)",
            "refId": "A"
          },
          {
            "expr": "roundfi_backfill_last_status",
            "legendFormat": "status (1=ok, 0=fail)",
            "refId": "B"
          }
        ],
        "fieldConfig": {
          "overrides": [
            {
              "matcher": { "id": "byName", "options": "age (s)" },
              "properties": [
                { "id": "unit", "value": "s" },
                {
                  "id": "thresholds",
                  "value": {
                    "mode": "absolute",
                    "steps": [
                      { "value": null, "color": "green" },
                      { "value": 21600, "color": "yellow" },
                      { "value": 43200, "color": "red" }
                    ]
                  }
                }
              ]
            }
          ]
        }
      },
      {
        "id": 2,
        "title": "Backfill events fetched (per run)",
        "type": "timeseries",
        "gridPos": { "x": 12, "y": 0, "w": 12, "h": 4 },
        "targets": [
          {
            "expr": "roundfi_backfill_events_fetched_total",
            "legendFormat": "events",
            "refId": "A"
          }
        ]
      },
      {
        "id": 3,
        "title": "Backfill success rate (7d window)",
        "type": "gauge",
        "gridPos": { "x": 0, "y": 4, "w": 12, "h": 4 },
        "targets": [
          {
            "expr": "rate(roundfi_backfill_runs_total{status=\"success\"}[7d]) / rate(roundfi_backfill_runs_total[7d])",
            "refId": "A"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "percentunit",
            "min": 0,
            "max": 1,
            "thresholds": {
              "mode": "absolute",
              "steps": [
                { "value": null, "color": "red" },
                { "value": 0.95, "color": "yellow" },
                { "value": 0.99, "color": "green" }
              ]
            }
          }
        }
      },
      {
        "id": 4,
        "title": "Backfill run duration (p95)",
        "type": "timeseries",
        "gridPos": { "x": 12, "y": 4, "w": 12, "h": 4 },
        "targets": [
          {
            "expr": "histogram_quantile(0.95, roundfi_backfill_duration_seconds_bucket)",
            "legendFormat": "p95",
            "refId": "A"
          }
        ],
        "fieldConfig": { "defaults": { "unit": "s" } }
      }
    ]
  }
}
```

## Importing into Grafana

For each dashboard above:

```bash
# UI flow
1. Grafana → Dashboards → New → Import
2. Paste the JSON between { "dashboard": ... } (skip the outer `{ "dashboard": ... }` wrapper if your Grafana version doesn't expect it — some do, some don't)
3. Select datasource: roundfi-prometheus
4. Save

# CLI flow (if you have grafana-toolkit or terraform-provider-grafana)
grafana-cli dashboards import dashboard-1-indexer.json
```

After import, link each dashboard to the corresponding `runbook_url` in [`prometheus-alerts.yaml`](./prometheus-alerts.yaml) by adding a panel-level annotation: Panel → Edit → Links → Add → URL: link to the relevant `pagerduty-runbook.md` section.

## See also

- [`README.md`](./README.md) — observability spec overview
- [`prometheus-alerts.yaml`](./prometheus-alerts.yaml) — alert rules feeding into PagerDuty
- [`pagerduty-runbook.md`](./pagerduty-runbook.md) — on-call response procedures

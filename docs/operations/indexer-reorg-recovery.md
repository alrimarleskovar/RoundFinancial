# Indexer Reorg Recovery — Operational Runbook

> **When to use this:** the `cross-validation found gaps` alert fires from
> the indexer reconciler, the indexer DB diverges from on-chain state,
> or you're investigating a "score is wrong" report from the B2B oracle
> consumer.
>
> **Author:** ops on-call. **Audience:** ops on-call.

## TL;DR

The indexer is **off the fund-movement trust path** (see
[`docs/security/self-audit.md` §2](../security/self-audit.md#2-trust-assumptions)).
No reorg can move user funds; the worst a reorg does to the indexer is
**misreport state** to downstream B2B oracle consumers. Recovery is
non-emergency in 99% of cases.

The reconciler daemon ([`services/indexer/src/reconciler.ts`](../../services/indexer/src/reconciler.ts))
runs continuously and auto-repairs most divergences. This runbook covers
the cases where manual intervention is required.

## Symptoms

| Alert / report                                      | Severity | Likely root cause                                                                      |
| --------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `cross-validation found gaps`                       | P3       | Helius webhook dropped a delivery; reconciler will catch up on next sweep              |
| `RPC quorum divergence`                             | P3       | One RPC provider is on a stale fork. Auto-defers until consensus.                      |
| `_unresolved` count grows monotonically             | P2       | Reconciler isn't running, or every event is stuck behind quorum. Check daemon liveness |
| User report: "score is wrong"                       | P2       | Indexer DB diverged. Run validation script (below).                                    |
| `event tx never finalized — marking orphaned` flood | P1       | Sustained reorg (rare). Pause B2B oracle until investigated.                           |

## Quick triage

1. **Check daemon health.**

   ```bash
   curl http://indexer/healthz
   curl http://indexer/metrics    # lastIndexedSlot vs cluster slot
   ```

   Gap between `lastIndexedSlot` and on-chain `getSlot` finalized should
   be **≤ 64 slots** (~30s). Larger gap → daemon is stalled or restarting.

2. **Count `_unresolved` rows.**

   ```sql
   SELECT
     (SELECT COUNT(*) FROM contribute_events WHERE pool_id = '_unresolved') AS contribute,
     (SELECT COUNT(*) FROM claim_events       WHERE pool_id = '_unresolved') AS claim,
     (SELECT COUNT(*) FROM default_events     WHERE pool_id = '_unresolved') AS def;
   ```

   Healthy: < 50 per table (these are events written in the last 30s
   waiting for the next reconciler pass). Unhealthy: > 1000 in any
   table — reconciler stalled.

3. **Trigger a manual reconciler pass.**

   ```bash
   cd services/indexer
   pnpm reconcile:once
   ```

   The `--once` flag runs a single pass and exits. Output JSON shows
   `reconciled / orphaned / pending / divergences` counters.

4. **Trigger a manual cross-validation sweep.**

   The cross-validation runs every 5min in the daemon; force it via:

   ```bash
   # Restart the daemon — startup fires both reconciler + cross-validation
   # passes immediately.
   systemctl restart roundfi-indexer
   ```

## Reorg event (P1)

Symptom: `event tx never finalized` warnings firing repeatedly for events

> 256 slots old, OR multiple txs reported as orphaned in the last hour.

### Step 1 — Identify scope

```sql
-- Recent events flagged for finality but never resolved
SELECT tx_signature, slot, block_time, pool_id
FROM contribute_events
WHERE pool_id = '_unresolved' AND slot < (SELECT MAX(slot) - 256 FROM contribute_events)
ORDER BY slot DESC
LIMIT 50;
```

If multiple txs cluster around a specific slot range, the cluster was
likely affected by a localized reorg.

### Step 2 — Verify on-chain truth

For each orphaned tx, query the canonical RPC:

```bash
for sig in $(psql -At ...); do
  solana confirm $sig --url https://api.mainnet-beta.solana.com
done
```

- `Status: Finalized` → indexer is wrong, force re-fetch
- `Not Found` or `Pending` → tx truly never landed; orphaning is correct
- `Confirmed but not Finalized` → wait; finality usually lands within 64 slots

### Step 3 — Pause B2B oracle (P1 only)

If > 5% of recent events are orphaned, the B2B oracle's score reads are
potentially poisoned. Pause read traffic:

```bash
# Implementation pending — placeholder for the B2B oracle service
curl -X POST http://b2b-oracle/admin/pause -H "Authorization: $ADMIN_TOKEN"
```

(The B2B oracle endpoint is not shipped yet — when it ships, this section
gets a real command.)

### Step 4 — Re-backfill the affected slot range

```bash
cd services/indexer
DATABASE_URL=... ROUNDFI_CORE_PROGRAM_ID=... SOLANA_RPC_URL=... pnpm backfill
```

The backfill is idempotent — it overwrites `_unresolved` rows for
finalized txs. Use the canonical RPC (NOT Helius) to avoid Helius-side
stale data.

### Step 5 — Diff against the ledger

After backfill, run validation script:

```sql
-- For every member, compare on-chain contributions count vs indexer's count
SELECT
  m.wallet,
  m.contributions_paid AS chain_count,
  (SELECT COUNT(*) FROM contribute_events ce WHERE ce.member_id = m.id) AS indexer_count
FROM members m
WHERE m.contributions_paid != (SELECT COUNT(*) FROM contribute_events ce WHERE ce.member_id = m.id);
```

Any row returned means the indexer is still wrong for that member. Hand
those to the eng team for manual fix.

### Step 6 — Resume B2B oracle

After validation comes back clean:

```bash
curl -X POST http://b2b-oracle/admin/resume -H "Authorization: $ADMIN_TOKEN"
```

Write a postmortem using [`docs/operations/incident-template.md`](./incident-template.md).

## RPC quorum divergence (P3)

Symptom: `RPC quorum divergence` warning in the reconciler logs.

### Investigation

1. Identify which RPC providers were polled:

   ```bash
   echo "$SOLANA_RPC_URL"               # primary
   echo "$SOLANA_RPC_URLS_SECONDARY"    # secondaries (comma-separated)
   ```

2. Check the canonical Solana ecosystem status page:
   - [Solana Status](https://status.solana.com/)
   - Provider-specific status pages (Helius, Triton, QuickNode)

3. If one provider is misbehaving, remove from `SOLANA_RPC_URLS_SECONDARY`
   and restart the indexer. The reconciler will defer until next pass.

### When to escalate

- Quorum divergence persists > 10min across multiple txs → escalate to
  P2 and contact the RPC providers.
- All RPCs disagree → either we're on a fork or there's a Solana-wide
  consensus issue. Check Solana status page first; if confirmed, pause
  the B2B oracle.

## Webhook gap (P3)

Symptom: `cross-validation gap — signature on chain but no event row`
in the reconciler logs.

### Resolution

Webhook gaps usually self-heal on the next backfill. If they persist:

1. Check Helius webhook delivery stats from the Helius dashboard
2. If Helius shows successful deliveries but DB has no row, the webhook
   handler is dropping requests. Check Fastify error logs
3. If Helius shows failed deliveries, contact Helius support or rotate
   the webhook URL

## Reconciler not running (P2)

Symptom: `_unresolved` rows growing without bound; `lastUpdatedAt` in
`/metrics` is stale.

### Resolution

```bash
# Check daemon process
systemctl status roundfi-indexer-reconciler

# Restart if dead
systemctl restart roundfi-indexer-reconciler

# Check logs
journalctl -u roundfi-indexer-reconciler --since "1h ago"
```

Common failure modes:

- **Database connection lost** — Prisma error. Verify `DATABASE_URL` +
  Postgres reachability.
- **RPC unreachable** — verify `SOLANA_RPC_URL` reachable from the
  daemon's network.
- **Out of memory** — Helius bursts can spike the indexer's RSS. Check
  systemd memory limits + scale up if needed.

## Related docs

- [`docs/security/indexer-threat-model.md`](../security/indexer-threat-model.md) — full threat model
- [`services/indexer/README.md`](../../services/indexer/README.md) — indexer architecture
- [`docs/operations/incident-template.md`](./incident-template.md) — postmortem template
- Issue [#234](https://github.com/alrimarleskovar/RoundFinancial/issues/234) — the implementation this runbook covers

---

_Last updated: May 2026. Update whenever reconciler behavior changes._

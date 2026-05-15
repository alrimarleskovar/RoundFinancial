# RoundFi — Indexer Threat Model

> **Scope:** the off-chain indexer at `services/indexer/` — Helius webhook ingestion, Postgres event store, backfiller, future reconciler, future B2B oracle endpoint. **Never on the fund-movement trust path** ([`self-audit.md §2`](./self-audit.md#2-trust-assumptions) "trust assumptions"). This doc consolidates indexer-specific threats previously scattered across `self-audit.md` §3.4 + §7 and `adversarial-threat-model.md` §6.
>
> **Why this doc exists:** the indexer is **out of scope** for the on-chain audit (per [`AUDIT_SCOPE.md`](../../AUDIT_SCOPE.md) — "off-chain Helius webhook + Postgres backfiller; never on the fund-movement trust path"). But it is **in scope** for product correctness: the B2B oracle (Phase 3) reads from this DB. If the indexer is wrong, the score is wrong, and that's the entire Phase-3 revenue thesis.

**Today's posture:** scaffold landed · Fastify + Helius webhook + Prisma + Postgres · idempotent via `txSignature` UNIQUE · accepts dangling FK rows pending reconciler · NOT running on a real cluster yet · NO reconciler · NO B2B endpoint.

**Mainnet GA dependency:** Cross-referenced from [`MAINNET_READINESS.md §5.1–5.2`](../../MAINNET_READINESS.md). Reconciler under hostile RPC reorg is a hard gate for B2B Phase-3.

---

## 1. Trust boundary

| Layer                   | Trust model                                                                                 | What can go wrong                                  |
| ----------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Solana ledger**       | Trusted (validators, BPF execution, signer verification)                                    | Reorg up to finality (rare, bounded)               |
| **Helius webhook**      | Best-effort delivery, transport over HTTPS, sender authenticity via shared secret           | Spoofed POST, replay, late delivery, missed events |
| **RPC (backfill path)** | Trusted on cluster identity (devnet/mainnet); not trusted on data freshness or completeness | Stale reads, partial responses, hostile-fork data  |
| **Indexer process**     | Single-tenant; reads webhook + RPC, writes Postgres                                         | Bug, OOM, deadlock                                 |
| **Postgres**            | Trusted at OS level; row-level data integrity via Prisma schema                             | Corruption, replication lag, manual edits          |
| **B2B oracle (future)** | Reads from Postgres; writes nothing back                                                    | Returns wrong score → caller makes wrong decision  |

**Critical:** Nothing in this stack moves user funds. A compromised indexer cannot drain a pool, cannot grant reputation, cannot fake an attestation. It can only **misreport state** to downstream consumers.

---

## 2. Threat model

### 2.1 Ingestion-layer threats (webhook path)

| #   | Threat                               | Vector                                                                                                                   | Impact                                                                                | Mitigation status                                                                                                            |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| I1  | **Spoofed webhook POST**             | Attacker POSTs fake `contribute` events to `/webhook/helius`; if no auth, indexer writes phantom rows                    | DB pollution; B2B oracle reports fake scores                                          | 🔵 **Pending** — shared-secret header check in `services/indexer/src/server.ts` (not yet wired)                              |
| I2  | **Webhook replay**                   | Adversary records a real webhook POST + replays it                                                                       | Idempotent — `txSignature UNIQUE` on event tables; same row updated, no double-count  | ✅ Shipped — `webhook.ts:80` upsert pattern, `prisma/schema.prisma:152` UNIQUE constraint                                    |
| I3  | **Failed-tx ingestion**              | Webhook delivers an Anchor-reverted tx (e.g., `EscrowLocked`); indexer treats it as accepted state                       | Wrong member status                                                                   | ✅ Shipped — `webhook.ts:51-58` rejects `transactionError` set                                                               |
| I4  | **Out-of-order delivery**            | Helius retries deliver `claim_payout(cycle=2)` before `contribute(cycle=2)`; cursor jumps ahead, events arrive backwards | Pool state cache inconsistent until reconciler runs                                   | 🟡 **Partial** — events written with correct `slot` + `blockTime`; reconciler joins them. Reconciler not yet shipped         |
| I5  | **Missed event (silent drop)**       | Helius drops a delivery; webhook secret rotation mid-flight; network blip                                                | Pool state cache stale; B2B oracle under-reports until backfiller next sweep          | 🟡 **Partial** — backfiller resyncs from chain state; window is `cron-interval` long. Alerting on cursor-lag not yet shipped |
| I6  | **DoS via spam events**              | Attacker spams cheap tx with logs that match parser patterns                                                             | Indexer CPU saturation; insert queue backs up; webhook 5xx → Helius retries → cascade | 🔵 **Pending** — rate-limit on Fastify (per-IP + per-program-id); pre-parse log allow-list                                   |
| I7  | **Log injection / parser confusion** | Adversary submits a tx with a `msg!` that looks like a `Contribute` event but is from a different program                | Parser writes a phantom event with wrong pool/member                                  | ✅ Partial — `decoder.ts` parses by structured log prefix; not the `program_id` itself. Should add program-id check          |

### 2.2 Reorg + replay threats (chain consistency)

| #   | Threat                                         | Vector                                                                                                                         | Impact                                                                  | Mitigation status                                                                                                                                                                                                                                                                  |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Reorg orphans a "landed" event**             | Webhook delivers tx at slot S; later S' replaces S in finalized chain; event row now references a non-existent tx              | DB has phantom row; B2B oracle includes it in score                     | ✅ **Shipped (#234)** — finality gate (32-slot wait), orphan-marking after 256-slot grace, Prisma `orphaned: bool` column with `@@index([orphaned, slot])` on all 3 event tables, and reconciler `UPDATE` path that writes the flag. B2B oracle reads filter `WHERE NOT orphaned`. |
| R2  | **Hostile RPC during backfill**                | Backfiller queries a malicious RPC; RPC returns subset of pools, lies about balances                                           | Pool state cache is wrong; reconciler doesn't notice (no second source) | 🟡 **Partial** — multi-RPC quorum logic shipped for finality checks in `reconciler.ts`. Quorum on backfiller path is the next layer; tracked under #234.                                                                                                                           |
| R3  | **Confirmed-but-not-finalized window exploit** | User flow exploits a tx that's confirmed for 30s then dropped on reorg; B2B oracle reads "confirmed" data, returns wrong score | Downstream lending decision based on transient state                    | 🟡 **Partial** — reconciler now only joins canonical rows after `finalized` commitment confirmed by quorum. B2B oracle reads from canonical rows only.                                                                                                                             |
| R4  | **Slot-bitmap desync after reorg**             | `pool.slotsBitmapHex` is rewritten by every event; reorg leaves stale bitmap                                                   | Front-end reads wrong "available slots" — UX bug, not fund risk         | 🔵 **Pending** — full Pool refresh after each reorg notification; pool-PDA last-update timestamp                                                                                                                                                                                   |

### 2.3 Storage + reconciler threats

| #   | Threat                                | Vector                                                                                                           | Impact                                             | Mitigation status                                                                                                 |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| S1  | **DB corruption / manual edit**       | Operator runs `UPDATE attestations SET subject = ...`; or restoration from old backup                            | Score is wrong; oracle returns stale data          | 🔵 **Pending** — append-only event tables + hash-chained reconciler output ledger; daily snapshot diff            |
| S2  | **SQL injection via webhook payload** | Parser passes user-controlled bytes to a raw SQL query                                                           | DB takeover                                        | ✅ Shipped — all writes via Prisma (parameterized); no raw SQL in `webhook.ts` / `backfill.ts`                    |
| S3  | **Reconciler race with backfill**     | Backfill upserts Pool at the same instant as webhook upserts dependent event; reconciler picks one or both wrong | Pool state row briefly inconsistent with event log | 🟡 **Partial** — Prisma upsert is atomic per-row; cross-row reconciler is the gap. Needs serial-isolation pattern |
| S4  | **Dangling FK accumulation**          | Events write `poolId = "_unresolved"`; if reconciler is down for days, table size grows; vacuum can't reclaim    | Disk fill; slow queries                            | 🔵 **Pending** — reconciler heartbeat; alert on `_unresolved` count > threshold                                   |
| S5  | **Backfill OOM on large pools**       | Mainnet pool with 10k+ attestations → `getProgramAccounts` returns megabytes; indexer OOMs mid-decode            | Backfill incomplete; partial DB state              | 🔵 **Pending** — paginated fetch with bounded memory; chunked upsert                                              |

### 2.4 Privacy + compliance

| #   | Threat                                     | Vector                                                                                               | Impact                                    | Mitigation status                                                                                       |
| --- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| P1  | **PII leak via wallet → identity mapping** | If PoP layer is enabled (Civic / future), wallet ↔ real-world identity is in the indexer DB          | LGPD/GDPR violation; targeted phishing    | 🔵 **Pending** — separation: identity service ≠ indexer DB; PII in encrypted store with stricter access |
| P2  | **Score query log retention**              | B2B oracle logs every query (subject, requester, timestamp); log retention is itself a privacy issue | Behavioral profile leak                   | 🔵 **Pending** — retention policy at B2B endpoint design time                                           |
| P3  | **Wallet enumeration via B2B endpoint**    | Attacker queries B2B oracle for 1M wallets to harvest population score distribution                  | Cohort statistics leak; competitive intel | 🔵 **Pending** — auth-gated B2B endpoint; rate-limit per subscriber                                     |

---

## 3. Already-shipped mitigations (verifiable in repo today)

| Mitigation                                      | Where                                                                                                          | Notes                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Idempotent event ingestion                      | [`services/indexer/src/webhook.ts:80,103,118`](../../services/indexer/src/webhook.ts)                          | All three event tables use `upsert` keyed on `txSignature UNIQUE` from `prisma/schema.prisma`                       |
| Failed-tx filter                                | [`webhook.ts:51-58`](../../services/indexer/src/webhook.ts)                                                    | `tx.transactionError` short-circuits with `reason: "tx_failed"` — doesn't pollute the event store                   |
| Parameterized writes (no SQL injection surface) | [`webhook.ts`](../../services/indexer/src/webhook.ts), [`backfill.ts`](../../services/indexer/src/backfill.ts) | All DB access via Prisma; no `$queryRaw` / no string-concat SQL                                                     |
| Indexer cursor for restart-safety               | [`webhook.ts:145-156`](../../services/indexer/src/webhook.ts) + `IndexerCursor` model                          | Tracks `lastSlot` + `lastSig` per `programId`; restart resumes without re-processing                                |
| Append-only event tables                        | `prisma/schema.prisma:148-212`                                                                                 | `ContributeEvent` / `ClaimEvent` / `DefaultEvent` have no `UPDATE`-only fields; mutations through `Pool` / `Member` |
| Denormalized event ↔ canonical separation       | [`webhook.ts:84-87` (placeholder FK note)](../../services/indexer/src/webhook.ts)                              | Webhook accepts `poolId = "_unresolved"` so ingestion isn't blocked by missing canonical row; reconciler joins them |
| Indexer is **not** on the trust path            | [`self-audit.md §2`](./self-audit.md#2-trust-assumptions)                                                      | Stated in trust assumptions — the front-end reads on-chain directly today; indexer is a future-state read replica   |

---

## 4. Hard mainnet blockers (⛔) — required for B2B Phase 3

These **must** ship before the B2B oracle endpoint takes its first paid query.

### 4.1 Reconciler under reorg + replay

- ✅ **Reconciler service** that joins `_unresolved` event rows ↔ canonical Pool/Member rows after the finality gate (32 slots) + canonical PDA resolution via tx-account-list intersection. Shipped in [`reconciler.ts`](../../services/indexer/src/reconciler.ts) — see issue [`#234`](https://github.com/alrimarleskovar/RoundFinancial/issues/234). Loops cover all 3 event tables (contribute, claim, default) with per-table orphan accounting.
- ✅ **Reorg-aware orphan flag** — `orphaned: bool` column on every event table; reconciler sets `orphaned = true` when a tx fails to finalize past the 256-slot grace window. `@@index([orphaned, slot])` keeps orphan-triage SQL fast.
- ✅ **Multi-RPC quorum (finality path)** — finality status decided by ≥ ⌈N/2⌉ RPC providers; divergences logged + reconciliation deferred. Configured via `SOLANA_RPC_URLS_SECONDARY`.
- 🔵 **Finalize-only ingestion path for B2B** — `resolvedAt: DateTime?` column shipped on every event table; the B2B oracle's canonical-read query filters `WHERE resolvedAt IS NOT NULL AND NOT orphaned`. Endpoint surface itself is Phase-3 design (not in this PR).
- 🔵 **Multi-RPC quorum (backfill path)** — backfill still uses single RPC. Separate ticket — small risk surface because backfill writes only canonical Pool/Member rows, not event rows that flow into scores.

### 4.2 Webhook auth + abuse control

- ⛔ **Shared-secret HMAC** on every Helius POST — verified in `webhook.ts` before any parsing
- ⛔ **Rate-limit** per source IP + per program-id (Fastify rate-limit plugin)
- ⛔ **Program-id allow-list** — only accept events for `roundfi-core` / `roundfi-reputation` program IDs (today: parser is permissive)

### 4.3 Operational visibility

- ⛔ **Cursor-lag alerting** — if `IndexerCursor.lastSlot` falls > 100 slots behind RPC tip, page on-call
- ⛔ **Unresolved-FK alerting** — if `_unresolved` count > N for > M minutes, alert
- ⛔ **Disk + DB-size budget** — alert at 70% before storage exhaustion

### 4.4 PII / identity boundary

- ⛔ Indexer DB **must not** contain wallet ↔ real-identity mapping. Identity-service DB is separate, encrypted at rest, behind stricter access controls
- ⛔ B2B oracle queries return **score** but not **transaction history** (the dataset is too revealing for population-scale queries)

---

## 5. Recommended hardening (post-canary, pre-mass-rollout)

These improve posture but are not first-day B2B-launch blockers.

### 5.1 Defensive consistency

- 🔵 **Daily snapshot diff** — full state dump compared against on-chain `getProgramAccounts` snapshot; divergence triggers reconciler rerun
- 🔵 **Hash-chained reconciler output** — each batch produces a Merkle root posted to a public log (Twitter/GitHub release) so external observers can verify
- 🔵 **Backup + point-in-time recovery** — WAL archive; tested restore drill quarterly

### 5.2 Query API hardening

- 🔵 **B2B oracle auth** — JWT tokens with per-subscriber rate limits + audit log of all queries
- 🔵 **Query scoping** — subscribers can query subjects they've registered consent for, not arbitrary wallets
- 🔵 **Score versioning** — every B2B response carries `score_version` so callers can pin to a model

### 5.3 Operational

- 🔵 **Read-replica for B2B reads** — writes go to primary; B2B reads go to a replica with finalized-only filter
- 🔵 **Indexer canary** — pre-prod indexer mirrors prod and is sanity-checked against on-chain hourly
- 🔵 **Runbook** — incident response for "indexer diverged from chain" (current state: not written)

---

## 6. Out of scope for this doc

- **Fund movement safety** — the indexer cannot touch funds. Covered by the on-chain audit ([`AUDIT_SCOPE.md`](../../AUDIT_SCOPE.md)).
- **MEV / front-running** — affects the ledger before the indexer sees it. Covered by [`mev-front-running.md`](./mev-front-running.md) (planned).
- **Front-end attacks** — covered by [`frontend-security-checklist.md`](./frontend-security-checklist.md).
- **Adversarial actors at protocol level** (Sybil, ordering games) — covered by [`adversarial-threat-model.md`](./adversarial-threat-model.md).
- **B2B oracle product design** — pricing, schema versioning, subscriber agreements — separate doc, not security-scoped.

---

## 7. Methodology gaps (honest framing)

- **No fuzzing of the decoder.** `decoder.ts` parses `msg!` log lines; we don't yet have a property-based test that throws random bytes at it.
- **No reorg simulation in CI.** The integration tests don't exercise "tx confirmed at slot S, orphaned at slot S+3" because bankrun / solana-test-validator don't synthesize reorgs.
- **No multi-RPC divergence test.** Assumed RPC honesty is a known gap; hard-coded in current backfiller.
- **No load test.** We haven't hammered the webhook endpoint at 1k events/sec; ingestion latency under load is unknown.
- **No game-theoretic model of B2B oracle responses.** What happens when the score itself becomes the input to a feedback loop (lenders → repayment → score)?

These gaps are the items I'd want a security firm to focus on for the **off-chain** review pass, separate from the on-chain audit.

---

_Last updated: May 2026. Cross-ref: [`MAINNET_READINESS.md §5.2`](../../MAINNET_READINESS.md), [`self-audit.md §2 + §7`](./self-audit.md), [`adversarial-threat-model.md §6`](./adversarial-threat-model.md), `services/indexer/README.md`._

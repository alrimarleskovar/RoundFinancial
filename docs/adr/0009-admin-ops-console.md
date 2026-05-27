# ADR 0009 — Operational admin console (`/admin/ops`) for the devnet canary

**Status:** 🟡 Proposed
**Date:** 2026-05-27
**Decision-makers:** Engineering (canary)
**Related:** Indexer score-fields migration (`services/indexer/prisma/migrations/2026-05-canary-score-fields-options/`), ADR [0002](./0002-idl-free-sdk-encoders.md) (IDL-free decoders), ADR [0005](./0005-indexer-finality-gate.md) (reconciler finality gate), `MAINNET_READINESS.md` §6.1 (attestation as "credit data").

## Context

RoundFi needs an internal **operational console** for the devnet canary — a read-only "black box recorder" over protocol reputation: pool health, per-cycle behavior, user behavioral profiles, and an exportable event log. This is the moat (the behavioral credit dataset), so it must be access-gated and must never tell a different story than the chain.

Starting state (verified):

- `/admin` today is a **Demo Studio** (video-recording sandbox, isolated fake state) and `/admin/cranker` is the permissionless `settle_default` operator surface. Neither is an operational console.
- The indexer exposes only `/healthz`, `/metrics` (Prometheus), `/webhook/helius`. **No read API.** The app does not consume the indexer and has **no `/api` routes**.
- The app connects a wallet via `@solana/wallet-adapter` but performs **no signature verification** and has **no admin concept**. `ProtocolConfig.authority` is decodable via `sdk/src/reads.ts`.
- The Prisma schema has three typed event tables (`ContributeEvent` / `ClaimEvent` / `DefaultEvent`). The behavioral fields `due_at` / `delta_seconds` / `grace_used` / `default_reason` **do not exist yet** — they are pre-written in the pending score-fields migration (Option B, 7 fields).
- The reconciler (ADR 0005) is the **only** path by which a webhook event becomes canonical state: it sets `resolvedAt` after a 32-slot finality gate + canonical PDA join, and marks `orphaned = true` when a tx fails to finalize past `ORPHAN_GRACE_SLOTS` (256).

## Decision

We will build a read-only operational console at **`/admin/ops`**, backed by a canonical normalized event table, gated by server-side wallet auth, fed by the indexer (history) + RPC (live state), with all behavioral definitions sourced from one shared module.

### 1. Auth — SIWS against an allowlist, gate on the endpoints

Sign-In-With-Solana: connect wallet → server issues a nonce → client signs → a Next.js route handler **verifies the signature server-side** → authorizes the pubkey against an allowlist (seeded with `ProtocolConfig.authority` + an env list of extra operators) → issues a short-lived `httpOnly` session cookie.

**Non-negotiable:** the gate lives on the **endpoints** (route handlers verify the session), not in the UI. Hiding a screen does not count — we treat the repo as public, so security never depends on obscurity. Behavioral profiles / derived data are served only behind this gate (they are "credit data" under LGPD/GDPR/FCRA — see `MAINNET_READINESS.md` §6.1).

**Acceptable shortcut for the FIRST vertical slice only:** deploy-level protection (Vercel Access / basic-auth) also gates the endpoints and is real auth — but SIWS is the target and must not be deferred past the first slice.

### 2. One canonical `events` table + Option B fields + `details` JSONB

A single normalized `events` table is the base record; metrics / profiles / insights are **views** over it. Columns (Recommendation 1 + Option B):

`subject_wallet, pool, cycle, slot_index, event_type (contribute|claim|default), on_chain_ts, due_ts, delta_seconds, grace_used, default_reason?, tx_sig, slot_number, orphaned, resolved_at, details JSONB`.

- Type-specific payload (e.g. payout `credit` / `retained_at_payout`, seizure cascade breakdown) lives in `details` JSONB.
- `due_ts` / `delta_seconds` / `grace_used` are **pure functions** of `(event, on-chain schedule)` — never write-once. The table is **rebuildable from chain via backfill**.
- The three typed tables become **views** over `events` (or SDK helpers) so existing consumers keep working.
- **Fallback** (if rewriting the decoder/webhook write-path proves invasive): keep the typed tables as the ingestion + reconciliation surface and **derive** `events` from them — still backfill-rebuildable, but accepting some drift surface. Attempt the collapse first; the cost of touching the reconciler's three per-table functions + the webhook `_unresolved` fast-path is the cut criterion.

### 3. Next.js route handlers (`app/api/admin/**`) are the sole backend

The console calls only its own same-origin API; **never RPC/DB from the frontend**. Each handler: (1) enforces the §1 gate, (2) reads the indexer Postgres via a shared Prisma client for history / derived metrics, (3) calls RPC via `sdk/src/reads.ts` for live PDA state, (4) labels staleness ("indexer N slots behind").

Explicit split: **historical / behavioral ← indexer DB; live pool/member status ← fresh RPC.** Cross-check 1–2 aggregates against RPC each load (SSOT anti-drift discipline). The indexer remains the owner of ingestion/DB; the app reads the same DB via Prisma (monorepo — simpler than exposing an indexer read API).

### 4. Namespace — new `/admin/ops`, do not touch the studio

Operational console at `/admin/ops` (+ `/ops/pools`, `/ops/users`, `/ops/events`). The Demo Studio and `/admin/cranker` stay where they are; `/admin` may become a hub linking the three. The studio uses isolated fake state; the console uses real indexer data — separating by namespace **and** data path makes the "real vs demo" boundary (Recommendation 4) structural, not just visual. The cranker (`settle_default`) is the only action surface and stays separate, clearly marked as privileged — it never merges with the read-only console.

### 5. Behavioral definitions — one shared module, mirroring the chain

`sdk/src/behavioral.ts` is the single definition imported by both the indexer and the app (verified: both depend on `@roundfi/sdk`). Mirrors the program exactly:

- `due_ts(c) = started_at + (c + 1) * cycle_duration` for 0-indexed cycle `c`; **undefined while `started_at == 0`** (Forming / pre-Active). This equals the program's `next_cycle_at` while `current_cycle == c` — verified against `join_pool.rs:302-307` (activation: `next_cycle_at = started_at + cycle_duration`) and `claim_payout.rs:185-189` / `skip_defaulted_payout.rs:88-90` (each advance `+= cycle_duration`).
- `on_time = on_chain_ts <= due_ts` (inclusive) — `contribute.rs:181`.
- `grace_used = due_ts < on_chain_ts < due_ts + GRACE_PERIOD_SECS` (open interval; the `due_ts + GRACE` boundary is default-eligible, not grace). Boolean sub-flag of "late", not a third on-chain state.
- `default eligible = now >= next_cycle_at + GRACE && contributions_paid < current_cycle && !defaulted` — `settle_default.rs:160-172`.
- `GRACE_PERIOD_SECS = 604_800` (7d) — `constants.rs:49`, sourced via `CRANK_DEFAULTS.defaultGraceSec`.
- The score / level shown is the **on-chain** `ReputationProfile`. Derived axes (Reliability / Consistency / Recovery / Commitment) are labeled **"experimental"** — never presented as canonical score.

Validated by `tests/behavioral.spec.ts` (exact-value parity, including iterated-advance cross-check).

### Amendments folded in (this is what "do it right" means here)

- **(2) `due_ts` corrected to `(c + 1)`** and undefined pre-Active — an earlier draft used `c * cycle_duration`, which is one cycle early and would mark every payment late.
- **(2) Phase-0 smoke asserts EXACT values:** take a real devnet contribution and confirm the computed `due_ts == next_cycle_at` for that cycle on-chain, and that `delta_seconds` / `grace_used` match. "Field populated" is **not** a passing criterion.
- **(3a) Composite unique `(tx_sig, event_type)`** on `events` — not `tx_sig` alone: a claim both pays and advances the cycle in one tx, and it keeps Helius redelivery idempotent.
- **(3b) `default_reason` is INFERRED by the indexer**, not on-chain fact. The contract records no reason — `settle_default` only seizes the `missed` installment. Provenance is marked `inferred` and never displayed as an on-chain fact. Inference rules:
  - `MissedDeadline` — base case: a `settle_default` event exists, whose on-chain precondition IS missed-deadline + elapsed grace. Default for every settle event.
  - `InsufficientStake` / `SolvencyGuardTriggered` — refinement when the Triple-Shield cascade could not cover the missed amount (e.g. `d_rem > 0` after all three shields exhausted).
  - `EscapeValveLeavingDefault` — inferred from an `escape_valve_buy` on a member who was in default (distinct code path, not `settle_default`).
  - `Other` — fallback; auditing should drive this toward zero.
- **(3c) Event export is behind auth + an audit log** (who exported what, when).
- **(3d) `orphaned` / `resolved_at` are owned by the reconciler** (`reconciler.ts`, ADR 0005). `resolved_at` is set only after finality + canonical join; `NULL` = still in the finality gate or canonical Pool/Member not yet ingested. `orphaned = true` is terminal (tx never finalized). The console shows orphaned rows in the raw black-box (flagged) but **excludes them from aggregates / canonical reads**, and surfaces unresolved counts as indexer-health signal.

### Sequencing

Phase 0 (foundations) → Phase 1 (Home/Canary + Pools end-to-end on real indexer data — **stop & validate**) → Phase 2 (Users) → Phase 3 (Events + export). Insights: schema only now, implementation deferred (devnet data is too thin for correlations).

## Consequences

- ✅ One definition of on-time/late/grace/default, shared and parity-tested — the admin cannot diverge from the chain.
- ✅ The canonical event table is the single auditable, exportable, backfill-rebuildable record; metrics/profiles/insights are views, not parallel stores.
- ✅ Real auth on the endpoints (not the UI) protects the behavioral dataset even though the repo is public.
- ✅ Real-vs-demo separation is structural (namespace + data path), not a label that can drift.
- ⚠️ Collapsing to one `events` table touches the reconciler's three per-table functions and the webhook `_unresolved` fast-path — non-trivial; the fallback (derive `events` from typed tables) bounds the risk.
- ⚠️ `default_reason` is inferred — useful for FCRA contestability framing but must be clearly provenance-tagged so it is never mistaken for on-chain truth.
- ❌ Adds an `app → indexer Postgres` coupling (shared Prisma client) we accept for monorepo simplicity over a separate indexer read API.

## Alternatives considered

### Keep three typed event tables; compute due/delta/grace on-read

**Rejected** as the primary path: it scatters the metric definition across queries (easy to drift from the chain), contradicting Recommendation 1. Retained only as the **fallback** ingestion surface, with `events` derived from it.

### Expose a read API on the indexer (Fastify) and proxy from Next

**Rejected** for the canary: more layers and a second deploy surface for no gain in a monorepo where the app can read the same DB via Prisma. Reconsider if the app and indexer ever split repos.

### Gate the console only in the UI (route guard), defer real auth

**Rejected:** the repo is public and the dataset is the moat — a UI-only guard leaks the behavioral data via the unprotected endpoints. SIWS-on-endpoints is the bar; deploy-level basic-auth is the only acceptable interim, and only for the first slice.

### Fold the operational console into the existing `/admin` (Demo Studio root)

**Rejected:** mixing fake studio state with real indexer data in one namespace is exactly the real-vs-demo confusion Recommendation 4 forbids. Separate namespace + data path instead.

## References

- Behavioral module: `sdk/src/behavioral.ts`; parity test: `tests/behavioral.spec.ts`.
- On-chain semantics: `programs/roundfi-core/src/constants.rs:49`, `instructions/contribute.rs:181`, `instructions/settle_default.rs:160-172`, `instructions/claim_payout.rs:185-189`, `instructions/join_pool.rs:302-307`, `instructions/skip_defaulted_payout.rs:88-90`.
- Pending schema: `services/indexer/prisma/migrations/2026-05-canary-score-fields-options/` (Option B).
- Reconciler: `services/indexer/src/reconciler.ts`; ADR [0005](./0005-indexer-finality-gate.md).
- Compliance framing: `MAINNET_READINESS.md` §6.1 (attestation as "credit data", LGPD/GDPR/FCRA).

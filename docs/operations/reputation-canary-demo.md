# Reputation v5.2 Hybrid — devnet canary demo

End-to-end runbook for demoing the v5.2 Hybrid reputation pipeline on
devnet: an on-chain pool produces real `BehavioralPayload` attestations,
the indexer backfills + classifies them, and the off-chain score
endpoint serves the result.

This runbook does **not** publish weights as canonical — the score is
tagged `formula_versao: "v1-provisional"` and the metrics are
`Reliability + Punctuality` only (`commitment` + `recovery` deferred).
See `docs/architecture.md` §4.7 and
`mobile/docs/reputation-v2/06-team-decisions.md`.

---

## Pre-flight

| Tool / state                                | Check                          |
| ------------------------------------------- | ------------------------------ |
| Solana / Agave CLI 2.x                      | `solana --version`             |
| Anchor CLI 0.30.1                           | `anchor --version`             |
| `~/.config/solana/id.json` funded on devnet | `solana balance --url devnet`  |
| Postgres reachable (any host)               | `psql "$DATABASE_URL" -c '\q'` |
| `pnpm install` clean                        | from repo root                 |

Two env vars drive everything:

```bash
export SOLANA_RPC_URL=https://api.devnet.solana.com
export DATABASE_URL=postgres://...   # the indexer's Postgres
# Set both program ids — the canary needs core (writes payload) and
# reputation (the Attestation accounts the backfill scans).
export ROUNDFI_CORE_PROGRAM_ID=8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw
export ROUNDFI_REPUTATION_PROGRAM_ID=Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2
```

---

## 1. Build + redeploy

The Phase B + Phase C code is on `main`; devnet must run that binary
for the payload to be populated.

```bash
anchor build
pnpm devnet:deploy        # redeploys all 4 programs to devnet
pnpm devnet:init          # one-time: initialize ProtocolConfig
```

`devnet:deploy` is idempotent — if the program ids match an existing
upgrade authority, it does an upgrade in place. Existing pools survive.

---

## 2. Drive a short pool end-to-end

Each command produces one or more on-chain attestations with the v5.2
payload populated (Phase B, PR #455). Cycle through the pool fast:

```bash
pnpm devnet:seed-pool       # create a 3-member, 3-cycle pool
pnpm devnet:seed-members    # register + join 3 keypairs (also funds USDC)
pnpm devnet:seed-cycle      # cycle 0 — 3 contributes → 3 SCHEMA_PAYMENT attestations
pnpm devnet:seed-claim      # cycle 0 payout claim → 1 SCHEMA_PAYOUT_CLAIMED attestation
# Repeat seed-cycle + seed-claim for cycles 1, 2 to fill the pool.
```

> **Pass-3 (2026-06-12):** on each member's FINAL `contribute` (cycle 2 of
> a 3-cycle pool) the script escalates the schema to `SCHEMA_POOL_COMPLETE`
> (id 4) — that's the moment the member kept every obligation, and it
> carries the `+50` / `cycles_completed` signal. `claim_payout` emits the
> score-neutral `SCHEMA_PAYOUT_CLAIMED` (id 6) instead of the old
> `CYCLE_COMPLETE`. The scripts derive the attestation PDA with the
> matching schema automatically; if you see `ConstraintSeeds` (2006), the
> on-chain program is older than the script (re-deploy core+reputation).

To demo a `default` classification too, pause one member's contribute
and let the 7-day grace elapse (or use `setBankrunUnixTs` — localnet
only). The crank's `settle_default` produces a SCHEMA_DEFAULT
attestation.

> **Attestation PDA layout** (for explorer cross-check):
> `[b"attestation", issuer=pool, subject=wallet, schema_id_le, nonce_le]`
> where `nonce = (cycle << 32) | slot_index`.

---

## 3. Backfill the indexer

The backfill scans every `Attestation` account under
`ROUNDFI_REPUTATION_PROGRAM_ID`, decodes the 96-byte `payload` via
`decodeAttestationRaw` (Phase C.2a, PR #457), derives the authoritative
`EventClassification` (`deriveEventClassification`), and upserts the
structured row (Phase C.2b, PR #459) including:

- `payloadVersion`, `classification`, `cycle`, `slotIndex`
- `groupSize`, `parcelsPaid`, `deltaSeconds`, `amount`
- `issuedAt`, `revoked`

```bash
pnpm --filter @roundfi/indexer prisma migrate deploy   # apply C.2b migration
pnpm --filter @roundfi/indexer backfill                # scans + persists
```

Watch the log line:

```
{"event_type":"backfill_attestations_complete","attestationsTouched":N}
```

`N > 0` confirms attestations landed and were decoded.

---

## 4. Boot the indexer + hit the score endpoint

```bash
pnpm --filter @roundfi/indexer dev    # Fastify on :8787
```

In another shell — replace `$SUBJECT` with one of the member wallets:

```bash
curl -s http://localhost:8787/score/$SUBJECT | jq
```

Expected shape (Phase C.3.3, PR #461):

```json
{
  "subject": "...",
  "formula_versao": "v1-provisional",
  "reliability": 100,
  "punctuality": 80,
  "commitment": null,
  "recovery": null,
  "pending": ["commitment", "recovery"],
  "event_count": 5,
  "classification_counts": {
    "payment_on_time": 2,
    "pool_complete": 1,
    "payout_claimed": 2
  },
  "polarity_counts": { "positive": 3, "neutral": 2, "negative": 0 }
}
```

> **Pass-3 taxonomy:** `pool_complete` (the final installment, +50) and
> `payout_claimed` (score-neutral audit trail) replace the old
> `cycle_complete`. `payout_claimed` is `neutral` polarity — being drawn
> is not merit; completing the pool is. `reliability` counts only
> payment-class events (payments + `pool_complete`); `payout_claimed`
> carries no weight, so it never inflates the score.

A wallet with **no attestations** returns the honest fresh default —
`reliability 0`, `punctuality 80`, `event_count 0` — not a 404. "No
history" is a queryable state. A malformed wallet returns **400**
without hitting the DB.

---

## 5. See it in the admin

`/admin/ops/users/[wallet]` now hosts the `BehavioralScoreCard`
component (this PR). It calls
`GET /api/admin/users/[wallet]/reputation-score`, which proxies to the
indexer's `loadSubjectScore` in-process (same Postgres handle, no extra
HTTP hop).

The card surfaces:

- the **`v1-provisional`** badge so the score never reads as canonical,
- Reliability + Punctuality as 0..100 stat cards with the proposal's
  formulas in the tooltip,
- Commitment + Recovery rendered as **"Pending"** pills (never `0` —
  see `06-team-decisions.md` §6.3/§6.4),
- a per-classification breakdown (`On time`, `Early`, `Friction (≤2d)`,
  `Late (2–7d)`, `Late (>7d)`, `Default`, `Cycle complete`).

If the indexer is down the route returns **503** and the card renders
"Indexer unavailable" rather than a generic error.

---

## What's intentionally NOT in the canary

Per `06-team-decisions.md` decisões 3 + 4:

- **`query_score` CPI** — Phase Future. Partners consume HTTP, not CPI.
- **`FrictionProof` / `ORACLE_WHITELIST`** — deferred. The
  `friction_operational` classification doesn't appear.
- **`BadFaith`** — deferred (needs governance design).
- **Commitment + Recovery** — deferred; need identity-layer pool counts
  / the derived `Recovery` event.

If a partner asks "can we recompute this on-chain?", the answer for
this canary is **"not yet — it's the off-chain v1-provisional surface,
calibrated later."** The codec + classification primitives are public
(`@roundfi/sdk` `decodeBehavioralPayload` + the indexer's
`deriveEventClassification`), so any third party can recompute the
**same number** from the raw on-chain bytes today — which is the
auditability property the v5.2 spec asks for.

---

## Related PRs (the v5.2 Hybrid pipeline)

| PR     | Phase             | What                                                 |
| ------ | ----------------- | ---------------------------------------------------- |
| #453   | A                 | Rust codec — `BehavioralPayload`                     |
| #455   | B                 | core writes the payload at 3 emit sites              |
| #456   | C.1               | TS codec — `decodeBehavioralPayload`                 |
| #457   | C.2a              | `decodeAttestationRaw` + `deriveEventClassification` |
| #459   | C.2b              | backfill + Prisma migration                          |
| #460   | C.3 scoring       | Reliability + Punctuality (proposal §6)              |
| #461   | C.3.3             | `GET /score/:subject`                                |
| _this_ | _admin + runbook_ | `BehavioralScoreCard` + this doc                     |

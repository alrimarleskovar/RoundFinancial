# Team decisions — v5.2 reputation

> **Status:** locked in by team 2026-06-09. This file is the source of truth
> for which path was chosen out of `05-decisoes-pendentes.md`'s 5-way fork.

## Resolved

### Decisão 1 — Score architecture: **Hybrid (storage-rich + score-simple)**

**Chosen.** The team chose neither pure v1 nor full v5.2, but the hybrid
path the spec doc surfaced as a third option:

- **On-chain (decided):** introduce `BehavioralEvent`-style rich storage so
  every contribution / claim / default keeps `delta_seconds`, classification
  enum, group context — the inputs v5.2 would eventually need.
- **Score computation (provisional):** stays in the indexer, off-chain, with
  a simple v1-style formula. **Pesos da v5.2 não são publicados ainda.**
  They get calibrated only once a real dataset exists (read: months, not
  weeks — see Risk Review for the cold-start gap that makes a 90-day
  calibration window optimistic).
- **What the canary explicitly does NOT ship:** `query_score` CPI / B2B
  oracle. The score is consumed as an HTTP endpoint from the indexer, not
  via on-chain CPI. The "any third party recomputes the score on-chain"
  property of full v5.2 is a Phase Future, not a canary deliverable.

**Why this is honest:** schema gets decided now (cheap, certain), weights get
decided when there's evidence (the v5.2 spec's own bugs in `reliability()` /
`punctuality()` plus the dataset gap make publishing weights today actively
harmful — first users would be punished by arbitrary numbers).

### Decisão 2 — Tier ladder: **4 levels**

**Chosen.** L1 / L2 / L3 / L4 with stakes 50% / 25% / 10% / 3%.

This changes L2 from the 30% documented across institutional materials
(README, architecture.md, whitepaper, user guide, behavioral reputation
score doc). **Those documents must be updated before this decision is
public-facing.** The spec doc lists the four to amend in §5.2.

Mobile note: `mobile/src/lib/chain.ts::reputationLabel()` returns L1..L3
today. It needs to extend to L4 plus the human names (Iniciante, Comprovado,
Veterano, Elite) and the tier color per level. See `../ROADMAP.md` for
the touchpoint inventory.

## Still open

### Decisão 3 — Switchboard oracle (`ORACLE_WHITELIST`)

Not resolved. The hybrid path defers this — without v5.2's `FrictionProof`
shipping at the canary, the oracle whitelist doesn't gate anything yet.
Pre-requisite only when the team decides to upgrade past v1 weights.

### Decisão 4 — BadFaith attester

Not resolved. In hybrid mode, the BadFaith category from v5.2 is also
deferred — the v1 weights don't have a BadFaith bucket. Decide when the
governance path is being designed (post-canary per the spec).

### Decisão 5 — Upgrade vs redeploy of `roundfi-reputation`

Not explicitly resolved at this writing. The hybrid path constraints this:
since `RawReputationProfile` stays as-is and `BehavioralEvent` is additive
(new account type, not a schema change), an **upgrade** is technically
possible — the existing account layout doesn't change. The decision sits
with the implementer and depends on whether other refactors in the
reputation program want to bundle into the same redeploy.

## Implications, written down

### What lands in the canary because of these decisions

- `BehavioralEvent` schema on-chain (new account type)
- Indexer projector adds an `EventClassification` derivation (deterministic
  from `delta_seconds` + status)
- Off-chain score endpoint (indexer HTTP) with v1-style weights
- Mobile / app surface 4 tiers (UI-only update)
- All 4 institutional docs updated for L1..L4 / 50-25-10-3% stakes

### What does NOT land in the canary

- `query_score` CPI / B2B oracle
- `FrictionProof` on-chain verification
- `ORACLE_WHITELIST`, Switchboard feeds, governance program
- BadFaith category in scoring
- Score Reader Program
- The 3 blocking bugs in `reliability()` / `punctuality()` (deferred — those
  functions never run in hybrid mode; revisit when v5.2 weights are
  calibrated and ready to publish)

### What this means for the mobile branch

`claude/friendly-carson-50EIx` (current mobile branch) has 2 paths forward:

1. **Add 4-tier labels + colors now.** Cheap (~30 min). The current
   `RawReputationProfile.level: u8` already accepts `1..N`; we'd just
   extend the label map. Lets the mobile preview the L4 visual once a
   wallet reaches it, without breaking L1..L3 display today.
2. **Wait for upstream.** Let the on-chain `BehavioralEvent` + indexer
   work ship first, then touch the mobile in a fresh branch with the
   bigger refactor.

The minor risk of (1) is that we render `L4 Elite` with current colors
and the design system picks different colors later — trivial revert.
The minor risk of (2) is that mobile stays on `L1..L3` labels for the
~weeks/months upstream takes.

**No mobile work authorized yet** — decide explicitly before moving.

## Pending follow-ups (issues opened or to open)

- **#450** — VOLUNTARY_EXIT satisfied by construction (signed off, can be closed)
- **#451** — cleanup of dead `EscapeValveLeavingDefault` enum value
- (not yet opened) — amend `architecture.md` §3.4 / §4.2 / §7 for L1..L4 + hybrid path
- (not yet opened) — `BehavioralEvent` account design — implementer's call
- (not yet opened) — indexer projector: derive `EventClassification` from `delta_seconds`
- (not yet opened) — institutional doc sweep (README + whitepaper + user guide + behavioral reputation score) — 30 → 25% in L2

---

_Locked in: 2026-06-09 · Recorded after team approval_

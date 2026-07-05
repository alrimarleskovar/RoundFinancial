# Audit-Leads Triage — Caio's 10 Investigation Leads

> **Status:** triage / decision-support. Maps each of the 11 internal
> security-audit leads (Caio, 2026-07 — the original 10 plus LEAD-011,
> Anchor structural fundamentals) to its current on-chain coverage,
> a verdict, and recommended work. **No code changes are described here**
> beyond the Phase-A doc corrections already landed alongside this file.
> **Date:** 2026-07-05.
> **Method:** each lead was investigated directly against the source
> (`programs/**`, `crates/math/**`, `tests/**`, `docs/**`); every claim
> cites `file:line`. Verdicts: 🟢 COVERED / 🟡 PARTIAL / 🔴 GAP.

---

## Dominant theme

**The on-chain code is sound across all 11 leads — no exploitable
vulnerability was found.** The consistent shortfall is _audit-facing
evidence_: tests that **prove** what the code already does by
construction, and docs whose numbers track the deployed constants. That
is precisely what an external auditor flags first. Beyond that, one
genuine **spec-vs-implementation question (LEAD-001)** and a few
**liveness / hardening decisions** need owner (Caio) input before code.

## Summary table

| LEAD | Surface                                                             | Caio's risk  | Verdict       | One-line                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------- | ------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001  | `settle_default` waterfall order                                    | Very High    | 🟡 PARTIAL ⚠️ | Implemented order Solidarity→**member Escrow**→Stake is now the **officially confirmed** v1 Triple Shield (Caio, 2026-07-05); GF is a systemic reserve, never a default absorber. Remaining: reinforce tests (Phase B). |
| 002  | `create_pool` param validation                                      | High         | 🟡 PARTIAL    | Div-by-zero structurally impossible, overflow guarded, cycle-0 closed (SEV-031/038). On-chain negative tests + `pool_is_viable` fuzz missing.                                                                           |
| 003  | Yield-curve / distribution rounding                                 | High         | 🟢 COVERED    | Conservation enforced at runtime **and** proptest **and** fuzz. Per-participant split is aggregate (M3).                                                                                                                |
| 004  | Kamino adapter account pinning                                      | (High)       | 🟡 PARTIAL    | Program-id + reserve + prelude pinned; deep CPI test + mainnet reserve verify are mainnet-gated (out of pre-canary scope).                                                                                              |
| 005  | `escape_valve_buy` race                                             | (flagged)    | 🟡 PARTIAL    | Buy/cancel/rebuy loop doesn't exist; race resolved. Commit-reveal + cancel untested; 2 dead enum states; Active-listing liveness gap.                                                                                   |
| 006  | Treasury lock state machine                                         | High         | 🟡 PARTIAL    | Rotations deadlock-free by construction. `pause` = indefinite freeze under absent/hostile authority. Coverage = 1 negative test.                                                                                        |
| 007  | SEV-049/050/051 regression                                          | (durability) | 🟢 COVERED    | All three now have dedicated, non-artifact-gated bankrun regressions asserting liveness (051 shipped; 049/050 added in #595).                                                                                           |
| 008  | Reputation farming economics                                        | High         | 🟢/🟡         | `crank_payout` adds no farmable surface. Default-config farm uneconomical. Doc numbers were stale (fixed here); R1 structural cap open.                                                                                 |
| 009  | `crank_payout` (cranker)                                            | New          | 🟡 PARTIAL    | Every abuse case mitigated in code. Frozen/closed destination ATA is the one under-mitigated edge. Double-attest branch untested.                                                                                       |
| 010  | Recovery wallet (ADR-0011)                                          | New          | 🟡 DESIGN     | All 6 of Caio's questions answered at design level. 2 hardest deferred to the doc's §5 open questions. No code (deferred).                                                                                              |
| 011  | Anchor fundamentals (signer / owner / arbitrary-CPI / bump / close) | New (Caio)   | 🟢 SOLID      | 4/5 clean: every signer bound, every external owner typed, every CPI program-id pinned, every PDA bump canonical, every close Anchor-safe. 1 LOW: migrate_reputation_config lacks a discriminator check.                |

---

## Decisions — RESOLVED (Caio, 2026-07-05)

All four were ruled on by Caio; the resolution is recorded under each question. **FROZEN (LEAD-009): reaffirmed _not now_** — no frozen-ATA skip path is to be implemented.

### D1 — LEAD-001: "Guarantee Fund" vs "member Escrow" in the default waterfall (blocking, Very High)

Caio's criterion states the seizure order is **Solidarity → Guarantee Fund → Stake**. The code implements **Solidarity → member Escrow → member Stake** (`crates/math/src/cascade.rs:42-59`), and the **Guarantee Fund is never drawn on default** — `docs/yield-and-guarantee-fund.md:91`: _"settle_default never draws from `guarantee_fund_balance`."_ The GF is a payout earmark topped by the _yield_ waterfall, a v2 catastrophic reserve — a **different** waterfall. **Question:** is "Guarantee Fund" a mislabel for the member-escrow leg (⇒ order is satisfied and immutable), or is the GF genuinely wanted as the 2nd absorber (⇒ code does not match, and it would contradict the documented v1 design)? Do not sign off on LEAD-001 while stated ≠ implemented.

**✅ Resolved:** confusion of nomenclature confirmed. The RoundFi v1 Triple Shield is officially **Cofre Solidário → member Escrow → Stake/Colateral**; the Guarantee Fund is a _systemic_ reserve for extraordinary scenarios, never an individual-default absorber (placing it as the 2nd layer would change the protocol economics). Action: the implemented order is correct as-is → **reinforce the LEAD-001 tests (Phase B)**. No code change.

### D2 — LEAD-006: pause as an un-escapable freeze

Every sensitive lever except `pause` has a permissionless "completes even if the authority goes silent" crank. `pause` does not: only the authority can unpause (`pause.rs:33`), with no timelock and no auto-unpause. Reachable stuck state: `paused=true` + authority permanently absent/hostile ⇒ every solvent member's capital frozen (pause gates `contribute`/`claim_payout`/**`crank_payout`**/`release_escrow`/escape-valve; only `settle_default` bypasses). **Question:** add a permissionless emergency-unpause crank after a long timelock (mirroring the commit cranks), or formally accept the risk with the Squads recovery runbook as the named mitigation?

**✅ Resolved (partial):** pre-Canary — the Squads-multisig runbook is sufficient **only once the authority actually is the Squads multisig**; until that migration runs it is a risk to close first. (Today the devnet authority is the deployer key `64XM…Cffm`, not a multisig — fine for a test environment, but the mainnet-canary Squads migration via `propose/commit_new_authority` must precede reliance on the runbook.) Mainnet — a permissionless emergency-unpause after a long timelock goes on the **pre-launch roadmap** (not a now-item).

### D3 — LEAD-005: Active-listing liveness

An Active escape-valve listing that never sells is stuck — no cancel/reprice/reclaim for Active listings (only `cancel_pending_listing` for Pending). A seller who lists too high can't lower or recover, and can't re-list while the PDA is occupied. Harm is bounded (locked rent + that slot's escape-valve unusable; the member keeps their position). **Question:** add an owner-only atomic reprice/cancel for Active listings, or document "list-high = locked until sold" as accepted?

**✅ Resolved:** accept + document — do **not** block the Canary. Surface clearly to the user that an Active listing cannot be cancelled or repriced right now; implement reprice/cancel in a future version if real demand appears.

### D4 — LEAD-008: R1 (the one open structural farming gap)

The SEV-047 gate + 30-day cooldown make default-config farming uneconomical, but the prize scales linearly with `credit_amount` (a 100k pool → 40k stake discount), so farming turns rational against **large-credit pools**. R1 (cap credit / stake-discount by level) is the single change that removes that regime and is **explicitly left open** (`reputation-farming-roi.md §7`). **Question:** close R1 on-chain now, or hold pending monitoring (R4)?

**✅ Resolved:** the score is the heart of RoundFi, so don't wait for exploitation. **Pre-mainnet: implement R1 definitively** (cap credit / stake-discount by level). Pre-Canary: keep monitoring (R4) + turn on the identity gate (R3) if ready. **R3 readiness note:** `set_identity_gate` **is** wired (authority sets `required_min_level`, enforced in `promote_level`), but it gates by **reputation level globally**, not per-pool-size, and needs a live identity provider — so it fits the **mainnet canary**, not devnet pre-canary (on devnet, R3-on would just block L3 with no provider, and farming is academic with test money). Net: **R1 → pre-mainnet build; R3 → enable at mainnet canary.**

---

## Per-lead detail

### LEAD-001 — settle_default waterfall — 🟡 PARTIAL (+ D1)

- Order hard-coded, single-sourced, no input reorders: `seize_for_default` `cascade.rs:42-59` (solidarity → escrow via `max_seizure_respecting_dc` → stake). Handler `settle_default.rs:207-216` delegates to that one fn (SEV-026); 3 transfers gated on its output.
- Late-payment-races-settlement is **structurally impossible**: `contribute` needs `contributions_paid == current_cycle` (`contribute.rs:134-135`); `settle_default` needs `contributions_paid < current_cycle` (`settle_default.rs:164`) — mutually exclusive, no catch-up path. One-way `!defaulted` latch. Grace gate `settle_default.rs:167-173`.
- Coverage: `cascade.rs` unit tests pin order (79-123) + 13.5k-combo exhaustive (204-248) + fuzz target (solidarity-before-escrow); bankrun `edge_grace_default.spec.ts` + `edge_grace_default_shield1_only.spec.ts` (exact per-leg amounts + D/C).
- **Recommended:** (D1 first) property test for "payable XOR settleable"; grace-boundary exact-threshold test (`clock == deadline-1` reject / `== deadline` accept — current tests use far-from-boundary values); interleaving regression; strengthen fuzz to full order-invariance.

### LEAD-002 — create_pool — 🟡 PARTIAL

- 7 args only; `seed_draw_bps`/`solidarity_bps`/`stake_bps` are constants/config, not inputs. **No division by any user-controlled denominator** (all bps ÷ constant `MAX_BPS`: `bps.rs:19`, `seed_draw.rs:86`, `waterfall.rs:66`) ⇒ div-by-zero impossible. Overflow guarded (u128 + checked/try_into). Cycle-0 unsatisfiability closed by SEV-031 viability (`create_pool.rs:161-168`) + SEV-038 `cycles_total==members_target` (122-125).
- Guards: members*target ✅(>0,≤64); installment ⚠️(>0, no ceiling); credit ⚠️(>0, no ceiling); cycle_duration ⚠️(≥1d, no ceiling); escrow_release_bps ✅(≤MAX_BPS); TVL caps ✅ but \*\*disabled when `max*\*\_tvl==0`**. Residual: huge-but-viable config accepted (per-pool DoS via eventual `checked_add` revert, not fund-loss).
- Coverage: math layer strong (seed_draw SEV-031 suite, bps conservation); on-chain negatives exist **only** for TVL caps (`security_canary_controls.spec.ts:177-258`). `pool_is_viable` **not** fuzzed.
- **Recommended:** on-chain bankrun negative tests per guard; `pool_is_viable` fuzz target; consider explicit installment/credit ceilings or mandatory TVL cap.

### LEAD-003 — yield rounding — 🟢 COVERED

- `waterfall()` asserts `total == yield_amount` at runtime → `WaterfallNotConserved` (`waterfall.rs:50-53`) — conservation is an on-chain invariant, not just a test. Proptest `p_conservation` proves Σ==input over `0..=u64::MAX/4` all bps (`waterfall.rs:178-187`); cargo-fuzz target exists. `apply_bps` u128 + checked (survives u64::MAX). All accumulators `checked_add`.
- Per-participant LP split is **aggregate** (`pool.lp_distribution_balance`; per-LP withdrawal = M3, `harvest_yield.rs:322`), so "thousands of participants diverge" doesn't exist yet — an M3 concern.
- **Recommended:** none pre-M3; add the per-participant-split property test when that withdrawal path is built.

### LEAD-004 — Kamino adapter — 🟡 PARTIAL (mostly mainnet-gated)

- Core→adapter: `invoke_adapter` pins `program.key() == pool.yield_adapter` on every call (`cpi/yield_adapter.rs:131-132`); delta-balance accounting ignores adapter return values; 4-account prelude pinned by unit test `adapter_prelude_matches_canonical_layout` (SEV-041 oracle). `harvest_yield.rs`: `yield_vault_drop ≤ realized+1` (over-withdraw) + `realized ≥ min_realized_usdc` (under-withdraw).
- Kamino internal: program-id hard-coded (`yield-kamino/lib.rs:77`, pre-mainnet re-verify note); reserve+market pinned at `init_vault`; deposit/redeem prelude order pinned; extreme-exchange-rate "fail loud" guard. CI advisory lane `security_kamino_cpi`.
- Explicitly deferred to mainnet (`lib.rs:42,49,58`): live reserve validation + Kamino-mock harvest bankrun. `AUDIT_SCOPE.md` lists yield-mock/harvest path out of current scope.
- **Recommended (mainnet-gated, not pre-canary):** Kamino-mock bankrun for account-substitution/reserve-spoofing/exchange-rate-extreme; mainnet reserve pin re-verification.

### LEAD-005 — escape_valve_buy — 🟡 PARTIAL (+ D3)

- Buy→cancel→rebuy loop **does not exist** (no cancel for Active; only `cancel_pending_listing` Pending-only, `cancel_pending_listing.rs:64`). Two-buyer race deterministic (buy closes listing `escape_valve_buy.rs:99` + price-commit `:174-177` + 30s cooldown). Commit-reveal weaker than doc implies for **open** listings (price public at reveal, universal 30s delay). FSM declares 4 states but **Filled/Cancelled are never written** (dead variants).
- **GAP: zero test coverage of commit-reveal or cancel** (`listCommit|listReveal|cancelPendingListing|buyable` → no matches in `tests/**`). `security_lifecycle.spec.ts` D.1-D.5 covers only the legacy single-step path.
- **Recommended:** commit-reveal integration tests; `cancel_pending_listing` tests; two-buyer race bankrun; (D3) decide Active-listing liveness; remove/wire dead `Filled`/`Cancelled` variants.

### LEAD-006 — treasury state machine — 🟡 PARTIAL (+ D2)

- Rotation sub-machines **deadlock-free by construction**: `commit_new_treasury`/`commit_new_authority`/`commit_new_fee_bps_yield` all permissionless (anyone cranks after eta); not blocked by lock (commit ignores lock) nor pause. Zombie-pending closed (SEV-006 typed TokenAccount can't be default; SEV-036 `propose_auth new!=default`). Cancel-vs-commit atomic/deterministic.
- **GAP (D2): pause has no permissionless/time-based escape.** Coverage = a single `TreasuryLocked` negative (`security_audit_paths.spec.ts:235-299`). The deadlock-enumeration doc the criterion asks for does not exist; `self-audit.md` authority table omits the authority-rotation trio.
- **Recommended:** state-machine bankrun battery (all 3 trios incl. permissionless-commit-by-non-authority; before-eta; cancel; lock-during-pending); pause-interaction tests; (D2) decide the pause asymmetry; write the deadlock-enumeration doc.

### LEAD-007 — SEV-049/050/051 regression — 🟡 MIXED

- **SEV-051** (`crank_payout`): 🟢 COVERED — dedicated durable bankrun `edge_crank_payout.spec.ts`, asserts `currentCycle` advances 1→2 (`:266`), not artifact-gated.
- **SEV-049** (`skip_defaulted_payout`): 🟡 PARTIAL — only via `litesvm_parity.spec.ts` which `this.skip()`s when `mpl_core.so` absent (`:340-347`); liveness emergent, not directly asserted.
- **SEV-050** (`close_pool` defaulted): 🟡 PARTIAL — only artifact-gated; no isolated assertion. Stale comment fixed in Phase A (`edge_tiny_lifecycle.spec.ts`).
- Traceability: "SEV-051" label was overloaded for the `close_pool_vaults` rent-recipient pin — **relabeled SEV-039** in Phase A (`litesvm_parity.spec.ts`).
- **Recommended:** dedicated bankrun regressions for SEV-049 (assert `current_cycle +1`) and SEV-050 (defaulted-pool close → `status=Closed`, TVL decremented), un-gated from litesvm.

### LEAD-008 — reputation farming — 🟢 (question answered) / 🟡 (residual + D4)

- `crank_payout` adds **no** farmable surface: emits `SCHEMA_PAYOUT_CLAIMED` (same as `claim_payout`), `SCORE=0`, doesn't touch `cycles_completed` (only informational `total_participated`), later-gated, pays member's own ATA. Caio's worry not borne out.
- SEV-047 two-layer gate + 30-day cooldown (`reputation/constants.rs:76`, enforced `attest.rs:217-225`) ⇒ default-config farm floor is months, not weeks. Per-cycle dedup structural via attestation PDA seeds; per-`(subject,pool)` positive re-attestation block **delegated to core**, untested from the reputation side.
- **Phase A done:** `reputation-farming-roi.md` §3–§7 rewritten from the stale 6-day/"≥18 days" body to the real 30-day / ~2–3-month floor (SEV-002-shape stale body); L4 added to the prize/exploit tables.
- **Recommended:** (D4) close R1 on-chain; test the per-`(subject,pool)` re-attestation block end-to-end; pin `crank_payout`'s attestation as score-0/cycles-neutral in a test.

### LEAD-009 — crank_payout audit — 🟡 PARTIAL

- Guards: `!defaulted` (`crank_payout.rs:69`), `!paid_out` (`:70`), `cycle==current_cycle` (`:131`), grace gate (`:141-148`), dest ATA pinned `token::authority=member_wallet` (`:91-96`, never caller), earmark survival (`:170-174`).
- Nobody-executes: liveness by design (permissionless + economically forced; sole advance path for a live-unclaimed slot). Two-callers/replay: mitigated by `!paid_out` (account constraint) + `cycle==current_cycle` (backstop); B reverts `NotYourPayoutSlot`. Double-attest: attestation PDA `init` collision (`attest.rs:79-92`) → `ReputationCpiFailed`.
- **🔴 the one real edge — frozen/closed destination ATA.** Missing ATA is recoverable (cranker prepends create-ATA; constraint is `token::authority`, not `associated_token::`). **Frozen** ATA (Circle freeze authority) → `token::transfer` fails `AccountFrozen` → crank reverts → **pool re-stuck on that slot with no fallback** (crank can't deliver, `skip_defaulted_payout` needs `defaulted`, member can't sign). Low probability, un-handled. **Owner decision (2026-07): do NOT implement a frozen-ATA skip path now** — a prior liveness-skip change caused problems; this stays a documented residual, not an action item, until explicitly revisited.
- **Test hole:** `edge_crank_payout.spec.ts` sets `reputationProgram = PublicKey.default`, so the reputation-CPI branch (incl. the double-attest guard) never runs for `crank_payout`.
- **Recommended:** double-attest test with reputation live; two distinct callers (pin `NotYourPayoutSlot`); explicit replay; missing ATA (+ create-ATA recovery). **Frozen-ATA: no skip path — owner-deferred (see above). A test may still assert the clean revert, but no new instruction.**

### LEAD-010 — recovery wallet (ADR-0011) — 🟡 DESIGN (no code; deferred)

- All 6 of Caio's questions are answered at design level in `docs/adr/0011-social-recovery-member-positions.md` + `docs/security/social-recovery.md`: who initiates (recovery wallet, `0011:30`), cancels (primary, `:31`), executes (anyone after eta, `:32`), open positions (Model B continue+reconcile, `social-recovery.md §3`), reputation (link via IdentityRecord, `§2`), attacks (7-threat table, `§4`).
- The 2 hardest carry documented open questions: Q4's stranded mid-window crank (§5.3) and Q5's anti-farming aggregation rule (§5.4, "highest-risk"). Biggest gate: §5.1 NFT ownership ("gates the whole design"). One item not in the docs: the cancel-vs-commit timelock-boundary race.
- **Recommended:** no code (deferred past pre-canary per Caio; `crank_payout` is the interim answer). Close §5.1/§5.4 + the boundary-race note before any implementation.

### LEAD-011 — Anchor structural fundamentals (Caio's cross-cutting checklist) — 🟢 SOLID

Cross-cutting audit of the 5 Anchor hygiene properties across all 58 handlers in the 4 programs (added by Caio after the original 10). Method: 5 property-lens agents + inline completion of the CPI lens. Verdict: the fundamentals are solid — 4 of 5 clean, 1 minor confirmed LOW.

- **Signer / authority (P1) — CLEAN.** Every privileged op binds its Signer to the authoritative field: admin → `config.authority` (`update_protocol_config.rs:62`, `pause.rs:33`, the propose/lock ix); self-service → `member.wallet` / `listing.seller` / profile-by-seed / `identity.wallet`; the permissionless cranks (`crank_payout`, `skip_defaulted_payout`, `settle_default`, the three `commit_new_*`, `deposit_idle_to_yield`, `harvest_yield`) are safe-by-design — funds reach only the rightful party or a pool-owned account, never the caller (`crank_payout.rs:65,78,91`; `settle_default.rs:47,68,77`). 0 authority-binding failures.
- **External-account owner (P2) — CLEAN.** Every externally-supplied token account is a typed `Account<TokenAccount>` / `Mint` (Anchor auto-checks `owner == SPL-Token`) or carries a `token::authority` / `token::mint` / `owner =` constraint. Nothing is trusted by client-declared type.
- **Arbitrary CPI (P3) — CLEAN** (verified inline; the lens agent hit the schema retry cap). Every CPI's `program_id` is pinned to an authoritative on-chain value **before** invoke: reputation → `expected_program_id: config.reputation_program` at every caller (`claim_payout.rs:245`, `contribute.rs:321`, `crank_payout.rs:263`, `settle_default.rs:364`), enforced by `require_keys_eq!` + `executable` (`cpi/reputation.rs:122-130`); yield → `pool.yield_adapter` (`deposit_idle_to_yield.rs:165`, `harvest_yield.rs:235`), enforced at `cpi/yield_adapter.rs:132`. A spoofed program-id → `Unauthorized`. `join_pool` holds a `reputation_program` account but does no CPI with it.
- **PDA bump (P4) — CLEAN.** All 17 PDAs use canonical bumps (Anchor `bump` at init → stored → re-verified). **Zero `create_program_address` calls; zero client-supplied bumps** anywhere.
- **Close + discriminator/typing (P5) — one LOW.** All 6 close sites are Anchor `close =` (zeroes the discriminator; no resurrection). **CONFIRMED LOW:** `migrate_reputation_config` resizes a raw account after checking `owner == crate::ID` + authority `data[8..40]` but **not** `data[0..8] == ReputationConfig::DISCRIMINATOR` — its sibling `migrate_protocol_config` **does** (`migrate_protocol_config.rs:114`). A reputation-program-owned account with a matching authority at `[8..40]` (e.g. a member's own `ReputationProfile`) passes the migrate checks → narrow type-confusion (mostly self-harm — the real config is a fixed-seed PDA read separately). **Fix:** add the 1-line discriminator `require!`, mirroring `migrate_protocol_config`; verified by the required `anchor · build` lane. Awaiting owner go-ahead (program change).

**Hardening notes (not bugs — recorded):** `deposit_idle_to_yield` — a permissionless cranker can move idle float into yield and temporarily starve a `claim_payout` (LOW; the solvency guard reserves GF+LP but not the current cycle's `credit_amount`); `init_vault` is permissionless with a caller-supplied `mint` (INFO); the yield-kamino Deposit/Harvest forward 3 unpinned Kamino accounts (INFO, mainnet — validated by Kamino Lend itself).

---

## Recommended execution order (no-decision items first)

- **Phase A — doc/comment corrections (DONE, in this change):** `reputation-farming-roi.md` 6d→30d + L4; `edge_tiny_lifecycle.spec.ts` stale close_pool guard comment; `mev-front-running.md §2.8` cancel-path precision; SEV-051→SEV-039 relabel in `litesvm_parity.spec.ts`.
- **Phase B — LEAD-001 test hardening (Very High):** payable-XOR-settleable property test, grace-boundary exact-threshold, interleaving regression. (after D1)
- **Phase C — LEAD-007 regression (DONE, #595):** dedicated bankrun for SEV-049 (`edge_skip_defaulted_payout.spec.ts`) + SEV-050 (`edge_close_defaulted_pool.spec.ts`), un-gated from litesvm; both green in the bankrun lane.
- **Phase D — LEAD-009 tests:** double-attest live, two callers, missing ATA. (Frozen-ATA skip path is owner-deferred — do NOT implement.)
- **Phase E — LEAD-002/005/006/008 test batteries** + the reputation re-attestation test.
- **LEAD-010:** no code; close the §5 open questions when the feature is picked up.
- **LEAD-011:** fundamentals clean; the sole action is the optional `migrate_reputation_config` discriminator-check parity fix (see the LEAD-011 detail) — awaiting owner go-ahead (program change).

## Cross-references

- Canonical SEV tracker: [`internal-audit-findings.md`](./internal-audit-findings.md)
- Waterfall/GF distinction: [`../yield-and-guarantee-fund.md`](../yield-and-guarantee-fund.md)
- Recovery design: [`../adr/0011-social-recovery-member-positions.md`](../adr/0011-social-recovery-member-positions.md), [`social-recovery.md`](./social-recovery.md)
- Farming ROI: [`reputation-farming-roi.md`](./reputation-farming-roi.md)
- MEV/ordering: [`mev-front-running.md`](./mev-front-running.md)

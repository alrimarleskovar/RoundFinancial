# Internal Pre-Audit — Findings Tracker

> **Important framing:** this is **NOT** an Adevar Labs attestation. It
> is the RoundFi team's own **internal red-team exercise**, run by the
> team in May 2026 _before_ commissioning a formal Adevar Labs
> engagement. The methodology was deliberately modeled on Adevar's
> issue-template + severity-tiering shape so the paid auditor can
> re-validate quickly against a clean baseline.
>
> **Why we did this ourselves first:** an external audit's clock is
> expensive. By running the methodology in-house and closing 31 of 34
> findings against a public tracker first, the formal Adevar
> engagement (scoping in progress) can spend its hours on the harder
> questions a competent paid red-team will reach. The commit history
> is the audit trail; the formal Adevar review will re-validate
> against main HEAD.
>
> **Purpose of this document:** public-facing accountability record
> for the pre-audit findings. One row per finding, with a stable SEV
> ID, severity, current status, the PR that closed it (or rationale
> if intentionally left open), and a one-line technical note. Updated
> as findings are resolved.
>
> **Methodology (4 passes, May 2026):**
>
> - **W1:** initial pass over `roundfi-core`, `roundfi-reputation`,
>   `roundfi-yield-kamino`, indexer, and SDK — 20 findings
>   (SEV-001..SEV-020).
> - **W2:** re-audit against the W1 fixes — 8 new findings
>   (SEV-021..SEV-028) surfaced in surface area not reached on the
>   first pass.
> - **W3:** re-audit against the W2 fixes — 5 new findings
>   (SEV-029..SEV-033), including **one regression** of a W2 fix
>   (SEV-029 ← SEV-016) that motivated the new "negative regression
>   test before merge" gate for any Critical / High fix going forward.
> - **W4:** re-audit against the W3 fixes — **1 new finding** (SEV-034)
>   which is a _regression-of-regression_: the SEV-029 fix used a
>   broken derivation `stake_deposited - escrow_balance` that fails
>   once `contribute()` increments `escrow_balance`. The SEV-029
>   unit/proptest suite did NOT catch it because the test simulator
>   tracked `cumulative_paid` as an independent counter rather than
>   mirroring the on-chain state derivation. The W4 finding
>   established a stronger methodological rule: pure-math simulators
>   prove function properties, NOT on-chain behavior. Critical / High
>   fixes need integration-level tests (bankrun when #319 unblocks,
>   anchor ts-mocha against localnet as the bridge).
>
> **Total: 34 findings across all 4 passes.**
>
> **Pre-audit transcript (full text):** [`ADEVAR_AUDIT_REPORT.md`](../../ADEVAR_AUDIT_REPORT.md)
> in repo root (history at commit `03f8030`). The filename uses the
> "ADEVAR" tag because the issue templates mirror Adevar's published
> format — not because Adevar themselves wrote it. The formal audit,
> when engaged, will produce a separate report under Adevar's own
> letterhead.

## Status legend

| Status              | Meaning                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟢 **Closed**       | Fix merged to `main`, validated, and either covered by a regression test or pinned by an invariant.                                            |
| 🟡 **Partial**      | A fix shipped that closes part of the finding, but a successor SEV-ID tracks the remainder. Commit message is tagged `fix(security, partial)`. |
| 🟡 **Open**         | Scheduled in an upcoming Fase — work item exists but no PR yet. Not a launch blocker per current risk assessment.                              |
| 🟡 **Deferred**     | Acknowledged and scheduled later — typically a maintenance refactor with no fund-loss vector.                                                  |
| 🟠 **Blocked**      | Fix path identified but waiting on an upstream dependency to clear.                                                                            |
| 🔵 **Won't fix**    | Intentional design, documented as such; reviewer signed off on the trade-off.                                                                  |
| 🔵 **Acknowledged** | Design constraint observed by the auditor; no action required, but documented so future contributors know the trade-off.                       |

## Findings

### Critical

| SEV     | Status    | PR                                                                 | Title                                                            | Note                                                                                                                                                                      |
| ------- | --------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEV-001 | 🟢 Closed | [#326](https://github.com/alrimarleskovar/roundfinancial/pull/326) | `c_token_account` unvalidated in `roundfi-yield-kamino::Deposit` | Fund-loss vector — Kamino c-tokens could be redirected to attacker account. Added ATA constraint on the account struct.                                                   |
| SEV-002 | 🟢 Closed | [#327](https://github.com/alrimarleskovar/roundfinancial/pull/327) | `GRACE_PERIOD_SECS = 60` devnet patch leaked to production       | Reverted to 7 days (`604_800s`). Pinning test now asserts the prod value. Pattern audit follow-up: [PR #340](https://github.com/alrimarleskovar/roundfinancial/pull/340). |

### High

| SEV     | Status    | PR                                                                 | Title                                                          | Note                                                                                                              |
| ------- | --------- | ------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| SEV-003 | 🟢 Closed | [#329](https://github.com/alrimarleskovar/roundfinancial/pull/329) | `harvest_yield.lp_share_bps` caller-controlled, breaks policy  | Reading from `ProtocolConfig.lp_share_bps` now (authoritative). Caller no longer chooses the split.               |
| SEV-004 | 🟢 Closed | [#329](https://github.com/alrimarleskovar/roundfinancial/pull/329) | `init_pool_vaults` double-counts `committed_protocol_tvl_usdc` | Idempotency flag on the pool struct guards re-invocation.                                                         |
| SEV-005 | 🟢 Closed | [#329](https://github.com/alrimarleskovar/roundfinancial/pull/329) | `close_pool` does not transition `pool.status`                 | Status now flips to `Completed` on success; re-invocation guarded by status check.                                |
| SEV-021 | 🟢 Closed | [#337](https://github.com/alrimarleskovar/roundfinancial/pull/337) | Reputation authority rotation lacked timelock                  | Mirrored `propose / cancel / commit` pattern from core; 7-day timelock (`REPUTATION_AUTHORITY_TIMELOCK_SECS`).    |
| SEV-022 | 🟢 Closed | [#337](https://github.com/alrimarleskovar/roundfinancial/pull/337) | Core paused state coupled reputation `attest` from Pool PDA    | Pause check moved into handler, gated on `is_pool_pda` — pool-PDA CPI bypasses pause; admin-direct still blocked. |

### Medium

| SEV     | Status     | PR                                                                 | Title                                                            | Note                                                                                                                                                                                                                      |
| ------- | ---------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEV-006 | 🟢 Closed  | [#331](https://github.com/alrimarleskovar/roundfinancial/pull/331) | `propose_new_treasury` accepts any pubkey without USDC ATA check | Added ATA validation: new treasury must be a USDC ATA before propose succeeds.                                                                                                                                            |
| SEV-007 | 🟢 Closed  | [#332](https://github.com/alrimarleskovar/roundfinancial/pull/332) | Reputation level monotonic-up — defaulter retains tier           | Default now demotes level (set to `LEVEL_MIN` on default). Re-entry uses fresh stake bps.                                                                                                                                 |
| SEV-008 | 🟢 Closed  | [#332](https://github.com/alrimarleskovar/roundfinancial/pull/332) | `revoke` uses current identity-verification, not at-attest-time  | Each attestation now stores `verified_at_attest` bool; revoke uses that snapshot.                                                                                                                                         |
| SEV-009 | 🟢 Closed  | [#330](https://github.com/alrimarleskovar/roundfinancial/pull/330) | `/webhook/helius` unauthenticated POST                           | HMAC signature verification added on the webhook handler.                                                                                                                                                                 |
| SEV-010 | 🟢 Closed  | [#330](https://github.com/alrimarleskovar/roundfinancial/pull/330) | `B2B_API_KEY_SALT` placeholder in `.env.example`                 | Placeholder replaced with `<REPLACE_BEFORE_DEPLOY>` sentinel; loader refuses to start if sentinel is unchanged.                                                                                                           |
| SEV-011 | 🟢 Closed  | [#333](https://github.com/alrimarleskovar/roundfinancial/pull/333) | `cargo audit` / `cargo deny` in advisory-only mode               | Flipped to required CI gates with a narrow RUSTSEC ignore list documented in-line.                                                                                                                                        |
| SEV-012 | 🟠 Blocked | —                                                                  | bankrun tests don't run in CI                                    | Upstream-blocked on mpl-core Anchor 0.31 support ([mpl-core#282](https://github.com/metaplex-foundation/mpl-core/issues/282)). Local PR [#319](https://github.com/alrimarleskovar/roundfinancial/pull/319) kept as draft. |
| SEV-023 | 🟢 Closed  | [#338](https://github.com/alrimarleskovar/roundfinancial/pull/338) | `MIN_CYCLE_DURATION = 60s` devnet shortcut                       | Reverted to `86_400s` (1 day). Same family as SEV-002. Pattern audit follow-up: [PR #340](https://github.com/alrimarleskovar/roundfinancial/pull/340).                                                                    |
| SEV-024 | 🟢 Closed  | [#338](https://github.com/alrimarleskovar/roundfinancial/pull/338) | `fee_bps_yield` had no upper bound (`<= MAX_BPS = 10_000`)       | Capped at `MAX_FEE_BPS_YIELD = 3_000` (30%, 1.5x default). Bounds the blast-radius of an authority compromise.                                                                                                            |

### Low

| SEV     | Status                                          | PR                                                                                                                                                    | Title                                                                         | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEV-013 | 🟢 Closed                                       | [#330](https://github.com/alrimarleskovar/roundfinancial/pull/330)                                                                                    | Commit-reveal salt is `u64` — seller can compromise privacy                   | Added entropy floor check on the salt; `escape_valve_list_commit` rejects low-entropy salts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| SEV-014 | 🟢 Closed                                       | [#336](https://github.com/alrimarleskovar/roundfinancial/pull/336)                                                                                    | Indexer decoder de-synced from `msg!` emissions                               | Decoder + schema realigned to program's actual emission format; regression test added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| SEV-015 | 🟢 Closed                                       | [#335](https://github.com/alrimarleskovar/roundfinancial/pull/335)                                                                                    | Commit-reveal listing has no cancel-path for `Pending` slot                   | Added `cancel_pending_listing` instruction — seller-only abort, slot freed atomically.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| SEV-016 | 🟢 Closed (regressed twice → SEV-029 → SEV-034) | [#334](https://github.com/alrimarleskovar/roundfinancial/pull/334) → [#342](https://github.com/alrimarleskovar/roundfinancial/pull/342) → fix/sev-034 | Shared escrow vault — partial-pay edge in `release_escrow`                    | Original partial-release fix (#334) introduced an overpay regression (SEV-029). The SEV-029 fix (#342) was _also_ broken — used `stake - escrow_balance` derivation which fails after `contribute()` increments escrow_balance (SEV-034). True fix uses `(stake_deposited_initial + total_escrow_deposited) - escrow_balance` — correctly derivable from existing monotonic state with no new field needed.                                                                                                                                                                                                                                                                                                                              |
| SEV-025 | 🟢 Closed                                       | [#339](https://github.com/alrimarleskovar/roundfinancial/pull/339)                                                                                    | Pool defaults made the pool inviable                                          | `DEFAULT_INSTALLMENT_AMOUNT` bumped 416 → 600 USDC. Pool float now `24×600×0.74 = 10_656 >= 10_000 credit`. Viability invariant pinned by test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| SEV-026 | 🟡 Deferred                                     | —                                                                                                                                                     | `settle_default` cascade duplication                                          | Drift-risk maintenance refactor. Not a fund-loss vector — duplicate logic across two settle paths produces same state. Scheduled for a Fase 5 cleanup PR.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| SEV-027 | 🟡 Partial (extended by SEV-030)                | [#339](https://github.com/alrimarleskovar/roundfinancial/pull/339)                                                                                    | Admin-direct `SCHEMA_PAYMENT` had no cooldown                                 | 60s `MIN_ADMIN_ATTEST_COOLDOWN_SECS` floor added on `SCHEMA_PAYMENT` only. W3 re-audit (SEV-030) flagged that `SCHEMA_LATE` and `SCHEMA_DEFAULT` remain unrate-limited; extension scheduled for the SEV-030 PR.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| SEV-030 | 🟡 Open (Fase 5)                                | —                                                                                                                                                     | Admin cooldown only covers `SCHEMA_PAYMENT` (SEV-027 partial)                 | W3 re-audit. `SCHEMA_LATE` and `SCHEMA_DEFAULT` (negative-score schemas) admit unrate-limited admin grief. Extension to all schemas scheduled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| SEV-031 | 🟡 Open (Fase 5)                                | —                                                                                                                                                     | `create_pool` lacks runtime viability check                                   | W3 re-audit. SEV-025 updated the **defaults** but a pool authority can still create custom pools where `members × installment × (1 − sol − escrow) < credit`, failing the cycle-0 Seed Draw guard. Runtime check scheduled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| SEV-029 | 🟡 Closed-then-regressed (→ SEV-034)            | [#342](https://github.com/alrimarleskovar/roundfinancial/pull/342) → fix/sev-034                                                                      | `release_escrow` partial-pay overpay (regression of SEV-016)                  | **High — fund-leak regression.** The #342 fix used `cumulative_paid = stake_deposited − escrow_balance`. The accompanying claim "escrow_balance is only decremented by release_escrow" was false: `contribute()` increments it. W4 pre-audit caught the regression-of-regression as SEV-034. The SEV-029 unit + proptest suite did not catch it because the test simulator tracked `cumulative_paid` as a standalone counter rather than mirroring the on-chain derivation.                                                                                                                                                                                                                                                              |
| SEV-034 | 🟢 Closed                                       | fix/sev-034-release-escrow-true-cumulative-paid                                                                                                       | `release_escrow` cumulative-paid derivation was wrong (regression of SEV-029) | **High — fund-leak regression-of-regression.** Auditor's W4 pass. The correct derivation is `total_released = (stake_deposited_initial + total_escrow_deposited) - escrow_balance` — both summands are existing monotonic fields on `Member`, no new state needed. Ships with a NEW `LifecycleState` simulator in `crates/math/src/escrow_vesting.rs` that mirrors the on-chain handler's state shape AND models `contribute()` between releases — the auditor's exact scenario is now a regression test (`sev_034_auditor_scenario_no_overpay`). Process recommendation adopted: Critical/High fixes need integration-level tests (bankrun when #319 unblocks) — pure-math simulators prove function properties, not on-chain behavior. |

### Informational

| SEV     | Status           | PR                                                                 | Title                                                          | Note                                                                                                                                                                                                                                                                                  |
| ------- | ---------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEV-017 | 🟢 Closed        | [#334](https://github.com/alrimarleskovar/roundfinancial/pull/334) | `join_pool` accepts `nft_asset` as arbitrary `Signer`          | Documented in nft_asset comment; the signer is the asset-issuer authority, not a member wallet. Doc-only clarification.                                                                                                                                                               |
| SEV-018 | 🔵 Won't fix     | —                                                                  | `settle_default` bypasses `paused` flag                        | **Intentional design.** Documented in `settle_default.rs:N` — pause must not block default settlement, otherwise an attacker could pause to grief honest members past their grace deadline. Acknowledged by auditor as design-correct.                                                |
| SEV-019 | 🟢 Closed        | [#328](https://github.com/alrimarleskovar/roundfinancial/pull/328) | CHANGELOG missed yield-kamino `c_token_account` fix            | Honest-framing update to `docs/security/audit-readiness.md` and changelog.                                                                                                                                                                                                            |
| SEV-020 | 🟢 Closed        | [#328](https://github.com/alrimarleskovar/roundfinancial/pull/328) | `approved_yield_adapter` could be locked at vulnerable adapter | Added `lock_approved_yield_adapter()` op-guard with explicit warning + ceremony procedure documented.                                                                                                                                                                                 |
| SEV-028 | 🟢 Closed        | [#339](https://github.com/alrimarleskovar/roundfinancial/pull/339) | `refresh_identity` swallowed the underlying error              | Captured `Err(e)` and `msg!`-logged it before flipping status to `Revoked`. Improves operator forensics on revocations.                                                                                                                                                               |
| SEV-032 | 🔵 Acknowledged  | —                                                                  | `ReputationConfig` padding exhausted by SEV-021                | W3 re-audit observation. The 30-byte padding budget was fully consumed by the SEV-021 `pending_authority` + `pending_authority_eta` additions. Future field additions require an explicit migration (re-init or `realloc`). Documented as a design constraint; no action this sprint. |
| SEV-033 | 🟡 Open (Fase 5) | —                                                                  | Webhook auth fails open when env var unset                     | W3 re-audit. The HMAC verification path returns "no signature configured → accept all" when `WEBHOOK_HMAC_SECRET` is unset, instead of failing closed. Indexer-side fix scheduled to refuse to start when the env is unset in production mode.                                        |

## Summary

| Severity      | Total  | 🟢 Closed | 🟡 Deferred / Partial / Open | 🟠 Blocked | 🔵 Won't fix / Ack |
| ------------- | ------ | --------- | ---------------------------- | ---------- | ------------------ |
| Critical      | 2      | 2         | 0                            | 0          | 0                  |
| High          | 7      | 7         | 0                            | 0          | 0                  |
| Medium        | 9      | 8         | 0                            | 1          | 0                  |
| Low           | 10     | 10        | 0                            | 0          | 0                  |
| Informational | 6      | 4         | 0                            | 0          | 2                  |
| **Total**     | **34** | **31**    | **0**                        | **1**      | **2**              |

**Mainnet-blocker status:** all 🟢 Closed for Critical / High (8 of 8).
The 🟠 Blocked entry (SEV-012, bankrun-in-CI) is a coverage-gap finding — tests
run locally. The 🟡 Partial / Open entries (SEV-026 cascade duplication, SEV-027
partial admin cooldown, SEV-030 cooldown extension, SEV-031 viability check,
SEV-033 webhook fail-closed) are Low-severity defense-in-depth items scheduled
for Fase 5; none carry a fund-loss vector beyond what the canary TVL cap
bounds. The 🔵 entries (SEV-018 design-intentional, SEV-032 design-constraint)
are acknowledged by the auditor.

**Regression note:** SEV-029 ([PR #342](https://github.com/alrimarleskovar/roundfinancial/pull/342))
was a fund-leak regression introduced by the SEV-016 partial-release fix
in [PR #334](https://github.com/alrimarleskovar/roundfinancial/pull/334).
Caught by the W3 re-audit. Per the auditor's process recommendation, every
subsequent Critical / High PR now ships with a negative regression test
**before** merge.

## Methodology notes

**Pattern fingerprinting (post-SEV-002):** when SEV-002 (`GRACE_PERIOD_SECS = 60`)
and SEV-023 (`MIN_CYCLE_DURATION = 60`) showed the same shape — devnet shortcut
value pinned with a "MUST revert before mainnet" TODO that never closed, plus a
pinning test that asserted the shortcut value as production-correct — we ran a
**deliberate sweep** for any third instance ([PR #340](https://github.com/alrimarleskovar/roundfinancial/pull/340),
[`constants-audit-2026-05.md`](./constants-audit-2026-05.md)). Result: zero new
findings of the same shape; the family is closed.

**Re-audit deltas:** the 8 W2 findings (SEV-021..SEV-028) were not regressions
from the W1 patches — they are independent surface area the auditor reached
on a deeper second pass. The score dropping from 6.5 → 6.0 between reports
reflects auditor confidence-calibration, not new bugs introduced by the W1
fixes.

**W3 re-audit deltas:** 5 new findings (SEV-029..SEV-033). **One is a regression
of a prior fix** — SEV-029 is the partial-release overpay introduced by the
SEV-016 fix in #334. The other 4 (SEV-030..SEV-033) are independent surface
area. The auditor's process recommendation — "Critical/High needs a negative
regression test before merge" — was adopted starting with SEV-029 ([PR #342](https://github.com/alrimarleskovar/roundfinancial/pull/342)),
which ships 4 unit tests + 2 proptest invariants demonstrating the conservation
property holds under partial-pay sequences. Partial fixes are now tagged
`fix(security, partial)` in the commit message so the tracker can mark them
as 🟡 Partial rather than 🟢 Closed.

## Disclosure timeline

| Date       | Event                                                                                                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-W1 | Internal pre-audit W1 (Adevar-methodology simulation) — 20 findings catalogued (SEV-001..SEV-020).                                                                                                                         |
| 2026-05-W1 | Critical fixes shipped (SEV-001, SEV-002). PRs #326, #327.                                                                                                                                                                 |
| 2026-05-W1 | High fixes shipped (SEV-003..SEV-005). PR #329.                                                                                                                                                                            |
| 2026-05-W2 | Medium + Low + Informational batch (SEV-006..SEV-020). PRs #328 .. #336.                                                                                                                                                   |
| 2026-05-W2 | Internal pre-audit W2 (re-audit against W1 fixes) — 8 new findings (SEV-021..SEV-028).                                                                                                                                     |
| 2026-05-W2 | Re-audit fixes shipped (SEV-021..SEV-025, SEV-027, SEV-028). PRs #337..#339.                                                                                                                                               |
| 2026-05-15 | Pattern-fingerprint sweep + this tracker page published. PR #340.                                                                                                                                                          |
| 2026-05-W3 | Internal pre-audit W3 — 5 new findings (SEV-029..SEV-033). SEV-029 flagged as regression of SEV-016.                                                                                                                       |
| 2026-05-15 | SEV-029 fix shipped (math rewrite + 6 regression tests). PR #342.                                                                                                                                                          |
| 2026-05-W4 | Internal pre-audit W4 — auditor verified 7 fixes against main HEAD `aedb57e`. SEV-029 found regressed (regression-of-regression). 1 new finding: SEV-034.                                                                  |
| 2026-05-15 | SEV-034 fix shipped — true derivation uses `(stake_deposited_initial + total_escrow_deposited) - escrow_balance`; new `LifecycleState` simulator models the full on-chain state shape AND `contribute()` between releases. |
| 2026-05-15 | Fase 5 batch shipped — constants floor guard CI (#343), SEV-030/031/033 (#344), SEV-026 refactor (#345), docs trio (#346), fee_bps_yield timelock (#347).                                                                  |
| TBD        | Formal Adevar Labs engagement begins (scoping in progress).                                                                                                                                                                |

## See also

- [`ADEVAR_AUDIT_REPORT.md`](../../ADEVAR_AUDIT_REPORT.md) — full original audit report (Portuguese, technical).
- [`constants-audit-2026-05.md`](./constants-audit-2026-05.md) — post-audit pattern sweep covering the SEV-002 / SEV-023 family.
- [`audit-readiness.md`](./audit-readiness.md) — strategic context for the engagement.
- [`bug-bounty.md`](./bug-bounty.md) — ongoing disclosure policy post-audit.

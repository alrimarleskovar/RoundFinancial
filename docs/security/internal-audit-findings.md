# Internal Security Audit — Findings Tracker

> **Purpose:** public-facing accountability record for the Adevar Labs
> security audit of the RoundFi protocol. One row per finding, with a
> stable SEV ID, severity, current status, the PR that closed it (or
> the rationale if intentionally left open), and a one-line technical
> note. This document is updated as findings are resolved.
>
> **Engagement format:** whiteglove audit of `roundfi-core`,
> `roundfi-reputation`, `roundfi-yield-kamino`, indexer, and SDK by
> Adevar Labs. Initial report (2026-05 W1) catalogued 20 findings;
> re-audit (2026-05 W2) against an updated snapshot added 8 more for
> a total of 28.
>
> **Audit report (full text):** [`ADEVAR_AUDIT_REPORT.md`](../../ADEVAR_AUDIT_REPORT.md) in repo root (history at commit `03f8030`).

## Status legend

| Status               | Meaning                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- |
| 🟢 **Closed**        | Fix merged to `main`, validated, and either covered by a regression test or pinned by an invariant. |
| 🟡 **Deferred**      | Acknowledged and scheduled — work item exists, but not a launch blocker per current risk assessment. |
| 🟠 **Blocked**       | Fix path identified but waiting on an upstream dependency to clear.                       |
| 🔵 **Won't fix**     | Intentional design, documented as such; reviewer signed off on the trade-off.             |

## Findings

### Critical

| SEV    | Status     | PR                                                                                         | Title                                                          | Note                                                                                                  |
| ------ | ---------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| SEV-001 | 🟢 Closed | [#326](https://github.com/alrimarleskovar/roundfinancial/pull/326)                         | `c_token_account` unvalidated in `roundfi-yield-kamino::Deposit` | Fund-loss vector — Kamino c-tokens could be redirected to attacker account. Added ATA constraint on the account struct. |
| SEV-002 | 🟢 Closed | [#327](https://github.com/alrimarleskovar/roundfinancial/pull/327)                         | `GRACE_PERIOD_SECS = 60` devnet patch leaked to production     | Reverted to 7 days (`604_800s`). Pinning test now asserts the prod value. Pattern audit follow-up: [PR #340](https://github.com/alrimarleskovar/roundfinancial/pull/340). |

### High

| SEV    | Status     | PR                                                                                         | Title                                                          | Note                                                                                                  |
| ------ | ---------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| SEV-003 | 🟢 Closed | [#329](https://github.com/alrimarleskovar/roundfinancial/pull/329)                         | `harvest_yield.lp_share_bps` caller-controlled, breaks policy  | Reading from `ProtocolConfig.lp_share_bps` now (authoritative). Caller no longer chooses the split.   |
| SEV-004 | 🟢 Closed | [#329](https://github.com/alrimarleskovar/roundfinancial/pull/329)                         | `init_pool_vaults` double-counts `committed_protocol_tvl_usdc` | Idempotency flag on the pool struct guards re-invocation.                                             |
| SEV-005 | 🟢 Closed | [#329](https://github.com/alrimarleskovar/roundfinancial/pull/329)                         | `close_pool` does not transition `pool.status`                 | Status now flips to `Completed` on success; re-invocation guarded by status check.                    |
| SEV-021 | 🟢 Closed | [#337](https://github.com/alrimarleskovar/roundfinancial/pull/337)                         | Reputation authority rotation lacked timelock                  | Mirrored `propose / cancel / commit` pattern from core; 7-day timelock (`REPUTATION_AUTHORITY_TIMELOCK_SECS`). |
| SEV-022 | 🟢 Closed | [#337](https://github.com/alrimarleskovar/roundfinancial/pull/337)                         | Core paused state coupled reputation `attest` from Pool PDA    | Pause check moved into handler, gated on `is_pool_pda` — pool-PDA CPI bypasses pause; admin-direct still blocked. |

### Medium

| SEV    | Status      | PR                                                                                         | Title                                                          | Note                                                                                                  |
| ------ | ----------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| SEV-006 | 🟢 Closed  | [#331](https://github.com/alrimarleskovar/roundfinancial/pull/331)                         | `propose_new_treasury` accepts any pubkey without USDC ATA check | Added ATA validation: new treasury must be a USDC ATA before propose succeeds.                       |
| SEV-007 | 🟢 Closed  | [#332](https://github.com/alrimarleskovar/roundfinancial/pull/332)                         | Reputation level monotonic-up — defaulter retains tier         | Default now demotes level (set to `LEVEL_MIN` on default). Re-entry uses fresh stake bps.            |
| SEV-008 | 🟢 Closed  | [#332](https://github.com/alrimarleskovar/roundfinancial/pull/332)                         | `revoke` uses current identity-verification, not at-attest-time | Each attestation now stores `verified_at_attest` bool; revoke uses that snapshot.                    |
| SEV-009 | 🟢 Closed  | [#330](https://github.com/alrimarleskovar/roundfinancial/pull/330)                         | `/webhook/helius` unauthenticated POST                         | HMAC signature verification added on the webhook handler.                                            |
| SEV-010 | 🟢 Closed  | [#330](https://github.com/alrimarleskovar/roundfinancial/pull/330)                         | `B2B_API_KEY_SALT` placeholder in `.env.example`               | Placeholder replaced with `<REPLACE_BEFORE_DEPLOY>` sentinel; loader refuses to start if sentinel is unchanged. |
| SEV-011 | 🟢 Closed  | [#333](https://github.com/alrimarleskovar/roundfinancial/pull/333)                         | `cargo audit` / `cargo deny` in advisory-only mode             | Flipped to required CI gates with a narrow RUSTSEC ignore list documented in-line.                   |
| SEV-012 | 🟠 Blocked | —                                                                                          | bankrun tests don't run in CI                                  | Upstream-blocked on mpl-core Anchor 0.31 support ([mpl-core#282](https://github.com/metaplex-foundation/mpl-core/issues/282)). Local PR [#319](https://github.com/alrimarleskovar/roundfinancial/pull/319) kept as draft. |
| SEV-023 | 🟢 Closed  | [#338](https://github.com/alrimarleskovar/roundfinancial/pull/338)                         | `MIN_CYCLE_DURATION = 60s` devnet shortcut                     | Reverted to `86_400s` (1 day). Same family as SEV-002. Pattern audit follow-up: [PR #340](https://github.com/alrimarleskovar/roundfinancial/pull/340). |
| SEV-024 | 🟢 Closed  | [#338](https://github.com/alrimarleskovar/roundfinancial/pull/338)                         | `fee_bps_yield` had no upper bound (`<= MAX_BPS = 10_000`)     | Capped at `MAX_FEE_BPS_YIELD = 3_000` (30%, 1.5x default). Bounds the blast-radius of an authority compromise. |

### Low

| SEV    | Status     | PR                                                                                         | Title                                                          | Note                                                                                                  |
| ------ | ---------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| SEV-013 | 🟢 Closed | [#330](https://github.com/alrimarleskovar/roundfinancial/pull/330)                         | Commit-reveal salt is `u64` — seller can compromise privacy   | Added entropy floor check on the salt; `escape_valve_list_commit` rejects low-entropy salts.         |
| SEV-014 | 🟢 Closed | [#336](https://github.com/alrimarleskovar/roundfinancial/pull/336)                         | Indexer decoder de-synced from `msg!` emissions               | Decoder + schema realigned to program's actual emission format; regression test added.               |
| SEV-015 | 🟢 Closed | [#335](https://github.com/alrimarleskovar/roundfinancial/pull/335)                         | Commit-reveal listing has no cancel-path for `Pending` slot   | Added `cancel_pending_listing` instruction — seller-only abort, slot freed atomically.               |
| SEV-016 | 🟢 Closed | [#334](https://github.com/alrimarleskovar/roundfinancial/pull/334)                         | Shared escrow vault — partial-pay edge in `release_escrow`    | Partial-pay path now correctly checkpoints; SEV-016 specifically called out in release_escrow comment. |
| SEV-025 | 🟢 Closed | [#339](https://github.com/alrimarleskovar/roundfinancial/pull/339)                         | Pool defaults made the pool inviable                          | `DEFAULT_INSTALLMENT_AMOUNT` bumped 416 → 600 USDC. Pool float now `24×600×0.74 = 10_656 >= 10_000 credit`. Viability invariant pinned by test. |
| SEV-026 | 🟡 Deferred | —                                                                                          | `settle_default` cascade duplication                          | Drift-risk maintenance refactor. Not a fund-loss vector — duplicate logic across two settle paths produces same state. Scheduled for a Fase 5 cleanup PR. |
| SEV-027 | 🟢 Closed | [#339](https://github.com/alrimarleskovar/roundfinancial/pull/339)                         | Admin-direct `SCHEMA_PAYMENT` had no cooldown                 | 60s `MIN_ADMIN_ATTEST_COOLDOWN_SECS` floor added. Anti-spam against trivial-loop score-pumping.      |

### Informational

| SEV    | Status         | PR                                                                                         | Title                                                          | Note                                                                                                  |
| ------ | -------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| SEV-017 | 🟢 Closed     | [#334](https://github.com/alrimarleskovar/roundfinancial/pull/334)                         | `join_pool` accepts `nft_asset` as arbitrary `Signer`         | Documented in nft_asset comment; the signer is the asset-issuer authority, not a member wallet. Doc-only clarification. |
| SEV-018 | 🔵 Won't fix  | —                                                                                          | `settle_default` bypasses `paused` flag                       | **Intentional design.** Documented in `settle_default.rs:N` — pause must not block default settlement, otherwise an attacker could pause to grief honest members past their grace deadline. Acknowledged by auditor as design-correct. |
| SEV-019 | 🟢 Closed     | [#328](https://github.com/alrimarleskovar/roundfinancial/pull/328)                         | CHANGELOG missed yield-kamino `c_token_account` fix           | Honest-framing update to `docs/security/audit-readiness.md` and changelog.                            |
| SEV-020 | 🟢 Closed     | [#328](https://github.com/alrimarleskovar/roundfinancial/pull/328)                         | `approved_yield_adapter` could be locked at vulnerable adapter | Added `lock_approved_yield_adapter()` op-guard with explicit warning + ceremony procedure documented. |
| SEV-028 | 🟢 Closed     | [#339](https://github.com/alrimarleskovar/roundfinancial/pull/339)                         | `refresh_identity` swallowed the underlying error             | Captured `Err(e)` and `msg!`-logged it before flipping status to `Revoked`. Improves operator forensics on revocations. |

## Summary

| Severity      | Total | 🟢 Closed | 🟡 Deferred | 🟠 Blocked | 🔵 Won't fix |
| ------------- | ----- | --------- | ----------- | ---------- | ------------ |
| Critical      | 2     | 2         | 0           | 0          | 0            |
| High          | 5     | 5         | 0           | 0          | 0            |
| Medium        | 9     | 8         | 0           | 1          | 0            |
| Low           | 7     | 6         | 1           | 0          | 0            |
| Informational | 5     | 4         | 0           | 0          | 1            |
| **Total**     | **28**| **25**    | **1**       | **1**      | **1**        |

**Mainnet-blocker status:** the only Critical / High findings are 🟢 Closed.
The remaining 🟠 Blocked entry (SEV-012, bankrun-in-CI) is a coverage-gap finding,
not a vulnerability — the underlying tests run locally. The 🟡 Deferred entry
(SEV-026, cascade duplication) is a maintenance-refactor with no fund-loss
shape. The 🔵 Won't-fix entry (SEV-018, settle_default bypass) is design-correct
and acknowledged by the auditor.

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

## Disclosure timeline

| Date       | Event                                                                  |
| ---------- | ---------------------------------------------------------------------- |
| 2026-05-W1 | Adevar Labs initial report (SEV-001..SEV-020). 20 findings.            |
| 2026-05-W1 | Critical fixes shipped (SEV-001, SEV-002). PRs #326, #327.             |
| 2026-05-W1 | High fixes shipped (SEV-003..SEV-005). PR #329.                        |
| 2026-05-W2 | Medium + Low + Informational batch (SEV-006..SEV-020). PRs #328 .. #336. |
| 2026-05-W2 | Adevar Labs re-audit report (SEV-021..SEV-028). 8 new findings.        |
| 2026-05-W2 | Re-audit fixes shipped (SEV-021..SEV-025, SEV-027, SEV-028). PRs #337..#339. |
| 2026-05-15 | Pattern-fingerprint sweep + this tracker page published. PR #340.      |

## See also

- [`ADEVAR_AUDIT_REPORT.md`](../../ADEVAR_AUDIT_REPORT.md) — full original audit report (Portuguese, technical).
- [`constants-audit-2026-05.md`](./constants-audit-2026-05.md) — post-audit pattern sweep covering the SEV-002 / SEV-023 family.
- [`audit-readiness.md`](./audit-readiness.md) — strategic context for the engagement.
- [`bug-bounty.md`](./bug-bounty.md) — ongoing disclosure policy post-audit.

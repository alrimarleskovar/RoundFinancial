# Agave 2.x Migration — Risk Plan & Rollout

> **Purpose:** unblock issue [#230](https://github.com/alrimarleskovar/RoundFinancial/issues/230) by enumerating the risks + mitigation steps for coordinated toolchain bump from Solana 1.18.26 to Anza Agave 2.x.
>
> **Status:** **research only — no migration executed yet.** This doc is the team's pre-flight before the coordinated PR lands.
>
> **Audience:** RoundFi engineering (toolchain owners) + audit firm pre-engagement liaison.

## TL;DR

**Recommendation: schedule a 2-week dedicated sprint after external audit findings land, NOT before.** Justification: migration risk surface is large (5 cascading dependency bumps + bytecode change + devnet redeploy), and rushing it pre-audit means the auditor reviews a moving target.

**Pre-audit posture:** keep advisory `|| true` on cargo-audit + cargo-deny (current state); document transient RustSec IDs honestly in `audit-readiness.md`; explain the deferment in the audit kickoff brief.

**Post-audit:** execute the migration as one coordinated PR (template: PR #138 / #139 — original Agave 1.18 pin).

## Why this is hard

The pin chain is **5 dimensions deep** and each piece has compatibility constraints with the others:

| #   | Pin            | Current | Target           | Reason locked                                                        |
| --- | -------------- | ------- | ---------------- | -------------------------------------------------------------------- |
| 1   | Solana CLI     | 1.18.26 | Agave 2.x stable | Forced by verifiable-build Docker image                              |
| 2   | platform-tools | v1.51   | v1.52+           | Bundled with the Solana version above                                |
| 3   | Anchor         | 0.30.1  | 0.31+            | Required for `Span::source_file` removal in IDL build                |
| 4   | mpl-core       | 0.8.0   | 0.x.next         | Solana-pubkey 2.x compatibility (host-side type conflict — see #229) |
| 5   | borsh          | 1.5.7   | 1.6.x            | Required for Cargo.lock v4 + modern Solana                           |
| 6   | Cargo.lock     | v3      | v4               | Forced by modern Cargo + Solana 2.x                                  |

Bumping any one alone leaves the others incompatible. Must move as a coordinated set.

## Risk register

### R1 — Bytecode drift requires devnet redeploy

**Severity:** ⛔ Mainnet-blocker (planned redeploy anyway)

**Description:** The toolchain bump changes `roundfi_core.so` / `roundfi_reputation.so` / `roundfi_yield_kamino.so` bytecode. OtterSec verify-build attestation PDAs become invalid.

**Mitigation:**

- Land migration on a **separate redeploy sprint** with explicit verify-build refresh in the same PR
- Use the existing reproducible-build pipeline (`solanafoundation/solana-verifiable-build:` Docker image)
- Refresh all 4 attestation PDAs in one operation per [`docs/verified-build.md`](../verified-build.md)

**Rollback:** keep 1.18.26 deployment scripts in git history; can pin back if Agave 2.x surfaces critical bugs on devnet.

### R2 — mpl-core API drift breaks `escape_valve_buy`

**Severity:** 🔴 High (single biggest unknown)

**Description:** `mpl-core 0.8 → 0.x.next` likely has breaking API changes on:

- `TransferV1` instruction signature
- Plugin authority management (FreezeDelegate, TransferDelegate)
- Asset re-anchor logic (post-PR #123 fix relies on specific plugin behavior)

The PR #123 mpl-core production-bug fix is **load-bearing for the Triple Shield** — any mpl-core upgrade must preserve the `AssetTransferIncomplete` + `AssetNotRefrozen` defense-in-depth.

**Mitigation:**

- Before bump: read mpl-core CHANGELOG for 0.8 → target version
- Write a smoke test that exercises the `escape_valve_buy` re-anchor path with new mpl-core BEFORE merging migration PR
- Snapshot the bankrun test output from PR #123 era; compare post-migration to confirm same defense-in-depth fires

**Rollback:** if mpl-core upgrade breaks NFT instructions, freeze mpl-core at 0.8 and accept the borsh/Cargo.lock pin chain stays partial.

### R3 — Anchor 0.31+ requires IDL regeneration

**Severity:** 🟡 Medium

**Description:** Anchor 0.30 → 0.31 changed the IDL format. `app/public/idls/*.json` files become stale; SDK generated bindings need refresh; the `--no-idl` workaround currently in `ci.yml:174-182` can come off.

**Mitigation:**

- After migration, regenerate IDLs via `anchor idl build` (which works on Agave 2.x without the `Span::source_file` panic that broke it on 1.18)
- Verify SDK generation pipeline (`sdk/src/generated/`) still produces consistent types
- Update `app/src/lib/devnet.ts` if program ID layouts shift (they shouldn't, but verify)

### R4 — Verify-build Docker image lag

**Severity:** 🟡 Medium

**Description:** OtterSec's `solanafoundation/solana-verifiable-build:` image is mainnet-only and follows Solana's stable release cadence. The Agave 2.x image may not exist when we want to migrate; we'd need to either:

- Wait for Solana Foundation to publish the 2.x image (likely 4-8 weeks after Agave 2.x stable)
- Build our own verify-build image (adds reproducibility-claim audit surface)

**Mitigation:**

- Track Solana Foundation image release before scheduling migration sprint
- If forced to self-build, publish the Dockerfile + signature in `docs/verified-build.md` so auditor can reproduce

### R5 — Cargo.lock v3 → v4 incompatibility

**Severity:** 🟢 Low (well-trodden upgrade path)

**Description:** Cargo.lock v3 was a transitional format. v4 is the default for modern Cargo (1.78+). Some older tooling can't parse v4.

**Mitigation:**

- Verify Solana CI tooling on Agave 2.x reads Cargo.lock v4 (likely yes)
- Verify `solanafoundation/solana-verifiable-build:` on Agave 2.x reads v4 (this was a blocker in 1.18 era per `docs/verified-build.md` troubleshooting)

### R6 — Borsh 1.5.7 → 1.6.x serialization compatibility

**Severity:** 🟢 Low (semver-minor)

**Description:** Borsh 1.5 → 1.6 is semver-minor; on-chain account layouts should serialize identically. Edge case: enum tag bytes for `IdentityProvider::Civic` (or successor — see [#227](https://github.com/alrimarleskovar/RoundFinancial/issues/227)).

**Mitigation:**

- Run `tests/parity.spec.ts` after migration — it asserts Rust ↔ TS encoders byte-for-byte
- Spot-check account binary diffs on a devnet pool before redeploy

### R7 — Cascading dependency surface (transitive crates)

**Severity:** 🟢 Low (but tedious)

**Description:** Bumping `solana-program 1.18 → 2.x` updates ~80 transitive crates. Some have API breaks (e.g., `curve25519-dalek`, `ed25519-dalek-bip32`, `sha2`). Most are fix-on-recompile.

**Mitigation:**

- Time-box: 1 dev × 3 days to chase compile errors after the initial bump
- If a transitive crate has an irreconcilable API break, pin to a fork until upstream catches up

## Cascading benefits (once it lands)

Migration unlocks:

1. **CI tightens** — `cargo audit` + `cargo deny` flip from advisory (`|| true`) to required gates. Zero unaddressed RustSec IDs.
2. **`anchor build` without `--no-idl`** — IDL builds clean; `app/public/idls/*` no longer empty stubs.
3. **Host-side clippy lane** unblocks for the rest of `roundfi-core` (already unlocked for `roundfi-math` per #229; rest of the program waits on mpl-core's host-side Pubkey fix that ships with mpl-core 0.x.next).
4. **`audit-readiness.md` language tightens** — remove the transient-advisory caveat.
5. **`AUDIT_SCOPE.md` toolchain section** updates — reviewers see the mainnet-target toolchain, not a sunset 1.x.

## Recommended sequencing

**Phase 1 (now → audit kickoff):** keep 1.18.26 pinned. Document everything honestly. Don't migrate.

**Phase 2 (during audit, weeks 1-2):** prep work — read mpl-core CHANGELOG, identify breaking changes, write smoke tests.

**Phase 3 (post-audit findings, week 1):** coordinated migration PR. Template: PR #138 + #139.

- Single PR, single review cycle
- Single devnet redeploy + verify-build refresh
- All CI lanes flip from advisory to required in the same PR

**Phase 4 (post-migration, week 1):** docs sweep — remove pin justifications, simplify `verified-build.md` troubleshooting.

## Open questions

Before starting Phase 3:

1. **Verify-build Docker image availability** — has Solana Foundation published the Agave 2.x image yet? (Track via [solana-foundation/verifiable-build](https://github.com/solana-foundation/verifiable-build))
2. **mpl-core 0.x.next release date** — when does the upgrade-compatible version ship?
3. **Audit firm preference** — does Halborn/Ottersec/Sec3/Adevar prefer reviewing 1.x or 2.x? Some firms have specific toolchain familiarity.
4. **Kamino SDK target** — modern Kamino integrations target Agave 2.x; coordinating with Kamino harvest path completion [#233](https://github.com/alrimarleskovar/RoundFinancial/issues/233) makes sense.

## Acceptance criteria (when Phase 3 PR lands)

From [#230](https://github.com/alrimarleskovar/RoundFinancial/issues/230):

- [ ] `anchor build` (without `--no-idl`) clean on Agave 2.x
- [ ] `cargo audit` exits 0 — zero unaddressed RustSec IDs
- [ ] `cargo deny check` exits 0 — zero ignored advisories
- [ ] CI lane names drop the `(advisory)` suffix
- [ ] Devnet redeployed against new toolchain; OtterSec attestation PDAs refreshed
- [ ] Docs updated (verified-build, audit-readiness, audit-scope)

## Cross-refs

- Issue [#230](https://github.com/alrimarleskovar/RoundFinancial/issues/230) — implementation tracking
- PR [#138](https://github.com/alrimarleskovar/RoundFinancial/pull/138) + [#139](https://github.com/alrimarleskovar/RoundFinancial/pull/139) — original Agave 1.18 pin landing (migration PR template)
- [`docs/verified-build.md`](../verified-build.md) — current pin justification
- [`.github/workflows/ci.yml:68-84`](../../.github/workflows/ci.yml) — pin blocker comment
- [`deny.toml`](../../deny.toml) — advisory-only ignore placeholder

---

_Last updated: May 2026. Update with Phase 3 PR number when migration sprint ships._

# ADR 0011 — Social recovery for member positions via a designated recovery wallet + time-lock

**Status:** 🟡 Proposed
**Date:** 2026-07-03
**Decision-makers:** RoundFi team (Alrimar, Caio)
**Related:** SEV-051 (wallet-loss / liveness thread); origin — Caio (backup-wallet idea). No implementing PR yet: this ADR precedes implementation and gates it.

## Context

A RoundFi member's on-chain footprint is substantial and fully non-custodial. Per pool they join, a `Member` PDA (`[b"member", pool, wallet]`) holds their stake, escrow, contribution history, payout slot, and a Metaplex-Core position NFT. Across the protocol, a `ReputationProfile` (keyed by wallet) plus an append-only trail of `Attestation` PDAs (`[b"attestation", issuer, subject, schema_id, nonce]`, with `subject = wallet`) hold the behavioral-credit score that is the product's core asset. All of it is authorized solely by the member's wallet key.

If that key is lost — seed phrase gone, device wiped — every bit of it is stranded: the stake + escrow sit in program PDAs no one can authorize, and months of reputation are unrecoverable. For RoundFi's target user (non-crypto-native, multi-month ROSCA horizons) wallet loss is not an edge case; it is an expected lifetime event, and "lose your phone → lose your money **and** your credit history" is fatal to trust and retention.

We want **trustless, on-chain** recovery: a member designates a backup wallet up front, and if the primary is lost, an on-chain process moves their positions + reputation to the backup — with no privileged operator able to seize a live member's position. Two hard constraints shape the design:

1. **Wallet is in the `Member` PDA seed** (`[b"member", pool, wallet]`), so a new wallet derives a _different_ PDA — there is no in-place "rename."
2. **Reputation is wallet-bound and append-only** — each `Attestation` fixes `subject = wallet` in its seed and is never mutated; the `ReputationProfile` is keyed by wallet.

The protocol already ships a trustless rotation primitive we can mirror: treasury/authority rotation is `propose → time-lock → anyone-commits → cancellable` (`propose_new_treasury` → `TREASURY_TIMELOCK_SECS` → `commit_new_treasury`, abortable via `cancel_new_treasury`). It is the right shape for recovery — it completes even if the proposer's _other_ key is offline, and it is abortable by the party actually in control.

## Decision

We will add **opt-in social recovery via a single designated recovery wallet, gated by a time-lock and a primary-wallet cancel**, mirroring the treasury-rotation pattern. Not M-of-N guardians (v1).

New instructions on a per-member (or per-identity) `Recovery` account:

1. `set_recovery_wallet(recovery)` — **signed by the primary wallet.** Stores / updates / clears `recovery_wallet`. Registration is the root of trust, so it must be primary-signed and freely revocable.
2. `initiate_recovery()` — **signed by the recovery wallet.** Sets `recovery_eta = now + RECOVERY_TIMELOCK_SECS` (proposed **14 days** — longer than treasury's 7, since a stranded-key claimant has no urgency and the blast radius is a full position). Emits an event; the indexer fires the existing e-mail channel to the primary ("someone started recovery on your account").
3. `cancel_recovery()` — **signed by the primary wallet.** Aborts an in-flight recovery. This is the escape hatch: if the primary is actually still in control, a hostile recovery attempt is a no-op they cancel within the window.
4. `commit_recovery()` — **callable by anyone** after `recovery_eta`. Performs the migration.

For the migration mechanics (the genuinely hard part), v1 will **close-and-recreate each `Member` PDA** under the recovery wallet — copying the financial state verbatim and transferring the position NFT — and **link the old → new wallet for reputation** by extending the existing identity-link mechanism (`IdentityRecord` / `link_passport_identity`) so scoring reads across both keys rather than trying to move immutable attestations. The exact per-account choreography, rent ownership, and D/C-invariant preservation during the copy are deferred to a security design doc (`docs/security/social-recovery.md`) that must land + be auditor-reviewed **before** any code.

## Consequences

- ✅ Wallet loss stops being catastrophic — positions + reputation survive it, a real retention/trust unlock for non-crypto-native users.
- ✅ Reuses a **proven, already-audited trust pattern** (propose / time-lock / commit / cancel) instead of inventing a new one.
- ✅ Trustless + liveness-friendly: `commit_recovery` is permissionless (like the other cranks), so recovery completes even if the recovery wallet also goes quiet after initiating.
- ⚠️ **Abuse surface exists and is bounded by the time-lock + cancel + alert**: a hostile recovery wallet can _start_ recovery, but the 14-day window, the primary-only cancel, and the e-mail alert give the real owner time to stop it. If the primary is _also_ compromised, recovery is not the marginal risk (the attacker already holds the primary). Residual: a member who registers a recovery wallet and then loses **both** keys is unrecoverable — same as today.
- ⚠️ **Reputation history is linked, not moved** — the audit trail stays under the old wallet; scoring aggregates the link. Auditors must sign off that link-based aggregation preserves the anti-gaming invariants (per-`(subject, pool)` duplicate suppression, identity floors).
- ❌ We accept a **non-trivial on-chain surface**: a new account + 4 instructions + a migration path touching `Member`, the position NFT, and the reputation link. This is a foundational feature, not a quick add; it needs its own security review and likely a fuzz/property pass on the state copy.

## Alternatives considered

### M-of-N guardians (Argent / Loopring-style)

Stronger security (no single recovery key to steal), but materially more complex UX + on-chain state (guardian sets, approvals, quorum). Overkill for v1 and a poor fit for non-crypto-native users who struggle to nominate three reliable guardians. Revisit for v2 if the single-wallet model proves too weak.

### "Effective-owner" indirection (identity owns positions; wallets are hot-swappable keys)

The _architecturally correct_ long-term design: a `Member` keyed by a stable identity PDA, with wallets as attachable / detachable keys, so recovery is a single cheap key-swap and reputation moves for free. Rejected for **v1** because it re-seeds every `Member` PDA and rewrites every `signer == member.wallet` check across `join_pool` / `contribute` / `claim_payout` / `settle_default` / escape-valve — too invasive to land safely now. Recorded as the intended v2 direction; the v1 close-and-recreate migration should be designed forward-compatible with it.

### Wallet-provider / seed-phrase recovery (off-protocol)

Relying on the wallet layer (embedded-wallet social login, MPC, Phantom recovery) moves the problem downstream. Complementary, not sufficient: it doesn't help a user who loses a self-custody seed, and RoundFi can't guarantee any given wallet's recovery UX. We should still _recommend_ a recoverable wallet, but the protocol needs its own answer for the positions + reputation it custodies in PDAs.

### Do nothing

Status quo: wallet loss = total loss of funds + reputation. Rejected — incompatible with the retention thesis and the "your reputation is a portable asset you own" pitch.

## References

- Member account + seed: `programs/roundfi-core/src/state/member.rs:1-36` (seed `[b"member", pool, wallet]`)
- Reputation binding: `programs/roundfi-reputation/src/state/attestation.rs:92` (`subject` fixed in seed), `programs/roundfi-reputation/src/state/profile.rs`
- Pattern to mirror: `programs/roundfi-core/src/instructions/{propose,commit,cancel}_new_treasury.rs`
- Identity-link hook: `IdentityRecord` + `link_passport_identity` (roundfi-reputation)
- Origin: Caio (backup-wallet idea); SEV-051 wallet-loss thread
- Follow-up (required before code): `docs/security/social-recovery.md` — migration choreography + full abuse model

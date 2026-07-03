# Social Recovery — Migration Choreography & Abuse Model

> **🚧 Status: DESIGN DRAFT — deferred feature, NOT implemented.**
> This is the pre-implementation security design for the social-recovery
> feature proposed in [ADR 0011](../adr/0011-social-recovery-member-positions.md).
> Per the 2026-07-03 review (Caio), implementation is **deferred past the
> pre-canary phase** — the permissionless `crank_payout` (SEV-051) is the
> accepted interim answer for the "member disappears → the pool must not lock"
> case. **No on-chain code exists for anything below.** This document has to
> land + be auditor-reviewed before any recovery instruction is written; it is
> the choreography + threat model the eventual implementation must satisfy.

## Purpose & scope

A member's non-custodial footprint — per-pool `Member` PDAs (stake, escrow,
contributions, payout slot, position NFT) and their wallet-bound reputation —
is stranded if they lose their wallet key. ADR 0011 chooses **opt-in social
recovery via a single designated recovery wallet + time-lock + primary-cancel**,
mirroring the treasury-rotation pattern. This doc specifies the hard parts the
ADR deferred:

1. §1 — the `Member` PDA migration (the wallet is in the seed, so a new wallet
   is a new PDA — there is no rename).
2. §2 — the reputation link (attestations are append-only + wallet-bound).
3. §3 — **what happens to a member's active positions during a pending
   recovery** (freeze vs. continue) — flagged by Caio.
4. §4 — the abuse model.
5. §5 — open questions / auditor checklist.

Out of scope: the wallet layer (seed-phrase / MPC recovery is complementary,
see ADR 0011 alternatives) and the UI.

## The account + instruction flow (recap)

A per-member (or per-primary-wallet) `Recovery` account:

| field          | type     | notes                                                    |
| -------------- | -------- | -------------------------------------------------------- |
| `primary`      | `Pubkey` | the wallet being protected                               |
| `recovery`     | `Pubkey` | the designated backup; `default` = none                  |
| `recovery_eta` | `i64`    | 0 = no recovery in flight; else `initiate` ts + timelock |
| `bump`         | `u8`     |                                                          |

Four instructions, mirroring `{propose,commit,cancel}_new_treasury`:

| ix                    | signer       | effect                                                                                                                    |
| --------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `set_recovery_wallet` | **primary**  | set / update / clear `recovery`. Root of trust → must be primary-signed, freely revocable.                                |
| `initiate_recovery`   | **recovery** | require `recovery != default`, `recovery_eta == 0`; set `recovery_eta = now + TIMELOCK`; emit event → e-mail the primary. |
| `cancel_recovery`     | **primary**  | require `recovery_eta != 0`; reset `recovery_eta = 0`. The escape hatch.                                                  |
| `commit_recovery`     | **anyone**   | require `recovery_eta != 0 && now >= recovery_eta`; run the migration (§1–§2); reset.                                     |

`RECOVERY_TIMELOCK_SECS` proposed **14 days** (> treasury's 7): a stranded-key
claimant has no urgency, the blast radius is a full position, and the primary
needs a wide window to notice + cancel a hostile attempt. `commit_recovery` is
permissionless so recovery still completes if the recovery wallet also goes
quiet after initiating.

## §1 — `Member` PDA migration (close-and-recreate)

**Constraint.** `Member` PDA = `seeds = [b"member", pool, wallet]`
(`programs/roundfi-core/src/state/member.rs`). A new wallet derives a different
PDA. There is no in-place owner swap while the wallet is in the seed (the v2
"effective-owner indirection" in ADR 0011 removes this, but v1 does not).

**Choreography per pool the member is in** (one `commit_recovery` call may need
to iterate, or be called once per pool — an open question, §5):

1. Read the old `Member` PDA `[b"member", pool, primary]`.
2. Create the new `Member` PDA `[b"member", pool, recovery]`, funded by the
   caller (permissionless caller pays rent; reclaimed from the closed old
   account in step 4).
3. **Copy every field verbatim** so the position's economics + history are
   preserved: `slot_index`, `reputation_level`, `stake_bps`, `stake_deposited`,
   `contributions_paid`, `total_contributed`, `total_received`, `escrow_balance`,
   `on_time_count`, `late_count`, `defaulted`, `paid_out`,
   `last_released_checkpoint`, `joined_at`, and the D/C-invariant anchors
   `stake_deposited_initial`, `total_escrow_deposited`, `last_transferred_at`.
   Set `wallet = recovery`; recompute `bump`.
4. Close the old `Member` PDA; return rent to the caller (or the recovery
   wallet).

**Key subtleties the implementation must nail (auditor checklist):**

- **Where the USDC actually lives.** `stake_deposited` / `escrow_balance` are
  _bookkeeping_ on `Member`; the real USDC sits in the **pool's** vaults
  (`[b"escrow", pool]`, `[b"solidarity", pool]`, stake vault), keyed by pool,
  **not** by member. So migrating a member moves **no tokens** for stake/escrow
  — only the Member record. ✅ confirm this holds (no per-member token account
  to move) before relying on it.
- **The position NFT** (`Member.nft_asset`, mpl-core). Confirm its owner: if
  it is the **member wallet**, `commit_recovery` must `TransferV1` it to the
  recovery wallet; if it is the slot-keyed `position_authority` PDA
  (`[b"position", pool, slot_index]`), it is **not** wallet-bound and needs no
  transfer — the new Member at the same slot references the same authority.
  **This gates the whole design and must be resolved first.**
- **D/C invariant during the copy.** The `_initial` anchors
  (`stake_deposited_initial`, `total_escrow_deposited`) must copy **unchanged**
  — they are what `settle_default` reads. A copy that recomputed them would
  silently change the member's default math. Pin with a property test:
  `dc_invariant_holds` must give the identical result on the new PDA.
- **Idempotency / partial failure.** If `commit_recovery` migrates 3 of a
  member's 5 pools then fails, re-running must not double-create or skip. Design
  for a per-pool "migrated" marker or a deterministic resume.

## §2 — Reputation link (old → new)

**Constraint.** Each `Attestation` PDA fixes `subject = wallet` in its seed
(`[b"attestation", issuer, subject, schema_id, nonce]`,
`programs/roundfi-reputation/src/state/attestation.rs:92`) and is **never
mutated**; `ReputationProfile` is keyed by wallet. Attestations **cannot be
moved**.

**Approach: link, don't move.** Extend the existing identity mechanism
(`IdentityRecord` / `link_passport_identity`) so the recovery wallet's
`ReputationProfile` is bound to the same identity as the primary, and score
reads **aggregate across linked wallets**. The audit trail stays under the old
wallet (honest history); the score follows the human.

**Auditor checklist:**

- Link-based aggregation must preserve every anti-gaming invariant that assumes
  one wallet = one subject: the per-`(subject, pool)` `CycleComplete`
  duplicate-suppression, the identity-floor caps, the `SCORE_PAYMENT`
  rate-limit. A naive "sum both wallets" re-opens reputation farming (register a
  fresh wallet, link it, double-count). **This is the highest-risk part** and
  needs its own property tests.
- The link must be **one-directional and final** at commit (the old wallet
  can't later be re-linked elsewhere to fork the score).

## §3 — Active positions during a pending recovery (Caio)

The 14-day window is not quiet: pools advance, contributions come due, the
member may be contemplated, paid out, or defaulted. What happens to their live
positions between `initiate_recovery` and `commit_recovery`?

### Model A — freeze on `initiate` ❌ rejected

Mark the member's positions "recovery-pending" and block
contribute/claim/settle/crank until commit or cancel.

- ❌ **Re-introduces the liveness bug we just fixed.** If a frozen member is the
  contemplated slot, the pool can't advance for everyone — exactly the SEV-051
  lock that `crank_payout` exists to prevent.
- ❌ **Weaponizes recovery into a griefing tool.** Anyone who is set as (or
  compromises) a recovery wallet could `initiate_recovery` purely to **freeze a
  rival's position for up to 14 days**, then let it lapse. A protection
  mechanism must never become a denial-of-service primitive.

### Model B — continue, reconcile at commit ✅ recommended

Positions operate **normally** during the window — every path
(`contribute`, `claim_payout`, `settle_default`, the cranks) still works and is
still authorized by the **primary** wallet. `commit_recovery` reads the
**current** state of each `Member` at commit time (a snapshot-at-commit, not
snapshot-at-initiate) and migrates whatever it finds.

- ✅ No liveness harm, no griefing weapon — a pending recovery is purely a
  "who owns this position after the timelock" claim; it does not touch live
  operation.
- ✅ Self-consistent with the trust model: during the window the **primary**
  still signs everything. If the real owner is in control (hostile recovery),
  they operate normally **and** cancel. If the real owner is genuinely locked
  out (legit recovery), the position simply isn't operated by them — the
  protocol's permissionless paths (`crank_payout`, `settle_default`) keep the
  _pool_ healthy regardless, and commit transfers whatever remains.
- ⚠️ The migration is against a **moving target** — commit must correctly copy a
  member who changed slot state / paid / defaulted / got paid-out mid-window.
  §1's snapshot-at-commit copy handles this by construction, but it must be
  tested against each mid-window transition.

**Recommendation: Model B.** Freezing is strictly worse (liveness + griefing).

### Residual flagged for §5

Under Model B, if the member is **contemplated and cranked** (`crank_payout`)
during the window while the real owner is locked out, the credit is delivered
to the **lost wallet's own ATA** — and migrating the `Member` PDA does **not**
claw back USDC already sitting in that ATA. That USDC is stranded. Whether
recovery should also cover the member's token account, or whether a pending
recovery should re-route a crank's delivery, is an open question (§5) — it is
**not** a reason to freeze (Model A's cure is worse).

## §4 — Abuse model

| #   | Threat                                                                         | Mitigation                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Attacker sets themselves as recovery, then `initiate` to steal a live position | The **14-day timelock + primary-only `cancel` + e-mail alert**. Registration itself is primary-signed, so an attacker can't set `recovery` without already holding the primary. |
| 2   | Primary is **also** compromised                                                | Out of scope — the attacker already holds the primary; recovery is not the marginal risk. (Wallet-layer hygiene is the mitigation.)                                             |
| 3   | Griefing: `initiate` purely to freeze a position                               | **Model B (§3)** — a pending recovery does not freeze anything. Removes the primitive entirely.                                                                                 |
| 4   | Front-run / race the permissionless `commit`                                   | `commit` is idempotent-by-outcome (state ends the same regardless of caller); the caller only pays rent, gains nothing. No MEV.                                                 |
| 5   | Repeated `initiate` / `cancel` churn                                           | `initiate` requires `recovery_eta == 0` (one in flight at a time). Consider a per-primary cooldown if e-mail-spam becomes a vector.                                             |
| 6   | Recovery wallet set long ago, later sold/compromised                           | Primary can `set_recovery_wallet` to rotate/clear at any time; the alert gives a 14-day notice even if they forgot.                                                             |
| 7   | Reputation double-count via link (§2)                                          | The link aggregation must preserve per-`(subject,pool)` suppression + identity floors; **highest-risk item**, needs property tests.                                             |

## §5 — Open questions (must resolve before code)

1. **Position NFT ownership** (§1) — wallet-owned (transfer needed) vs
   slot-authority-owned (no transfer). Gates the whole design.
2. **One `commit` vs one-per-pool** — can a single tx migrate all of a member's
   pools (compute/account limits), or is commit per-(recovery, pool)? Affects
   the idempotency/resume design.
3. **Stranded mid-window crank delivery** (§3 residual) — does recovery cover
   the member's ATA, or re-route a crank during a pending recovery, or accept
   the residual as a documented limitation?
4. **Reputation link finality + anti-farming** (§2) — the exact aggregation
   rule + its property tests.
5. **Rent economics** — permissionless caller funds the new PDA + reclaims from
   the closed old one; confirm net-neutral (or who eats the delta).
6. **Recovery of a defaulted / paid-out member** — confirmed OK to transfer
   as-is (the new wallet inherits the history + liabilities), but state it
   explicitly in the UI so the recovering user isn't surprised.

## §6 — Pre-implementation checklist

- [ ] Resolve §5.1 (NFT ownership) — read `join_pool` CreateV2 owner.
- [ ] Prototype the close-and-recreate copy behind a property test asserting
      `dc_invariant_holds` is identical pre/post.
- [ ] Design the reputation-link aggregation + its anti-farming property tests
      (§2, §4.7).
- [ ] Bankrun spec for each §3 mid-window transition (contribute / claim / crank
      / settle during a pending recovery, then commit).
- [ ] Threat-model review of this doc by the eventual external auditor.
- [ ] Only then: write `set/initiate/cancel/commit_recovery`.

## References

- ADR: [`../adr/0011-social-recovery-member-positions.md`](../adr/0011-social-recovery-member-positions.md)
- Member account + seed: `programs/roundfi-core/src/state/member.rs`
- Attestation subject-in-seed: `programs/roundfi-reputation/src/state/attestation.rs:92`
- Pattern mirrored: `programs/roundfi-core/src/instructions/{propose,commit,cancel}_new_treasury.rs`
- Interim liveness answer: `programs/roundfi-core/src/instructions/crank_payout.rs` (SEV-051)

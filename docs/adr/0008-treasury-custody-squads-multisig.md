# ADR 0008 — Treasury custody via Squads multisig (external ATA, not program PDA)

**Status:** ✅ Accepted
**Date:** 2026-05-19
**Decision-makers:** Engineering
**Related:** PR #400 (this ADR + treasury-management runbook), Step 4 of [`squads-multisig-procedure.md`](../operations/squads-multisig-procedure.md#step-4--rotate-the-treasury-if-applicable)

## Context

`ProtocolConfig.treasury` (see [`programs/roundfi-core/src/state/config.rs:8`](../../programs/roundfi-core/src/state/config.rs)) stores the **pubkey of an external SPL `TokenAccount`** on the protocol's USDC mint — not a PDA owned by `roundfi-core`. The treasury is funded by SPL `transfer` CPI from in-program flows (`harvest_yield` step 1, future cycle-fee paths), and the owner of that ATA controls withdrawals using the standard SPL `transfer` instruction — no roundfi-core instruction is involved.

The bootstrap chain is:

1. At `initialize_protocol` (see [`initialize_protocol.rs:46-48,76`](../../programs/roundfi-core/src/instructions/initialize_protocol.rs)) the deployer supplies an existing USDC ATA — typically owned by the deployer keypair — and `config.treasury = treasury.key()`.
2. Step 4 of the Squads ceremony ([`squads-multisig-procedure.md` §Step 4](../operations/squads-multisig-procedure.md#step-4--rotate-the-treasury-if-applicable)) creates a new USDC ATA owned by the Squads vault PDA and rotates `config.treasury` to it via `propose_new_treasury` → 7d wait → `commit_new_treasury`.
3. From that point on, every USDC unit that lands in the treasury ATA is custodially controlled by the Squads multisig vault PDA. Withdrawals are normal SPL `transfer`s signed via Squads' propose/approve/execute flow.

The Cofre Solidário (solidarity vault) for participants is a **separate** PDA owned by the program — that's a different custody surface and not in scope for this ADR. This ADR is specifically about the protocol-fee sink.

**The forcing question** (raised internally on 2026-05-19): "how does the protocol owner extract revenue?" The premise behind the question was that a `withdraw_treasury` instruction needed to be added to roundfi-core, with on-chain rate-limit + recipient allowlist. Investigation surfaced that withdrawal is already a solved problem at the custody layer (Squads-signed SPL transfer) — the protocol-code addition would require first **migrating the treasury from external ATA to program-owned PDA**, which is a multi-day data + ix migration with non-trivial blast radius. The decision below records why we deliberately keep the existing pattern and what would justify migrating later.

## Decision

**We will keep `ProtocolConfig.treasury` as an externally-owned ATA (Squads multisig vault PDA, post-ceremony), and govern withdrawals via Squads — not via a new `roundfi-core` instruction.**

Concretely:

- **Custody:** the USDC ATA on `config.treasury` is owned by the Squads vault PDA (post-Step-4 of the ceremony). Withdrawals require a Squads proposal that reaches threshold (3-of-5) and is executed by any member.
- **Rate-limit + recipient policy:** enforced as **Squads spending policies** + the off-chain runbook in [`docs/operations/treasury-management.md`](../operations/treasury-management.md). NOT enforced in `roundfi-core` bytecode.
- **Rotation:** the existing `propose_new_treasury` → 7d → `commit_new_treasury` ix trio + the one-way `lock_treasury` kill switch govern which ATA receives future fees. They do **not** govern withdrawals from the current ATA — that's a Squads concern.
- **Indexer observability:** treasury inflow + outflow tracking is added at the indexer layer (PR #401) by indexing SPL transfers on `config.treasury`. The on-chain program emits no withdrawal event because it isn't the signer.
- **Admin UI:** read-only dashboard (PR #402) shows balance + lifetime inflows + recent withdrawals, fed by the indexer. Write actions happen in Squads' UI, not RoundFi's.

This is the same pattern used by every production Solana DeFi protocol we've audited the public state of: Drift's insurance fund + fee accounts, MarginFi's program fee account, Kamino's reserve fee receivers — all are externally-owned ATAs under multisig custody, not program-owned PDAs.

## Consequences

- ✅ **Zero on-chain code changes.** The roundfi-core surface is unchanged. No new ix, no new state field, no new audit-scope addition mid-freeze. Honors the `v0.4-canary` feature freeze recorded in `FREEZE.md`.
- ✅ **Squads' audited governance is the withdrawal control plane.** Threshold approval, member rotation, optional time-locks, spending limits, transaction history — all already shipped and audited by Squads' own [security reviews](https://docs.squads.so/main/security/audits). RoundFi inherits that surface instead of recreating it.
- ✅ **No state-size pressure on `ProtocolConfig`.** [`config.rs:213`](../../programs/roundfi-core/src/state/config.rs) shows only 18 forward-compat padding bytes remain — adding `total_collected (u64) + total_withdrawn (u64) + last_withdrawal_ts (i64) + recipient_allowlist ([Pubkey;5]) + allowlist_len (u8) + allowlist_locked (bool)` is ~194 bytes, which would force a sidecar PDA and re-pin the SEV-042 byte-layout coupling in `mainnet-hardening-check.ts`.
- ✅ **Mirrors industry norm.** Auditors don't have to re-learn a custom withdrawal surface; the Squads-as-treasury pattern is the default expectation.
- ✅ **Observability still possible.** Treasury inflow/outflow is fully visible on-chain — the indexer indexes SPL transfers on `config.treasury`, the admin dashboard reads from the indexer. Visibility is equivalent to what a program-owned PDA would provide via events.
- ⚠️ **Rate-limit + allowlist are policy, not bytecode.** A 3-member collusion can drain the treasury in one Squads tx without an on-chain rate-limit guard. Mitigation: Squads spending policies + the multisig threshold itself (3 distinct hardware-wallet members + dispersed custody) make this materially harder than a single-key drain, but it is not equivalent to on-chain enforcement. ADR 0008b (future) would document the migration to Path B if this materialises.
- ⚠️ **No on-chain audit trail of withdrawals from the program's perspective.** The program never witnesses a withdrawal because it isn't the signer. The audit trail lives in (a) Squads' on-chain proposal history, (b) the indexer's SPL-transfer index on `config.treasury`. Both are off-program-but-on-chain — verifiable, just not inside roundfi-core's event log.
- ⚠️ **Withdrawal UX lives in Squads' UI, not RoundFi's.** Admins context-switch to app.squads.so to propose/approve/execute. RoundFi's admin dashboard is read-only. Trade-off: less integrated UX, but no custom signing surface to harden in our frontend.
- ❌ **An "institutional LP requires on-chain enforcement of treasury withdrawal limits" requirement would not be satisfiable without migrating to Path B.** Recorded explicitly as a Path-B trigger below.

## Path B triggers (when to revisit)

This ADR records that **Path B** (program-owned PDA treasury with on-chain `withdraw_treasury` ix carrying rate-limit + allowlist) is a deliberately deferred option, not a rejected one. The migration is mechanically straightforward post-fact (one-time SPL transfer from the old Squads-owned ATA into the new program PDA, plus a new ix + state, plus updates to `harvest_yield` and any future fee-flow paths to point at the new vault). Migrate if **any** of the following triggers materialises:

| #   | Trigger                                                                                      | Why it changes the calculus                                                                                     |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | An institutional LP / partner contractually requires on-chain enforcement of withdrawal caps | Squads spending policies are off-program; an LP audit may insist on bytecode-level enforcement                  |
| 2   | Cumulative TVL > $X (concrete threshold to be set by the team at the time, e.g. $5M)         | Above some size, custom on-chain enforcement amortises its audit cost vs. multisig policy alone                 |
| 3   | Squads spending policies prove inadequate in practice (UX gaps, missing controls, etc.)      | The "Squads handles it" argument depends on Squads being fit-for-purpose                                        |
| 4   | An external auditor (Adevar Labs, OtterSec, etc.) recommends migrating in writing            | External recommendation > internal preference, given the auditor sees the broader landscape                     |
| 5   | A peer protocol's incident reveals a multisig-only treasury pattern was the proximate cause  | Update the prior on whether Squads custody is sufficient; would prompt a re-evaluation                          |
| 6   | We add a fee-flow that doesn't fit the "USDC → external ATA via CPI" mould                   | E.g. multi-mint treasury, performance fees crystallised on-chain, etc. — may require program-PDA custody anyway |

When any trigger fires, the migration steps are:

1. Write ADR 0008b ("Migrate treasury to program-owned PDA") referencing the firing trigger.
2. New ix `migrate_treasury_to_pda` — initialises a `treasury_vault` PDA with seeds `[SEED_TREASURY]` owned by `roundfi-core`. Reuses the deferred field `treasury_vault: Option<Pubkey>` left on `ProtocolConfig` (added in PR #400 in a forward-compat padding slot if a follow-up reserves one — see "Forward-compat" below).
3. Squads vault signs one SPL `transfer` of the existing balance from the old ATA → new PDA.
4. New ix `withdraw_treasury(amount, recipient)` carrying:
   - `admin_authority == config.authority` signer (the Squads vault PDA via CPI)
   - Rate-limit (e.g. `WITHDRAWAL_RATE_LIMIT_BPS = 1000` per `WITHDRAWAL_WINDOW_SECS = 86_400` window)
   - Recipient allowlist (managed via separate `add_treasury_recipient` / `remove_treasury_recipient` / one-way `lock_treasury_recipients` ix)
   - Event emission for indexer
5. Update `harvest_yield` (and any new fee-flow ix added between now and then) to transfer to the new vault PDA instead of `config.treasury`.
6. Add `lock_treasury_legacy` (one-way) that rejects further use of the old ATA path.
7. Pin the layout in `scripts/mainnet/mainnet-hardening-check.ts` (SEV-042 coupling — see test in [`config.rs:227-236`](../../programs/roundfi-core/src/state/config.rs)).

Estimated cost at trigger time: ~25-40h (6 PRs + 1 migration PR). Confidence in the estimate is moderate — the migration ix touches the most sensitive surface in the protocol.

### Forward-compat note (optional)

This ADR does **not** require any state-layout changes today. If a future PR wants to make Path B migration cheaper, it could pre-allocate a `treasury_vault: Pubkey` field in `ProtocolConfig`'s 18-byte padding tail (32 bytes — wouldn't fit) or in a separate small `TreasuryShadow` PDA. We are explicitly **not** doing that pre-allocation in PR #400 because:

1. The padding tail isn't big enough (18 < 32) — would require a re-pin of `EXPECTED_DATA_SIZE` in `mainnet-hardening-check.ts` for a field that may never be used.
2. Defaulting an unused `Pubkey` to `Pubkey::default()` in production state is a minor footgun (every reader of the field has to check for the default sentinel).
3. The migration is straightforward enough at trigger time that pre-allocation provides no meaningful cost saving.

## Alternatives considered

### Path B today — migrate treasury to program-owned PDA + add `withdraw_treasury` ix

**Rejected for now.** Material reasons:

1. **Inverts a deliberate design choice.** The current pattern (external ATA + Squads custody) was chosen because Squads is the audited industry standard. Replacing it with custom code mid-freeze adds audit surface and undermines the choice.
2. **No live driver.** No institutional LP has asked for on-chain enforcement; the team has not observed Squads spending policies being inadequate; TVL is at the canary threshold. Building enforcement ahead of a need is YAGNI.
3. **Cost.** ~25-40h of engineering across 6 PRs + 1 migration ix. Currently better spent on the canary smoke (item 4.1 of `MAINNET_READINESS.md`).
4. **Migration risk.** The data move (old ATA → new PDA) is a one-shot ix that must work correctly on the first mainnet attempt — a non-trivial ceremony that has to be rehearsed.
5. **Mid-freeze.** `FREEZE.md` declares `v0.4-canary` and explicitly excludes new on-chain features that aren't fixing a SEV. This isn't a SEV.

The triggers above are how we re-evaluate without re-arguing.

### Hybrid — keep external ATA, add an on-chain "withdrawal log" PDA that authority pings before each Squads withdrawal

**Rejected.** Adds a coordination step ("don't forget to ping the log") that's enforceable only by social contract — the program can't enforce it because the program doesn't sign the actual withdrawal. Effectively voluntary metadata; the indexer's SPL-transfer index gives the same audit trail for free.

### Squads vault PDA AS the treasury (no ATA in between)

**Not applicable.** Squads vault PDAs are SystemProgram-owned (they hold SOL, not SPL tokens). Holding USDC requires an SPL `TokenAccount` whose owner is the vault PDA — which is exactly what Step 4 of the Squads ceremony creates. There's no shortcut here.

### Single keypair (no multisig) as treasury owner

**Rejected** — see [`squads-multisig-procedure.md` § Why multisig](../operations/squads-multisig-procedure.md#why-multisig). A single keypair on mainnet is a single point of total compromise; the 3-of-5 threshold + hardware wallets + dispersed custody is the floor we're holding to.

## References

- Treasury field definition: [`programs/roundfi-core/src/state/config.rs:8`](../../programs/roundfi-core/src/state/config.rs)
- Treasury init: [`programs/roundfi-core/src/instructions/initialize_protocol.rs:46-48,76`](../../programs/roundfi-core/src/instructions/initialize_protocol.rs)
- Treasury fund-flow comment: [`programs/roundfi-core/src/instructions/harvest_yield.rs:120-130`](../../programs/roundfi-core/src/instructions/harvest_yield.rs)
- Treasury rotation ix: [`propose_new_treasury.rs`](../../programs/roundfi-core/src/instructions/propose_new_treasury.rs), [`commit_new_treasury.rs`](../../programs/roundfi-core/src/instructions/commit_new_treasury.rs), [`cancel_new_treasury.rs`](../../programs/roundfi-core/src/instructions/cancel_new_treasury.rs)
- One-way lock: [`lock_treasury.rs`](../../programs/roundfi-core/src/instructions/lock_treasury.rs)
- Squads ceremony (Step 4 establishes Squads as treasury owner): [`docs/operations/squads-multisig-procedure.md`](../operations/squads-multisig-procedure.md#step-4--rotate-the-treasury-if-applicable)
- Companion runbook for actual withdrawals: [`docs/operations/treasury-management.md`](../operations/treasury-management.md)
- Generic key-rotation runbook (covers treasury rotation): [`docs/operations/key-rotation.md`](../operations/key-rotation.md)
- Feature freeze constraint that informed "no new ix": [`FREEZE.md`](../../FREEZE.md)
- SEV-042 byte-layout coupling that pre-allocation would re-pin: test in [`config.rs:227-236`](../../programs/roundfi-core/src/state/config.rs) + `scripts/mainnet/mainnet-hardening-check.ts`
- Related ADRs:
  - [0001](./0001-license-apache-2-0.md) — license context (custody decisions stay open-source)
  - [0007](./0007-bankrun-compat-shim.md) — same "use the industry-standard tool unless we have a concrete reason not to" pattern

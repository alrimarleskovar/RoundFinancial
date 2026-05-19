# ADR 0008 — Treasury custody on Squads 3-of-5 multisig

**Status:** ✅ Accepted
**Date:** 2026-05-19
**Decision-makers:** Founder + Engineering
**Related:** PR #400 (this ADR), [`docs/operations/squads-multisig-procedure.md`](../operations/squads-multisig-procedure.md), [`docs/operations/treasury-management.md`](../operations/treasury-management.md), [MAINNET_READINESS.md §3.6 + §3.7](../../MAINNET_READINESS.md), [`docs/operations/mainnet-canary-plan.md` §3.2](../operations/mainnet-canary-plan.md), [`docs/operations/key-rotation.md`](../operations/key-rotation.md), [`docs/operations/emergency-response.md`](../operations/emergency-response.md)

## Context

`ProtocolConfig.treasury` is the address that receives the protocol-fee bucket of every `harvest_yield` call (currently **20% of realized yield** per the `roundfi-math/waterfall.rs` Lv1 split; per-pool fee bps configurable via `update_protocol_config`). Today on devnet the treasury is a USDC ATA owned by the **single deployer keypair** (`64XM177V…`). For mainnet GA the deployer key is going away — this ADR records the custody structure that replaces it and the events that would force migration to a different structure.

Three operational decisions are bundled here:

1. **Custody mechanism** for the treasury address itself
2. **Disbursement workflow** for moving USDC out of the treasury (paying contractors, audit invoices, infrastructure bills, future founder/team compensation)
3. **Path-B triggers** — events that would force migration AWAY from the chosen mechanism to a different one (e.g. regulated custodian, MPC, fresh multisig after compromise)

Constraints in play:

- **MAINNET_READINESS.md §3.7** already gates GA on "Treasury authority on multisig". Procedure for the on-chain rotation is shipped (`squads-multisig-procedure.md` Step 4 + `key-rotation.md` §(b)). What was **missing** was the architectural commitment to Squads specifically + the disbursement workflow + the migration triggers — auditors will ask "why Squads, not Fireblocks / not a fresh multisig program / not the existing on-chain `lock_treasury`".
- **`config.treasury` rotation is itself 7-day timelocked** (PR #122 — `propose_new_treasury` → 7d wait → permissionless `commit_new_treasury`). The custody choice doesn't bypass this gate; it sits on top of it.
- **`lock_treasury` is one-way at the program level** (`ProtocolConfig.treasury_locked = true` is irreversible without a hard fork — see `key-rotation.md` "Lock the treasury"). Decision on whether/when to lock is downstream of this ADR.
- **Squads v4 mainnet program is already pinned** for upgrade authority + protocol authority (`SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`); using the same multisig for treasury custody collapses three governance surfaces under one signer set instead of fragmenting them.
- **Founder/team compensation** is a real operational question (the protocol needs to be able to pay people) but is **explicitly out of scope** for this ADR — that framework depends on external audit recommendation + BR + US legal counsel opinions (per `mainnet-canary-plan.md` §3.1) and lands as a separate ADR once those inputs exist. This ADR establishes the custody container; the compensation policy that draws against it is downstream.

## Decision

**We will custody `ProtocolConfig.treasury` on the same Squads v4 3-of-5 multisig vault PDA used for the upgrade authority and protocol authority.**

Concretely:

- **Single multisig, single vault PDA (index 0)** holds all three authority surfaces. The treasury USDC ATA is derived as `getAssociatedTokenAddressSync(USDC_MINT, <vault_pda>, true /* allowOwnerOffCurve */)` and set as `ProtocolConfig.treasury` via the 3-step timelock rotation already implemented (`propose_new_treasury` → 7d wait → permissionless `commit_new_treasury`).
- **Threshold = 3-of-5**, members on hardware wallets, signers from at least 3 different geographies (per `mainnet-canary-plan.md` §3.1 / [#266](https://github.com/alrimarleskovar/RoundFinancial/issues/266)).
- **Disbursement workflow** is documented separately in [`docs/operations/treasury-management.md`](../operations/treasury-management.md): every USDC outflow from the treasury ATA is a Squads-proposed SPL-token transfer requiring the 3-of-5 quorum, with the proposal text + recipient pubkey + amount + purpose recorded in `docs/operations/disbursement-log.md` before the proposal is opened. Off-chain accounting (invoices, recipients, tax categorization) lives in the same log.
- **`lock_treasury` stays unfired** until external audit clears and at least one mainnet quarter has elapsed without an authority-rotation operational need (the lock is irreversible; firing it early eliminates the option to ever move the treasury out of Squads, which contradicts the Path-B triggers below).
- **Founder/team compensation is intentionally undefined here.** It draws against the same Squads treasury via the same disbursement workflow when the framework is set, but the policy (cadence, amounts, vesting, jurisdictional categorization) is deferred to a future ADR gated on external audit + legal counsel inputs.

## Path-B triggers — what would force migration off Squads

This is the **explicit list of events** that would force the team to reconsider Squads custody. Each is a hard trigger (not "we should think about it") — if any fires, treasury custody architecture is re-opened for review.

| #   | Trigger                          | Detection                                                                                                                                                                                                            | Likely successor                                                                                                                                                                       |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Regulatory threshold**         | (a) Aggregate treasury balance + pool TVL exceeds a jurisdictional reporting / licensing threshold (BR Bacen guidance, US MSB / Money Transmitter, EU MiCA), OR (b) launch in a regulated jurisdiction is announced. | Hybrid: Squads stays for protocol authority + upgrade authority; treasury moves to a regulated custodian (Anchorage, Fireblocks, BitGo Trust) whose SOC-2 + SOC-1 reports auditors accept. |
| 2   | **External audit recommendation** | Adevar / Halborn / OtterSec / Sec3 finding flags Squads as insufficient for current TVL or threat model. Tracked in `docs/security/internal-audit-findings.md` as a SEV-Critical / SEV-High operational finding.   | Per the audit recommendation. Default fallback: MPC custody (Fireblocks / Cobo) for treasury, Squads retained for governance surfaces.                                                |
| 3   | **Insurance precondition**       | Treasury insurance carrier (Coincover, Nexus Mutual coverage extension, traditional crime policy) requires institutional custody as a policy precondition.                                                          | Per carrier requirement; usually a named custodian on their approved list.                                                                                                              |
| 4   | **Off-ramp partner requirement** | Fiat off-ramp partner (Pix BR / ACH US / SEPA EU) requires the receiving address to be a regulated wallet for KYC / AML reasons.                                                                                    | Add a regulated custodian as a **separate** disbursement target. Squads stays as protocol custody; off-ramp flows route via a dedicated vault.                                          |
| 5   | **Catastrophic signer compromise** | 3+ of the 5 Squads signers are compromised simultaneously (per `emergency-response.md` "Compromised signer" matrix). At this threshold the attacker has quorum and protocol authority is already lost.             | Emergency: fresh Squads multisig with new member set, new geographic distribution. May involve `roundfi-core` redeploy with new program ID if upgrade authority was also captured.    |
| 6   | **Subpoena / litigation freeze** | Court order or regulatory subpoena requires custodial intermediary that can freeze or report on demand. Squads cannot satisfy this — there's no entity to serve.                                                    | Regulated custodian on the approved list of the issuing jurisdiction.                                                                                                                  |

**Triggers 1, 3, 4, 6 are all variants of "external party requires a regulated counterparty"** — they're separated in the table because the detection signal is different, but the migration target is similar (regulated custodian, Squads retained for non-treasury authority). Trigger 2 is the audit-driven path. Trigger 5 is the security-incident path.

A trigger firing does NOT mean immediate migration — it means the architectural decision in this ADR re-opens for review. The output of that review is either: (a) a new ADR superseding this one, (b) a documented "trigger fired but we accept the residual risk" decision recorded against this ADR, or (c) reorganization of the treasury into multiple vaults with different custody (e.g. operational vs reserve).

## Consequences

- ✅ **Single signer set governs all three authority surfaces** (upgrade authority, protocol authority, treasury). No signer-roster drift across surfaces, no "which Squads do I need to pause vs withdraw" cognitive load on the on-call. The Squads ceremony covers all three in one pass per `squads-multisig-procedure.md`.
- ✅ **Disbursement workflow is auditable end-to-end.** Every USDC outflow has a Squads proposal record (on-chain, queryable forever) + a disbursement-log entry (off-chain, version-controlled in this repo). Auditors can reconcile the two halves at any time.
- ✅ **The 7-day on-chain timelock on `propose_new_treasury` + 3-of-5 multisig on every `propose_new_treasury` call** stack — moving the treasury requires both a quorum decision AND a public 7-day window. This is strictly stronger than either gate alone.
- ✅ **Founder/team compensation problem stays solvable without on-chain code changes.** When the compensation ADR lands, it draws against this treasury via the same disbursement workflow — no new instruction, no new PDA, no `roundfi-core` upgrade.
- ✅ **Path-B triggers are explicit, not vibes-based.** When a trigger fires, the response procedure is documented; we won't have to invent governance under pressure.
- ⚠️ **Disbursement latency.** Every USDC outflow needs 3 signers awake. For routine vendor payments this is "as fast as quorum reaches" (per `emergency-response.md` post-Squads pause flow: 5–30 minutes). For mainnet incident response involving treasury moves, this latency stacks with the pause latency. Mitigation: on-call rotation guarantees 3-signer reachability inside 30 minutes (`emergency-response.md` "Who can pause").
- ⚠️ **No native scheduled / recurring payments.** Squads v4 doesn't natively support "release X USDC on the 1st of every month". Recurring obligations (e.g. infrastructure bills, future payroll) require a manual Squads proposal per cycle. Acceptable at current scale (4-person team); revisit when team > 10 via either a streaming-payments primitive (Streamflow / Bonfida) layered on top OR Path-B trigger 1 (regulated custodian) if it brings its own scheduling.
- ⚠️ **Squads program is itself a dependency.** Squads v4 is well-audited and battle-tested, but a Squads-side vulnerability or operational issue would propagate. Mitigation: Squads v4 program ID is pinned (`SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`) and re-verified against [Squads' published deploys](https://github.com/Squads-Protocol/v4/blob/main/deploys.md) at every ceremony per `squads-multisig-procedure.md`.
- ❌ **No upgrade path to "treasury controlled by token-weighted DAO vote".** This ADR explicitly does NOT build toward governance-token-driven treasury control. If RoundFi later launches a governance token, that's a separate architecture review (and likely a Path-B trigger of its own). Squads is multisig, not DAO.
- ❌ **`lock_treasury` is operationally off-limits** until the external audit clears + at least one stable mainnet quarter has elapsed. Firing `lock_treasury` before then would amputate the Path-B migration option, which contradicts triggers 1–6.

## Alternatives considered

### Fireblocks / Anchorage / BitGo institutional custody from day-1

**Rejected for day-1.** Pros: SOC-2 / SOC-1 audited, named entity to serve subpoenas, insurance available. Cons: (a) onboarding requires legal entity in a supported jurisdiction (RoundFi's BR + US legal counsel opinion isn't filed yet — `mainnet-canary-plan.md` §3.1), (b) per-tx fees + subscription costs that don't pencil at pre-audit scale, (c) opaque key custody model (we're trusting their HSM operationally; Squads is auditable on-chain). Becomes the right answer when Path-B trigger 1, 2, 3, or 6 fires; deferring it until then keeps day-1 stack simple.

### MPC wallet (Coinbase Cloud, Cobo, Web3Auth)

**Rejected for day-1.** Pros: threshold cryptography without on-chain multisig overhead, lower per-tx cost than Fireblocks. Cons: same legal-entity / onboarding constraints as institutional custody, plus less battle-tested on Solana specifically than Squads (Squads has 18+ months of mainnet production use across thousands of treasuries). The cryptographic guarantee is comparable; the operational maturity isn't. Re-evaluate if Path-B trigger 2 fires with an explicit MPC recommendation.

### Separate multisig per surface (upgrade authority Squads-A, protocol authority Squads-B, treasury Squads-C)

**Rejected.** Pros: blast-radius isolation — a Squads-A compromise doesn't directly imply Squads-C compromise. Cons: 3× signer coordination overhead, 3× rotation ceremonies, 3× incident-response paths to maintain. The blast-radius argument is also weaker than it sounds: if upgrade authority is compromised, the attacker can upgrade `roundfi-core` to drain the treasury regardless of who owns the treasury address. Surfaces are economically coupled even when cryptographically separated. Single multisig with strong member-key custody + geographic dispersal (per [#266](https://github.com/alrimarleskovar/RoundFinancial/issues/266)) is the better trade.

### Hot/cold split — small operational multisig + large cold treasury

**Rejected for day-1, may revisit.** Pros: operational expenses drain a small hot pot that's lower-threshold (e.g. 2-of-3) to reduce signing friction; principal sits in a cold high-threshold (e.g. 4-of-5) vault. Cons: at current treasury balance (zero — protocol not yet at mainnet, no harvested fees), there's nothing to split. Revisit once treasury balance > $100k AND mainnet operating for at least a quarter, at which point we'll know operational disbursement rate empirically. Tracking as a follow-up: "Hot/cold split decision" in `treasury-management.md` § Future considerations.

### Single deployer keypair + HSM (the pre-Squads status quo, hardened)

**Rejected** as the long-term answer (it's already the short-term answer until the ceremony lands). HSM solves the key-storage attack surface but not the single-point-of-trust failure mode — a malicious or coerced HSM holder can still sign anything. The auditor expectation since Adevar / Halborn / OtterSec engagement scoping started has been "multisig before mainnet"; HSM-only treasury would be a known finding before the audit even starts.

### Fund a separate on-chain DAO program (Realms, Squads governance mode)

**Rejected for day-1.** A token-weighted DAO requires (a) a governance token (RoundFi doesn't have one and explicitly doesn't plan one for v1), (b) tokenholder onboarding ahead of mainnet, (c) governance proposal infrastructure. None of these exist; building them solely for treasury control inverts the cost. If governance-token-driven treasury control ever becomes the right answer, it's a Path-B successor decision, not a day-1 choice.

## References

- Squads ceremony procedure: [`docs/operations/squads-multisig-procedure.md`](../operations/squads-multisig-procedure.md) (Step 4 = treasury rotation)
- Treasury disbursement workflow: [`docs/operations/treasury-management.md`](../operations/treasury-management.md) (new in PR #400)
- Treasury rotation primitives: `programs/roundfi-core/src/instructions/{propose,cancel,commit}_new_treasury.rs`, `lock_treasury.rs` ([PR #122](https://github.com/alrimarleskovar/RoundFinancial/pull/122))
- Key rotation runbook: [`docs/operations/key-rotation.md`](../operations/key-rotation.md) §(b) Treasury address rotation
- Mainnet canary preconditions: [`docs/operations/mainnet-canary-plan.md`](../operations/mainnet-canary-plan.md) §3.1 + §3.2
- Mainnet readiness items closed by this decision (architectural commitment; ceremony execution still pending): [MAINNET_READINESS.md §3.6 + §3.7](../../MAINNET_READINESS.md)
- Squads v4 program: [github.com/Squads-Protocol/v4](https://github.com/Squads-Protocol/v4), mainnet ID `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`
- Signer compromise matrix: [`docs/operations/emergency-response.md`](../operations/emergency-response.md) "Compromised signer" section
- Related ADRs: none directly. This is the first ADR on treasury custody.

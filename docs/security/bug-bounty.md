# RoundFi Bug Bounty Policy

> **Status: pre-mainnet draft.** This document specifies the bounty program that activates at **mainnet launch** (planned Q4 2026 — see [`AUDIT_SCOPE.md`](../../AUDIT_SCOPE.md#mainnet-timeline)). Until activation, valid reports go through [`SECURITY.md`](../../SECURITY.md) and qualify for the interim Hall-of-Fame + swag recognition described there.

The draft is versioned here so the policy is locked-in well before mainnet rather than scrambled together at launch. Migration plan: at mainnet GA, this file gets promoted to a public Immunefi (or HackenProof) program with the same scope and reward bands.

---

## 1. Active phase

| Phase                                        | Channel                                                        | Rewards                                                             |
| -------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Devnet (current — through mainnet smoke)** | [`SECURITY.md`](../../SECURITY.md) responsible disclosure      | Hall-of-Fame credit in `docs/security/self-audit.md` + RoundFi swag |
| **Mainnet smoke (Q3-Q4 2026)**               | Same channel; rewards still discretionary                      | Up to USD 1,000 per Critical at team discretion                     |
| **Mainnet GA (Q4 2026+)**                    | Immunefi (or HackenProof) public program with the policy below | Per the reward table in §4                                          |

The Immunefi program will syndicate to ~50k registered researchers; we expect first reports within 72h of go-live.

---

## 2. In scope

Mirrors [`AUDIT_SCOPE.md`](../../AUDIT_SCOPE.md#in-scope--3-anchor-programs--8341-lines-of-rust):

| Program                             | Scope on mainnet                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `roundfi-core`                      | Full instruction surface — pool lifecycle, custody, escape valve, harvest waterfall, treasury controls |
| `roundfi-reputation`                | Attestation issuance, level promotion, identity scaffold                                               |
| `roundfi-yield-kamino`              | `deposit_idle_to_yield` path (and `harvest` once it lands post-deposit-audit)                          |
| **All deployed devnet program IDs** | Already in scope under devnet rewards; rolls over to mainnet IDs at deployment                         |

Off-chain components (`services/indexer/`, `app/`, `packages/sdk/`) are in scope **only** for vulnerabilities that compromise the on-chain trust path — e.g. a frontend XSS that lets an attacker silently swap the connected wallet's sign payload qualifies; a UX bug that confuses users does not.

---

## 3. Out of scope

Items that do **not** earn a bounty, in addition to the [`AUDIT_SCOPE.md` out-of-scope register](../../AUDIT_SCOPE.md#out-of-scope):

- Vulnerabilities in **upstream dependencies** (Solana runtime, BPF execution, SPL Token, mpl-core, Anchor, Kamino, SAS) — report those to the upstream maintainers; we'll credit pass-through but won't pay
- **DoS / spam / griefing** that wastes gas without compromising funds or invariants
- **Theoretical attacks** without a working proof-of-concept on devnet (or, post-launch, mainnet)
- **Social engineering** of team members, contributors, or users
- **Self-XSS**, clickjacking without a security impact, missing security headers (rate-limit those via standard responsible-disclosure channels)
- **Already-known issues** documented in [`docs/security/self-audit.md`](./self-audit.md) §6 (mpl-core TransferV1 plugin reset — fixed) or §7 (explicit out-of-scope)
- **Issues requiring mainnet redeployment** of the protocol that don't actually exploit on the deployed bytecode
- **Public/leaked private keys** found via shoulder-surfing the team's environments (please report responsibly, but it's not a bounty)

---

## 4. Severity classification + reward table

Severity follows [Immunefi's vulnerability severity classification system v2.3](https://immunefi.com/severity-system/) adapted for Solana.

| Severity          | Definition                                                                                                                                                                                                                                                 | Reward (USDC)                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **Critical**      | Direct theft of user or protocol funds at any volume · Permanent freezing of vault PDAs · Authority key-equivalent compromise · Triple Shield bypass leading to insolvency · Unauthorized minting of reputation attestations that bypass on-chain behavior | **USD 25,000 – 50,000**        |
| **High**          | Theft / freezing of yield realized over a single cycle · MEV-extractable value > $1k per pool · `settle_default` cranker race that disadvantages a specific member · Permanent griefing of a single pool's `claim_payout` flow                             | **USD 5,000 – 25,000**         |
| **Medium**        | Reputation-score manipulation that doesn't directly affect collateral tiering · Temporary DoS of a non-fund-movement instruction · Information leak through PDA derivation that reveals private member data                                                | **USD 1,000 – 5,000**          |
| **Low**           | Best-practice violations, missing input validation that doesn't compound, gas griefing under specific edge conditions                                                                                                                                      | **USD 250 – 1,000**            |
| **Informational** | Documentation gaps, dev-quality issues, low-confidence theoretical concerns                                                                                                                                                                                | **Hall-of-Fame credit + swag** |

**Initial bounty pool: USD 50,000.** Top-ups expected post-mainnet as TVL grows. Capped per-finding at the table maximums above; the team retains discretion to award above-table for novel attack classes that materially improve the security state of the broader Solana ecosystem.

Reward **scales with TVL at time of report** — a Critical reported when TVL is $100k yields the lower end of the band; the same severity at $10M TVL yields the upper end. The team publishes TVL transparently so researchers can self-estimate.

Payment in **USDC on Solana mainnet** within 30 days of fix verification.

### 4.1 MEV-specific severity sub-tiering

MEV / front-running findings get an explicit sub-tier inside the main severity table because the per-instruction analysis in [`mev-front-running.md`](./mev-front-running.md) bounds most MEV vectors to "griefing" rather than "extraction." A flat severity scale would over-reward bounded griefing or under-reward novel extraction vectors.

| MEV class                                                                                                                            | Maps to severity  | Reward band       | Example                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Extraction breaking Triple Shield invariants** — searcher orders txs to violate D/C, Seed Draw, or solvency guard                  | **Critical**      | USD 25,000–50,000 | A Jito-bundle that lands `claim_payout` + `escape_valve_buy` and ends the slot with `c_after < d_remaining`             |
| **Targeted MEV at a specific user funds** — extraction > 1% of victim's principal or > $1k absolute (whichever is greater)           | **High**          | USD 5,000–25,000  | `escape_valve_buy` race that consistently lands a sniper ahead of a known buyer across multiple listings ($1k/race × N) |
| **Pool-level MEV degrading APR** — searcher consistently captures > 25% of `harvest_yield` realized value via Kamino-side ordering   | **High**          | USD 5,000–25,000  | Kamino sandwich on `harvest_yield` that materially affects participant APR over a measurement window                    |
| **Cranker race that materially advantages one party** — `settle_default` ordered to disadvantage a specific member's escrow recovery | **High**          | USD 5,000–25,000  | Cranker withholding `settle_default` until they've staged a counter-`release_escrow` against the defaulter              |
| **Reputation-grade MEV** — manipulation of on-time/late bits beyond what the `Clock` sysvar allows in good faith                     | **Medium**        | USD 1,000–5,000   | Pattern of Jito-tipped contributions consistently crossing cycle boundary in the user's favor                           |
| **Information leak through ordering** — observing tx ordering reveals private member data (slot assignment, etc.)                    | **Medium**        | USD 1,000–5,000   | Pre-`join_pool` slot prediction that survives random-slot-assignment mitigation                                         |
| **Bounded griefing only — attacker pays > 0 to be annoying** (no extraction)                                                         | **Low**           | USD 250–1,000     | `claim_payout` race that forces a victim into the `WaterfallUnderflow` failure path; attacker pays late-fee equivalent  |
| **Theoretical MEV with no demonstrated path** — uses speculative assumptions about future Solana behavior                            | **Informational** | HoF + swag        | "A bundle with X tx ordering could theoretically extract value if Jito changes behavior" without a working repro        |

**Why this matters:** the existing protocol design (per [`mev-front-running.md §3`](./mev-front-running.md#3-summary--mev-surface-vs-mitigation)) bounds most ordering attacks to **griefing**, not extraction. Researchers reporting bounded griefing should not expect Critical-band payouts; conversely, a researcher who finds a real **extraction** path that survives Triple Shield invariants should expect Critical-band payouts even if the absolute extracted value is small (any extraction breaking the Triple Shield is structurally severe).

Reports involving Jito-bundle or multi-tx ordering attacks must include a **working reproduction** on devnet using `solana-bankrun` or a fork — speculative tx-ordering theories don't qualify above Informational.

---

## 5. Submission process

1. **Email the report** to `roundfinance.sol@gmail.com` (interim) or via the Immunefi program (once active). Use the [SECURITY.md](../../SECURITY.md#what-to-include) "What to include" checklist.
2. **Acknowledgement** within 72 hours.
3. **Triage** within 7 days — severity classification + reproduction status confirmed.
4. **Fix-development window** scaled to severity (see [`SECURITY.md`](../../SECURITY.md) SLAs).
5. **Patch validation** — researcher invited to re-test the fix on devnet (or a mainnet fork) before mainnet deployment.
6. **Payment** within 30 days of validated fix.
7. **Coordinated disclosure** — 90 days from fix landing on `main`, or sooner if mutually agreed.

---

## 6. Eligibility

To be eligible for a bounty:

- Be the **first reporter** of a unique finding (duplicates → first-write-wins by acknowledgement timestamp)
- Do **not** exploit the vulnerability beyond what is necessary to demonstrate it
- Do **not** publicly disclose before coordinated disclosure window closes
- Do **not** access or modify user data without their explicit consent
- Comply with applicable law — including but not limited to no engagement from OFAC-sanctioned jurisdictions
- Identify yourself or a pseudonym for the Hall-of-Fame credit (anonymous reports are accepted; rewards still paid to a wallet address)

---

## 7. Safe harbor

The RoundFi team commits to:

- **Not pursuing legal action** against researchers who follow this policy in good faith — even when the protocol's standard ToS would otherwise apply
- **Not reporting researchers to law enforcement** for activities consistent with this policy
- **Working in good faith** with researchers on fix validation and credit
- **Public disclosure** of valid findings (with researcher consent) post-fix as a learning artifact for the ecosystem

If a researcher engages in good faith but inadvertently violates the program's terms (e.g. exceeds the minimum exploitation needed), the team will work with the researcher to resolve the issue without penalty.

---

## 8. Historical record

A running ledger of confirmed valid bounty claims will be maintained at `docs/security/bounty-history.md` (created on first valid claim). Each entry: anonymized reporter handle (if consented), severity, reward, fix-PR link, disclosure-window status.

This drafts the bounty _program_, not the history. The history file is created when there's something to record.

---

_Last updated: May 2026 · pre-mainnet draft · activates at mainnet GA._

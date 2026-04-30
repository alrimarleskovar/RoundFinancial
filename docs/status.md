# RoundFi — Project Status

**Updated:** 2026-04-30 · **Tracking branch:** `main` · **Live:** [roundfinancial.vercel.app](https://roundfinancial.vercel.app)

> **TL;DR for evaluators / partners.** RoundFi is a multi-track project: a polished **off-chain product** (front-end + L1 actuarial simulator) is live and demoable today. The **on-chain Anchor programs** are coded against the canonical PDFs but landed in a wave of recent corrections (yield waterfall, NFT transfer) whose `anchor test` verification is **in flight, not yet green**. The B2B oracle and production indexer are explicitly **roadmap (Phase 3 / post-grant)**. This doc is the authoritative status register — anything claimed elsewhere should reduce to one of the three columns below.

---

## 1. Shipped (live, demoable today)

These are running in production on either `roundfinancial.vercel.app` (front-end) or as deterministic TypeScript simulators that the on-chain programs are parity-tested against.

| Component | Where | Notes |
|---|---|---|
| **Stress Lab L1** — pure-TS actuarial simulator | `/lab` route + `sdk/src/stressLab.ts` | Source of truth for the protocol's economic claims; preset scenarios for video demos (Maria, Triplo Calote, Saída via Válvula, Veterano L3) |
| **Front-end dashboard** | `/home`, `/grupos`, `/carteira`, `/mercado`, `/reputacao`, `/insights` (Vercel) | Cross-tab session integration: paying installments, joining groups, buying/listing NFT shares, harvesting yield all reflect everywhere live |
| **Reputation base (SAS-style)** | `/reputacao` + `session.reducer` PAY_INSTALLMENT awarding +6 pts per on-time installment | UI + state mechanics work end-to-end; on-chain SAS attestation issuance is part of the on-chain track below |
| **Demo Studio** | `/admin` — parallel dashboard for video recording | 6 preset scenarios, scrubable timeline, "Aplicar à sessão real" button, PT/EN toggle |
| **Documentation + pitch alignment** | [`docs/architecture.md`](./architecture.md), [`docs/pitch-alignment.md`](./pitch-alignment.md), [`docs/yield-and-guarantee-fund.md`](./yield-and-guarantee-fund.md) | Aligned to canonical PDFs (whitepaper + viabilidade-tecnica) v1.1 |
| **Escape Valve listing flow (UI)** | `/mercado` Sell tab → list cota → details modal | Listings live in client state with 7-day countdown; on-chain wiring is in the next column |
| **Yield Waterfall L1 simulator** | `sdk/src/stressLab.ts` `runSimulation()` | PDF-canonical order: protocol fee → GF → LP → participants. This is the spec the Rust side parity-tests against |

---

## 2. Shipped (code merged, awaiting `anchor test` verification)

Code lives on `main`; the integration tests reference the new IDL fields. Verification step is the **manual `anchor build` + `anchor test` cycle on a devnet workstation** — sandbox we develop in doesn't have a recent enough Cargo for the transitive `hashbrown 0.17` (edition2024). **None of these are claimed as live until the anchor test pass is recorded.**

| Item | Landing PR | What's left |
|---|---|---|
| **Rust yield waterfall PDF-canonical reorder** — `protocol_fee → GF → LP → participants` (was `GF → fee → good_faith → participants`); rename `good_faith` → `lp_share` everywhere; new `pool.lp_distribution_balance` earmark | [#111](https://github.com/alrimarleskovar/RoundFinancial/pull/111) | Run `anchor build` to regen IDL → run `anchor test` → confirm `economic_parity.spec.ts` (L1↔L2) is green |
| **TS test rename** — `tests/_harness/actions.ts` + `yield_integration.spec.ts` + `security_economic.spec.ts` + `lifecycle.spec.ts` + `security_cpi.spec.ts` aligned with new on-chain field names + new bucket math | [#112](https://github.com/alrimarleskovar/RoundFinancial/pull/112) | Same anchor build cycle |
| **Escape Valve real NFT transfer** — `join_pool.rs` adds `TransferDelegate` plugin alongside existing `FreezeDelegate`; `escape_valve_buy.rs` thaws → transfers (seller → buyer) → re-freezes via 3 CPIs signed by the slot's `position_authority` PDA | [#114](https://github.com/alrimarleskovar/RoundFinancial/pull/114) | Anchor build to validate mpl-core 0.8 builder signatures; integration test (next column) |

---

## 3. Pending / Roadmap

Honest status: not started, in design, or explicitly post-grant.

| Item | Why it matters | Target / dependency |
|---|---|---|
| **L1↔L2 economic parity test green** (bankrun) | The single test that proves the on-chain program matches the L1 simulator the docs commit to. Currently flagged as known-divergence in `yield-and-guarantee-fund.md` — divergence closed in code on `main` (#111), needs the test to actually run | Audit 1 step 3 (anchor build + test) — assigned to project owner |
| **Escape Valve integration test** | Exercises full flow: A joins → A lists → B buys → assert NFT owner=B, member at A's seeds closed, no default attestation, USDC moved A→B | Follow-up to #114 once `anchor build` regen yields fresh IDL types |
| **Devnet redeployment with v1.1 contract** | Existing devnet positions don't have the new `TransferDelegate` plugin and run the old GF-first waterfall | Follow-up to anchor test pass |
| **On-chain SAS attestation issuance** | Today reputation accrues in the session reducer (off-chain demo). Real attestations require the SAS / Civic CPI wiring inside `pay_installment` | M2 follow-up |
| **B2B oracle API (Phase 3)** | The high-margin endgame from the [B2B plan PDF](./pt/plano-b2b.pdf): neobanks subscribe to query reputation scores. Not started; design only | Post-grant (Phase 3) |
| **Production indexer** | A real Web2/Web3 query layer feeding the front-end + B2B API. Today the front-end mocks data via static fixtures + the session reducer | Phase 2 of the grant roadmap |
| **Hardware wallet integration** | Ledger / Trezor support inside the connect flow | Post-M3 |
| **Mainnet beta** | Hard dependency on every item above | Phase 3 milestone |

---

## How to read this if you're an investor / partner / reviewer

- **What works today, ungated:** the entire UX in column 1. Open the live demo, walk through `/grupos → /carteira → /mercado → /reputacao` — every action is reactive and the L1 simulator is exposed in `/lab` for stress-testing the economics.
- **What's "merged but unverified":** column 2. The Rust source on `main` reflects the canonical PDFs; a single `anchor test` run will confirm the on-chain parity. We do not claim devnet liveness for this layer yet.
- **What's roadmap:** column 3. We are explicit about Phase 3 (B2B oracle, indexer, mainnet). These are not implied features.

If anything in any other doc / pitch / pull request implies that an item from column 3 is shipped, that's a doc bug — please file or correct against this status register.

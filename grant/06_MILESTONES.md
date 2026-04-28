# 06 · Goals and Milestones

> 6-week scope for the $200 AI-subscription subsidy. Honest, concrete, verifiable from the public repo when shipped.

## High-level goal

Bridge the in-memory mock orchestrator (`app/src/lib/session.tsx`, shipped in PR #28) and the **Stress Lab** actuarial simulator (`app/src/lib/stressLab.ts`, PR #40) to **live on-chain Anchor programs** running on Solana devnet, so the dashboard at `/home` reads real protocol state — not fixtures.

The protocol is being built in three layers:

- **L1 — Stress Lab (TypeScript reference impl)** — pure-TS actuarial engine + interactive `/lab` route with 4 canonical scenario presets (Healthy / Pre-default / Post-default / Cascade). Validates the **Triple Shield** economics (50/30/10 stake + 65/30/5 split + Kamino yield + admin fee) against arbitrary default scenarios. **Shipped in PR #40 + PR #42 before this grant kicks off** — it is the spec the on-chain programs must match.
- **L2 — Anchor programs (drafts → validated)** — `roundfi-core` (~4,300 LoC, 14 instructions implemented), `roundfi-reputation`, `roundfi-yield-mock`, `roundfi-yield-kamino`. Drafts exist; what's missing is the validation that turns drafts into shippable software: **economic parity against L1**, **green bankrun runs** of the 13 drafted specs, and a **reproducible devnet deploy**. **This grant.**
- **L3 — Frontend bridge** — `SessionProvider` reducer dispatches replaced with Anchor CPIs via `@roundfi/sdk`; `/home` Activity feed renders real on-chain events. **This grant.**

The frontend is feature-complete (42 PRs merged on main). The Anchor programs are drafted but not yet validated end-to-end. The 6 weeks close the loop.

## Honest framing — what already exists vs what this grant adds

A reviewer reading `programs/roundfi-core/src/` will see ~4,300 LoC of Rust across 14 instructions and full math modules. This is **drafted infrastructure**, not validated software. The validation that's missing — and that this grant pays for — is what separates a Rust draft from a credibly-shippable on-chain program:

- No economic-parity test exists today. `tests/parity.spec.ts` (which runs green) only checks **constants and PDA seeds** between Rust and the TS SDK. The economic parity test — running the same scenario through `runSimulation()` (L1) and `roundfi-core` (L2) and asserting identical `FrameMetrics` — is the load-bearing claim of the protocol's correctness, and it does not exist yet.
- The 13 drafted bankrun specs (`tests/lifecycle.spec.ts`, `edge_cycle_boundary`, `edge_grace_default`, `edge_tiny_lifecycle`, `edge_degenerate_shapes`, `reputation_cpi`, `reputation_lifecycle`, `reputation_guards`, `security_cpi`, `security_economic`, `security_inputs`, `security_lifecycle`, `yield_integration`) are not yet running green.
- No devnet deploy has happened. `scripts/devnet/deploy.ts` exists but has not been driven against a live deployment.
- The frontend still reads from fixtures — `lib/session.tsx` dispatches against an in-memory reducer.

## Milestones

### M1 — Weeks 1–2: L1↔L2 economic parity + bankrun lifecycle green

**Deliverable:** `roundfi-core` validated as a faithful implementation of the L1 spec via reproducible tests, with `tests/lifecycle.spec.ts` and the 4 edge specs running green under `solana-bankrun`.

Work to ship:

- `tests/economic_parity.spec.ts` (new) — for each `/lab` `PRESETS` entry (Healthy / Pre-default / Post-default / Cascade), drive the same scenario through `runSimulation()` and through `roundfi-core` under bankrun, assert `poolBalance`, `paidOut`, `totalRetained`, `totalLoss` match within a defined epsilon (or exactly, for integer-bps math). Any divergence surfaces as a parity bug to fix on either side.
- Drive `tests/lifecycle.spec.ts` (already drafted) to green under bankrun — this exercises `initialize_protocol` → `create_pool` → `join_pool` → `contribute` → `claim_payout` → `release_escrow` → `close_pool`.
- Drive the 4 `edge_*.spec.ts` files to green — boundary cycles, grace-period defaults, tiny lifecycles, degenerate shapes.
- Whatever bug-fix PRs against `roundfi-core` the parity + lifecycle specs surface.

Acceptance criteria:

- `pnpm run test:parity` stays green (constants/seeds parity).
- `pnpm run test:bankrun` green for `economic_parity.spec.ts`, `lifecycle.spec.ts`, and the 4 `edge_*.spec.ts` files.
- 3–4 merged PRs in main, each with structured body + linked Claude session.

### M2 — Weeks 3–4: `roundfi-reputation` parity + cross-program CPI green

**Deliverable:** `roundfi-reputation` validated end-to-end, including the CPI from `roundfi-core::contribute` (or whichever instruction the spec lands on) into `roundfi-reputation::mint_attestation`, and reputation-driven level transitions verified against L1's `LEVEL_PARAMS`.

Work to ship:

- Drive `tests/reputation_cpi.spec.ts` (drafted) to green — `roundfi-core` paying into `roundfi-reputation` via type-safe CPI, attestation account materialised on-chain.
- Drive `tests/reputation_lifecycle.spec.ts` (drafted) to green — 4 cycles of payment, score climbs from 300 → above 500, level transition observed (Iniciante → Veterano), next contribution requires the lower stake codified in L1's `LEVEL_PARAMS`.
- Drive `tests/reputation_guards.spec.ts` (drafted) to green — invalid-attestation + duplicate-attestation rejection paths.
- Whatever bug-fix PRs across both programs the specs surface.

Acceptance criteria:

- `pnpm run test:bankrun` green for the 3 reputation specs.
- The level-transition behaviour matches L1's `LEVEL_PARAMS` exactly.
- 2–3 merged PRs.

### M3 — Weeks 5–6: Devnet deploy + L3 frontend bridge + live demo

**Deliverable:** the dashboard at `/home` displays a real pool on devnet end-to-end. Connecting Phantom → joining a pool → paying an installment → seeing the score climb on `/reputacao` works as a verifiable user flow. The `/lab` route stays as the human-facing reference for the math the chain runs.

Work to ship:

- `scripts/devnet/deploy.ts` actually deploying both programs to a fresh devnet, with `Anchor.toml` + `@roundfi/sdk` IDs synced.
- `pnpm run demo:devnet` script that (a) airdrops the deploy wallet, (b) deploys, (c) calls `initialize_protocol`, (d) calls `create_pool` for a sample pool — so any reviewer can run the full loop locally.
- Replace `SessionProvider`'s reducer dispatches in `app/src/lib/session.tsx` with Anchor CPI calls via the existing `@roundfi/sdk` skeleton.
- Thin indexer in `services/orchestrator/` polling account changes → feeds `useSession()` reads.
- `data/carteira.ts` USER / NFT_POSITIONS / TX_LIST become read-through to chain state (kept as fixture fallbacks only when wallet is disconnected).

Acceptance criteria:

- A clean `pnpm install && pnpm run demo:devnet && pnpm --filter @roundfi/app dev` flow lets anyone watch the loop work.
- Dashboard `/home` Activity feed renders **real on-chain events**, not seeded ones.
- 3–4 merged PRs + a final `docs/post-mortem.md` documenting what 8–10 PRs of agentic engineering looks like in concrete numbers (time per PR, kinds of decisions automated, kinds the human kept).

## Total estimated PR count

8–10 merged PRs over 6 weeks. Aligned with the 42 PRs / project lifetime cadence already documented in `03_PR_LOG.md`.

## What's explicitly out of scope for this grant

- Mainnet deploy (audit-required; not for $200).
- Custom MCP server for RoundFi-specific operations (separate / future grant).
- B2B Score API productization (separate / future).
- Marketing / partnership work.

This milestone list is what 6 weeks of subsidized agentic engineering credibly buys, no more.

---

End of bundle. Index: [`00_README.md`](./00_README.md).

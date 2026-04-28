# 06 · Goals and Milestones

> 6-week scope for the $200 AI-subscription subsidy. Honest, concrete, verifiable from the public repo when shipped.

## High-level goal

Bridge the in-memory mock orchestrator (`app/src/lib/session.tsx`, shipped in PR #28) and the new **Stress Lab** actuarial simulator (`app/src/lib/stressLab.ts`, PR #40) to **live on-chain Anchor programs** running in Solana devnet, so the dashboard at `/home` reads real protocol state — not fixtures.

The protocol is being built in three layers:

- **L1 — Stress Lab (TypeScript reference impl)** — pure-TS actuarial engine + interactive `/lab` route. Validates the **Triple Shield** economics (50/30/10 stake + 65/30/5 split + Kamino yield + admin fee) against arbitrary default scenarios. **Shipped in PR #40 before this grant kicks off** — it's the spec the on-chain programs must match.
- **L2 — Anchor programs** — `roundfi-core` + `roundfi-reputation` deployed to devnet, parity-tested against L1 outputs. **This grant.**
- **L3 — Frontend bridge** — `SessionProvider` reducer dispatches replaced with Anchor CPIs via `@roundfi/sdk`; `/home` Activity feed renders real on-chain events. **This grant.**

The frontend is feature-complete (40 PRs merged on main). The Anchor programs are scaffolded with `ping`-only instructions and a test harness ready (`anchor test` + `solana-bankrun`, 14 specs already drafted). The 6 weeks close the loop.

## Milestones

### M1 — Weeks 1–2: `roundfi-core` business logic (L2 begins)

**Deliverable:** the core ROSCA state machine running on devnet with passing lifecycle tests, parity-checked against L1 (`runSimulation()`).

Instructions to implement:

- `initialize_pool(params)` — creates a Pool account, sets shape (members, installment, term).
- `join_pool(member)` — registers a member, locks the level-appropriate stake (50 / 30 / 10%, mirroring `LEVEL_PARAMS` from L1).
- `pay_installment()` — debits caller's USDC, credits escrow + solidarity vault per the Triple Shield split (65 / 30 / 5).
- `draw(month)` — runs the seed-draw + deterministic winner selection per cycle.
- `conclude()` — settles final positions, releases escrow remainders.

Acceptance criteria:

- All 5 instructions compile and pass `anchor test` on a fresh `solana-test-validator`.
- `tests/lifecycle.spec.ts` runs end-to-end (already drafted in repo).
- **Parity test:** running the same scenario through `runSimulation()` (L1) and through the Anchor program (L2) yields identical pool balance, paid-out, retained, and loss totals. This is the load-bearing claim of the architecture.
- 3–4 merged PRs in main, each with structured body + linked Claude session.

### M2 — Weeks 3–4: `roundfi-reputation` + SAS attestations

**Deliverable:** every paid installment mints an on-chain attestation that bumps the SAS score; the reputation program is CPI-callable from `roundfi-core`.

Instructions to implement:

- `mint_attestation(member, kind, weight)` — emits a SAS-compatible attestation account.
- `query_score(member)` — read-only helper for the indexer.
- Level transitions: when score crosses 500 → Lv.2, 750 → Lv.3 (Veterano), the next `pay_installment` call requires lower collateral — exactly the level transitions encoded in L1's `LEVEL_PARAMS`.

Acceptance criteria:

- `roundfi-core::pay_installment` does CPI into `roundfi-reputation::mint_attestation`.
- `tests/reputation_cpi.spec.ts` (already drafted) passes end-to-end.
- `tests/reputation_lifecycle.spec.ts` passes — 4 cycles of payment, score climbs from 300 → above 500.
- 2–3 merged PRs.

### M3 — Weeks 5–6: Frontend bridge + indexer + live demo (L3)

**Deliverable:** the dashboard at `/home` displays a real pool on devnet end-to-end. Connecting Phantom → joining a pool → paying an installment → seeing the score climb on `/reputacao` works as a verifiable user flow. The `/lab` route stays as the human-facing reference for the math the chain runs.

Work breakdown:

- Replace `SessionProvider`'s reducer dispatches in `app/src/lib/session.tsx` with Anchor CPI calls via the existing `@roundfi/sdk` skeleton.
- Thin indexer in `services/orchestrator/` polling account changes → feeds `useSession()` reads.
- `data/carteira.ts` USER / NFT_POSITIONS / TX_LIST become read-through to chain state (kept as fixture fallbacks only when wallet is disconnected).
- A `pnpm run demo:devnet` script that initializes a sample pool with the deployed programs so anyone can run the demo locally.

Acceptance criteria:

- A clean `pnpm install && pnpm run demo:devnet && pnpm --filter @roundfi/app dev` flow lets anyone watch the loop work.
- Dashboard `/home` Activity feed renders **real on-chain events**, not seeded ones.
- 3–4 merged PRs + a final `docs/post-mortem.md` documenting what 8–10 PRs of agentic engineering looks like in concrete numbers (time per PR, kinds of decisions automated, kinds the human kept).

## Total estimated PR count

8–10 merged PRs over 6 weeks. Aligned with the 40 PRs / project lifetime cadence already documented in `03_PR_LOG.md`.

## What's explicitly out of scope for this grant

- Mainnet deploy (audit-required; not for $200).
- Custom MCP server for RoundFi-specific operations (separate / future grant).
- B2B Score API productization (separate / future).
- Marketing / partnership work.

This milestone list is what 6 weeks of subsidized agentic engineering credibly buys, no more.

---

End of bundle. Index: [`00_README.md`](./00_README.md).

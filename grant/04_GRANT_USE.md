# 04 · Grant Use — what the $200 actually buys

> The grant is described as "$200 to help cover your AI bill while you keep doing agentic engineering". This file is honest about what that buys, no inflation.

## What I currently spend on AI tooling

Approximate, monthly, all paid by the builder personally:

| Tool | Monthly | Notes |
|---|---|---|
| Claude Code Pro+ | ~$100 | Primary engineering driver — produced 42 PRs in this repo. |
| OpenAI API (occasional Codex / GPT review) | ~$20–30 | Cross-checks on Anchor program logic and TypeScript edge cases. |
| Misc (embeddings / small models) | ~$10 | RAG over docs, occasional jq/sed assistance. |
| **Total** | **~$130–140 / month** | |

## What $200 covers

At my current burn rate, $200 = **~6 weeks of runway**. That maps cleanly to a defined push:

### Goal for the 6 weeks: validate the Anchor draft against L1, ship the demo loop on devnet

The front-end is feature-complete and reads from a typed in-memory `SessionProvider` that emits lifecycle events (PR #28). The Anchor programs are drafted in Rust (~4,300 LoC across 14 `roundfi-core` instructions plus full math modules) but lack the validation gates that turn drafts into shippable software: economic parity against L1, green bankrun lifecycle/edge specs, and a reproducible devnet deploy.

Concretely, a single Claude Code session at the current cadence can plausibly land:

- **2–3 PRs** for the **economic parity** test — running each `/lab` preset (Healthy / Pre-default / Post-default / Cascade) through `runSimulation()` AND through `roundfi-core` under `solana-bankrun`, asserting identical `FrameMetrics`. Surfaces every divergence between the L1 spec and the L2 implementation.
- **2–3 PRs** turning the 13 drafted specs (`tests/lifecycle.spec.ts`, `edge_*`, `security_*`, `reputation_*`, `yield_integration`) green under bankrun. Cross-program CPI between `roundfi-core` and `roundfi-reputation` covered here.
- **1 PR** for `scripts/devnet/deploy.ts` actually deploying both programs and a `pnpm run demo:devnet` that initializes a sample pool from a fresh wallet.
- **1 PR** wrapping the live CPI calls in the existing `lib/session.tsx` so dashboard UI doesn't have to change — the reducer just dispatches against real CPI calls instead of in-memory mutations.
- **1 PR** for an indexer thin-shim so account fetches feed back into the dashboard read path.
- **1 PR** for a README pass + the post-mortem doc.

That's **~8–10 PRs** of focused agentic work. At the historical rate (42 PRs over the project lifetime so far), 6 weeks of subsidized AI usage is plausibly enough to land it.

## Why this matters more than dollar value

The grant being **small** is the point. It's not funding a team or an audit budget — it's signaling that **agentic engineering is a real discipline worth subsidizing**, the same way Solana Foundation subsidizes Anchor templates and devnet RPC.

For a solo builder paying out of pocket, $200 is the difference between "I'll do this when I can afford another month of Claude Pro" and "I can keep momentum without budgeting around the subscription". That gap is exactly where projects like RoundFi stall, so the leverage is high.

## Honest framing — what this grant is NOT

- Not funding a marketing push.
- Not funding an audit (that's a separate effort, est. $5–15k for a Solana Anchor program).
- Not funding a team — single builder + AI pair.
- Not funding compute or RPC — using the public devnet faucet + Helius free tier.

It's a tooling subsidy for a builder who's already shown the discipline ([`03_PR_LOG.md`](./03_PR_LOG.md)) and the project ([`01_PROJECT.md`](./01_PROJECT.md)). Small ask, high signal.

---

Next: [`05_BUILDER_NOTE.md`](./05_BUILDER_NOTE.md) — short narrative.

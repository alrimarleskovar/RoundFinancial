# 04 · Grant Use — what the $200 actually buys

> The grant is described as "$200 to help cover your AI bill while you keep doing agentic engineering". This file is honest about what that buys, no inflation.

## What I currently spend on AI tooling

Approximate, monthly, all paid by the builder personally:

| Tool | Monthly | Notes |
|---|---|---|
| Claude Code Pro+ | ~$100 | Primary engineering driver — produced 37 PRs in this repo. |
| OpenAI API (occasional Codex / GPT review) | ~$20–30 | Cross-checks on Anchor program logic and TypeScript edge cases. |
| Misc (embeddings / small models) | ~$10 | RAG over docs, occasional jq/sed assistance. |
| **Total** | **~$130–140 / month** | |

## What $200 covers

At my current burn rate, $200 = **~6 weeks of runway**. That maps cleanly to a defined push:

### Goal for the 6 weeks: bridge the mock orchestrator to live on-chain Anchor programs

The front-end is feature-complete and reads from a typed in-memory `SessionProvider` that emits lifecycle events (PR #28). The Anchor programs are scaffolded but only expose `ping`. The bridge between them is the next milestone.

Concretely, a single Claude Code session at the current cadence can plausibly land:

- **2–3 PRs** wiring `roundfi-core` instructions (initialize_pool, join, pay_installment, draw, conclude) — each follows the same plan/slice/commit pattern this repo already runs on.
- **1 PR** wrapping those calls in the existing `lib/session.tsx` so dashboard UI doesn't have to change — the reducer just dispatches against real CPI calls instead of in-memory mutations.
- **1 PR** for an indexer thin-shim so account fetches feed back into the dashboard read path.
- **2–3 PRs** for the test harness — driving `tests/lifecycle.spec.ts` against the live programs in devnet.
- **1 PR** for a README pass + a runnable demo script.

That's **~8–10 PRs** of focused agentic work. At the historical rate (37 PRs over the lifetime so far), 6 weeks of subsidized AI usage is plausibly enough to land it.

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

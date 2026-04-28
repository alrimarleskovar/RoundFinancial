# 02 · Agentic Process — How this codebase actually got built

> If you only read one file, read this one. The rest of the bundle gives context; this one is the meta-evidence the grant is asking for.

This file documents the **discipline, tools, and division of labor** that produced 37 merged PRs in `alrimarleskovar/RoundFinancial`. Every claim below is verifiable from the public repo — PR bodies, commit messages, file diffs.

---

## 1. The setup — `solana.new` + Claude Code, nothing exotic

The whole project runs on the standard Solana onboarding stack:

```bash
curl -fsSL https://www.solana.new/setup.sh | bash    # toolchain
git clone https://github.com/alrimarleskovar/RoundFinancial.git
cd RoundFinancial
pnpm install
pnpm --filter @roundfi/app dev                       # frontend live in 30s
```

Then on top of that: **Claude Code** (the CLI/web sessions) talking to the same workspace. No custom IDE, no parallel toolchain — just `solana.new` for the Solana side, Claude Code for the agent side. They compose because the agent runs *in* the same project tree as the build commands.

## 2. The loop — plan → micro-slice → confirm → ship

The single most repeated pattern in this repo:

1. **Builder asks for an outcome** — usually informal ("siga pro B.2.b", "quero esse landing mais dinâmico", "queria mais vida na tabela").
2. **Agent proposes a plan with letters** — concrete, scoped, with files to touch and recommendations:
   > "Ordem recomendada: (a) refatorar GroupCard pra puxar mock state, (b) adicionar JoinGroupModal, (c) wirar no click. Seguindo (a)."
3. **Builder picks** — letters keep the conversation cheap. Often just `"a"` or `"siga"`.
4. **Agent executes in slices** — one slice = one logical unit (e.g. "Slice 1: ConnectionsProvider context"). Typecheck after each.
5. **Agent commits + pushes + opens PR + merges** via the GitHub MCP — every step under MCP, no proxied gh CLI guesswork. Branch deleted by the user via UI (the only manual step in the loop).
6. **Builder pulls main** when ready, runs `pnpm dev`, gives feedback.

This loop is **fast** (PRs land in ~10–30 min each) and **safe** (every PR is reviewable, scoped, type-checked).

## 3. PR discipline — every body has the same skeleton

Look at any PR in the repo. They all have:

- `## Summary` — 2-3 sentences, what changed and why
- `## Commits` — list with SHAs + one-liners (slices are visible)
- `## What lands` — bullet list of files/components, organized by area
- `## Test plan` — checkbox list the builder can run locally
- `## Out of scope` — explicit non-goals so the next PR has clear water

Each body ends with `https://claude.ai/code/session_…`. The session URL is the breadcrumb. The agent wrote every PR body. The builder reviewed and clicked merge.

## 4. The toolchain — what the agent actually called

| Tool | Used for | Notes |
|---|---|---|
| `Read` / `Edit` / `Write` | File work | `Edit` preferred over `Write` for diffs (cheaper context). |
| `Bash` | git, pnpm, typecheck, find/grep, file ops | All long-running commands flagged with description. |
| `mcp__github__*` | branch / PR / merge cycle | `create_pull_request`, `merge_pull_request`, `list_pull_requests`. The local proxy git push 403'd at one point — the MCP API was the recovery path. |
| `WebFetch` | Pull external pages (design bundle, grant page) | Cached 15 min. |
| `ToolSearch` | Load deferred MCP tool schemas on demand | Keeps the prompt budget small until a tool is actually needed. |
| `TodoWrite` | Working memory for multi-slice plans | Marked in_progress / completed as work moved. |

## 5. Real engineering moments — not just prose

The repo's PR history records real problems solved, not vibes. Examples:

- **PR #14 — `fix: redirect to landing on wallet disconnect`.** Builder reported the disconnect button "doesn't work — stays on Maria Luísa's page". Diagnosed: dashboard had no inverse listener for `wallet.connected → false`. Built `useRedirectOnDisconnect()` hook with a `useRef` guard so initial-mount-with-no-wallet doesn't bounce loop. Documented why in the PR body.
- **PR #17 — `fix(faucet): always expose the hosted Solana faucet + log raw error`.** Public devnet RPC was 429-rate-limiting airdrops. Two fixes: (a) console.error the raw response so future failures show the exact reason, (b) make the hosted-faucet fallback a permanent secondary CTA next to the gradient button — not just a banner that appears on rate-limit detection.
- **PR #22 — `fix(landing): unbreak the sticky header`.** Sticky was added in PR #13 but silently failed because `<main>` had `overflow-x-hidden` (any overflow on an ancestor kills `position: sticky`). Moved the overflow to `html/body` in `globals.css`.
- **PR #34 / #36 — wallet-button glow not visible / "long bar" artifact.** Wrapper-based animation refactor; learned the hard way that `display: inline-flex` + `width: 100%` baseline-aligns into a strip on Chromium. Two PRs to land it cleanly.

These aren't pasted from a tutorial. They're the kind of subtle, high-context fixes where AI pairing earns its keep.

## 6. Branch hygiene — disciplined even at velocity

37 PRs, 37 branches, all named `claude/<scope>` (e.g. `claude/b5b-mercado`, `claude/landing-table-life`, `claude/round4-session-orchestrator`). One branch per PR. Branches deleted after merge. Main never had a force-push. Local main always synced before starting a new branch.

The builder didn't have to enforce any of this — the agent's default workflow does it. That's the value: not "AI writes code", but "AI runs the engineering process so the human only has to make decisions".

## 7. Division of labor — who decided what

**The builder decided:**
- Product direction (ROSCA-on-Solana, behavioral credit, who the user is).
- Visual identity (Neon palette, "wake up the buttons", Web3 high-end vibe).
- Scope of every PR ("siga com B.5.b", "pode merjar", "outro PR pra isso").
- When something looked off ("a barra de fundo continua maior", "esse halo não aparece").

**The agent did:**
- Translated direction into concrete plans (the letter-options pattern).
- Wrote every line of code, every PR body, every commit message.
- Held all the context across 37 PRs — file paths, what-was-changed-where, naming conventions.
- Caught technical traps before they landed (typecheck loops, sticky/overflow conflict, inline-flex pitfall).
- Maintained README sync with reality (PR #16, PR #35).

The builder never had to remember which file holds what or which CSS keyframe was named what. That cognitive offload **is** the agentic engineering value prop the grant is funding.

## 8. What you can verify in 5 minutes

1. Open https://github.com/alrimarleskovar/RoundFinancial/pulls?q=is%3Apr+is%3Aclosed — scan the PR titles.
2. Open any 3 PRs at random — note the structured body, the linked session URL, the test plan.
3. Open `app/src/lib/session.tsx` (PR #28) — read the reducer. That's the typed state machine that drives the live dashboard.
4. Run the project: `git clone … && pnpm install && pnpm --filter @roundfi/app dev`. The Bento `/home`, the radial Score, the terminal Activity — all from the same agent loop.

---

Next: [`03_PR_LOG.md`](./03_PR_LOG.md) — every PR in order.

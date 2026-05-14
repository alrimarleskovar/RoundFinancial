# E2E tests (Playwright)

End-to-end tests for the RoundFi front-end. This is the **foundation
lane** scoped under issue [#270](https://github.com/alrimarleskovar/RoundFinancial/issues/270):

- Playwright + chromium project
- Spins up `pnpm dev` (or `pnpm start` when `E2E_USE_BUILD=1`) and runs
  tests against `http://127.0.0.1:3000`
- Failure screenshots + traces + videos captured automatically (CI:
  `retain-on-failure`)

## Run locally

```bash
# First-time setup — installs browsers
pnpm --filter @roundfi/app test:e2e:install

# Run all specs
pnpm --filter @roundfi/app test:e2e

# Interactive UI mode (filtering + step-through)
pnpm --filter @roundfi/app test:e2e:ui
```

The first run takes a moment because the webServer config boots
`next dev` before any tests execute. `reuseExistingServer` is `true`
locally, so subsequent runs piggyback off an already-running dev
server.

## CI

`.github/workflows/e2e.yml` runs on every PR touching `app/**`,
`sdk/**`, or the workflow itself. Artifacts (HTML report + traces) are
uploaded on failure for triage.

## Current coverage (foundation)

| Spec              | What it covers                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `landing.spec.ts` | `/` renders hero h1, wallet button, EN/PT language flip                                                                               |
| `routes.spec.ts`  | 7 dashboard routes (`/home`, `/carteira`, `/grupos`, `/reputacao`, `/mercado`, `/insights`, `/lab`) render without 5xx, layout mounts |

## Not yet covered (deferred to follow-up PRs)

The full issue scope calls for 3 wallet-connected flows:

1. **Contribute** — connect → open `PayInstallmentModal` → sign tx → assert Solscan receipt
2. **Claim payout** — connected as cycle recipient → `ClaimPayoutModal` → assert balance change
3. **Wallet allowlist** — connect unallowlisted wallet → assert warning badge renders

These need additional infrastructure that we explicitly defer:

- **Mock wallet adapter** (`@solana/wallet-adapter-mock` or an
  injected `window.solana` stub) so Phantom doesn't need to be in the
  browser binary
- **Pinned devnet pool fixtures** (Pool 2 or a dedicated E2E pool with
  known cycle / member state, kept in known-good shape via a setup
  script run before the test suite)
- **Allowlist test scaffolding** — env override that flips the
  allowlist check on without requiring a separate build

Tracking under issue #270 as workstream 2.

## Conventions

- Pin locale to `en` via localStorage in `beforeEach` so text
  assertions are stable. The default app locale is `pt`.
- Prefer `getByRole` over CSS selectors when possible — these survive
  className refactors and align with a11y best practices.
- Tests must be deterministic. If a network call would matter, mock
  it (Playwright's `page.route()`) rather than letting the test hit
  devnet RPC live.

# Contributing to RoundFi

Thanks for considering a contribution. RoundFi is open source under Apache 2.0 — bug reports, fixes, and feature PRs are welcome.

This guide is intentionally short. Reading the existing CI workflows (`.github/workflows/ci.yml`) and recent merged PRs is the fastest way to see the bar.

## Quick setup

```bash
# 1. Install JS toolchain (Node 20+, pnpm 9)
corepack enable && corepack prepare pnpm@9.12.0 --activate

# 2. Install Rust toolchain + Anchor for on-chain work
# Solana 1.18.26 / Agave 2.x stable, Anchor 0.30.1
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1 && avm use 0.30.1

# 3. Workspace install
pnpm install --no-frozen-lockfile

# 4. Build programs (produces target/deploy/*.so + IDLs)
anchor build
```

## Validating a change

CI runs five gates on every PR — your branch must pass all of them locally before review:

```bash
pnpm lint                       # Prettier format check
pnpm typecheck                  # tsc --noEmit on the workspace
pnpm test:parity                # Rust ↔ TS constants/seeds parity (7 tests)
pnpm test:events                # LifecycleEvent shape contract (2 tests)
pnpm test:economic-parity-l1    # Stress Lab L1 economic parity (34 tests)
anchor test                     # Anchor lane — proptest invariants under SBF
```

If any of these fail locally, they will fail in CI.

## Branch + commit conventions

- **Branch name**: `feat/<scope>`, `fix/<scope>`, `docs/<scope>`, `chore/<scope>`. Existing `claude/<scope>` branches are AI-authored, follow the same pattern.
- **Commit message**: imperative mood, ≤ 72 chars first line. Use the Conventional Commits prefix (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- **PR title**: matches the commit subject of the squash-merge.
- **PR description**: short summary, optional test plan checklist. See `.github/PULL_REQUEST_TEMPLATE.md`.
- **CHANGELOG**: PRs that ship user-visible behavior (new features, breaking changes, fixed bugs) add a single line under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md). Internal refactors, test additions, and doc-only PRs don't need an entry — keep the changelog signal-dense.

## Code style

Enforced by tooling — no manual style debates:

- **TypeScript / JS / Markdown / JSON / YAML**: Prettier (config at `.prettierrc`). `pnpm lint` checks, `pnpm exec prettier --write .` fixes.
- **Rust**: `rustfmt` defaults. `cargo fmt --all` before commit.

## What's in scope

- Bug fixes for on-chain logic (`programs/`), SDK (`packages/sdk`), front-end (`apps/`), or indexer (`services/indexer`)
- New tests covering existing behavior or regressions
- Documentation fixes (typos, broken links, clarifications)
- Performance / readability refactors that don't change external behavior

## What's out of scope (for now)

- Mainnet deployment requests — RoundFi runs on devnet until the protocol is audited.
- Breaking changes to the on-chain account layouts — these require a coordinated upgrade plan; open an issue to discuss first.
- New protocol features without a corresponding update to `docs/status.md` and the relevant `tests/`.

## Reporting bugs / suggesting features

See the issue templates in `.github/ISSUE_TEMPLATE/`. Security vulnerabilities go through `SECURITY.md`, not the public issue tracker.

## License

By contributing, you agree your contributions will be licensed under [Apache 2.0](LICENSE).

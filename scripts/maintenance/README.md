## scripts/maintenance/

One-shot maintenance artifacts — generated outputs that are useful to keep in the repo for a single cleanup pass, then typically retired.

### `branch-cleanup-2026-05-17.txt`

Inventory of **304 remote branches safe to delete** (post wave-5 doc refresh, 2026-05-17). Built by:

1. Listing remote branches: `git branch -r --no-merged main` + `git branch -r --merged main`
2. Cross-referencing each branch's name against the GitHub PR API (`mcp__github__list_pull_requests` paged over 347 PRs) to identify squash-merge orphans Git's reachability check can't see
3. Classifying into MERGED / CLOSED_UNMERGED / OPEN_PR / NO_PR

**Composition:**

| Class                                               | Count   | Notes                                                                                                                              |
| --------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Squash-merge orphans (PR merged)                    | 261     | Git `--merged` misses these because squash rewrites commit hashes                                                                  |
| Truly merged (Git-detectable via `--merged main`)   | 37      | Old enough to be reachable from main HEAD                                                                                          |
| PR closed without merging                           | 2       | `claude/video-pitch-script` (#183), `fix/anchor-idl-build-payload-newtype` (#358)                                                  |
| No-PR historical (work absorbed or abandoned spike) | 4       | `chore/riptide-spike`, `chore/tests-mocha-tsx-loader`, `claude/setup-copilot-api-config-PuGXP`, `claude/web3-security-audit-2CA0r` |
| **Total**                                           | **304** |                                                                                                                                    |

**Excluded from this list (KEEP):**

- 11 branches with **OPEN PRs** (7 dependabot + #319 Agave 2.x + #280, #279, #357 in-flight)
- `claude/implement-roundfi-desktop-SRV6l` — current wave-doc-refresh session branch
- `main`
- **1 RESCUE candidate**: `chore/protocol-config-decoder-helper` — contains `scripts/devnet/dump-protocol-config.ts` (304-line ProtocolConfig PDA decoder), no other place it lives. Diagnostic tooling for the pre-Fase-5 `realloc` migration surfaced by the 2026-05-16 Squads rehearsal. Decide explicitly: cherry-pick or retire.

### How to run

From any clone with push access to `origin`:

```bash
cd ~/RoundFinancial
git fetch --prune origin
xargs -L1 git push origin --delete < scripts/maintenance/branch-cleanup-2026-05-17.txt
```

Expected result: remote branch count `317 → 13`.

### Lifecycle

This file is **one-shot**. After the deletion run completes:

1. Confirm `git branch -r | wc -l` is at the expected post-cleanup count
2. Delete this inventory + bump `README.md` to remove the entry above
3. Or commit a `chore: retire branch-cleanup-2026-05-17 inventory` PR

Future cleanups should generate a fresh `branch-cleanup-<YYYY-MM-DD>.txt` rather than amending this one — the dated suffix keeps the audit trail readable.

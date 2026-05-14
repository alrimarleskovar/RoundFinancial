# `roundfi-math` fuzz lane

Coverage-guided fuzzing for the pure-Rust actuarial math crate, using
[`cargo-fuzz`](https://rust-fuzz.github.io/book/cargo-fuzz.html) +
libFuzzer. Foundation under issue
[#284](https://github.com/alrimarleskovar/RoundFinancial/issues/284).

## Why fuzz on top of existing proptest

`crates/math/src/waterfall.rs` already ships 6 proptest invariants
(~1500 random cases per `cargo test`) per ADR
[0004](../../../docs/adr/0004-extract-roundfi-math-crate.md).
proptest samples the input space **uniformly** — fine for invariant
verification, but libFuzzer is **coverage-guided**: it preferentially
mutates inputs that exercise new code paths. The two layers find
different bug classes:

| Layer        | Catches                                             | Sampling                 |
| ------------ | --------------------------------------------------- | ------------------------ |
| `proptest`   | Invariant violations under uniform input            | Random within strategy   |
| `cargo-fuzz` | Crashes, overflows, edge cases at branch boundaries | Coverage-guided mutation |

Mature financial / crypto Rust projects (`subtle`, `ring`,
`solana-program`'s borsh decode) ship both for this reason.

## Targets (6)

| Target           | Module                                                       | Invariants asserted                                                            |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `cascade`        | `cascade.rs::seize_for_default`                              | `total <= missed`; per-source caps; solidarity-before-escrow ordering          |
| `waterfall`      | `waterfall.rs::waterfall`                                    | strict conservation; GF cap; no bucket > yield                                 |
| `dc_invariant`   | `dc.rs::dc_invariant_holds` + `max_seizure_respecting_dc`    | post-seizure D/C still holds; cap-down only; never panics                      |
| `escrow_vesting` | `escrow_vesting.rs::cumulative_vested` + `releasable_delta`  | monotonicity in k; exact-principal rule at final checkpoint; delta consistency |
| `bps`            | `bps.rs::apply_bps` + `split_installment`                    | result <= amount; conservation in split (sol+esc+pool == installment); caps    |
| `seed_draw`      | `seed_draw.rs::seed_draw_floor` + `retained_meets_seed_draw` | floor <= members × installment; inequality agreement; bps=0 / inst=0 → 0       |

## Run locally

Needs the **nightly** toolchain — cargo-fuzz / libfuzzer-sys
requirement (the workspace crate itself stays on stable).

```bash
# One-time setup
rustup toolchain install nightly
cargo install cargo-fuzz --locked

# Run a single target for 60 seconds
cd crates/math/fuzz
cargo +nightly fuzz run cascade -- -max_total_time=60

# Run all targets, longer
for t in cascade waterfall dc_invariant escrow_vesting bps seed_draw; do
  cargo +nightly fuzz run $t -- -max_total_time=300
done
```

cargo-fuzz writes crashes to `crates/math/fuzz/fuzz/artifacts/<target>/`
and adds interesting inputs to `corpus/<target>/` automatically. The
initial corpus seeds (one per target) live in `corpus/` already.

## How to triage a crash

1. cargo-fuzz prints a path like `crashes/crash-<sha>` on a finding.
2. Reproduce: `cargo +nightly fuzz run <target> crashes/crash-<sha>`
   — re-runs the target with just that single input.
3. The input is interpreted by `arbitrary` per the target's
   `FuzzXxxInput` struct — read it back with `Arbitrary::arbitrary`
   from the same struct to inspect the field values.
4. If it's a real bug: write a regression test in
   `crates/math/src/<module>.rs::tests` first, then fix.
5. If it's a fuzzing artifact (e.g., a wraparound that's intentional
   and bounded elsewhere): document why it's not a bug, and add it
   to `corpus/<target>/` so future fuzz runs deprioritize it.

## CI

**Two lanes** — short on every PR, long once a week.

### Lane 1 — PR-time smoke (`fuzz.yml`)

Runs each target for 60 seconds on every PR touching `crates/math/**`.
Catches regressions / new crashes against the **existing committed
corpus**. Per-target results land as workflow artifacts (14d).

Advisory-only on day 1 (`continue-on-error: true`) — flip to required
after 2-3 green PR runs. Same pattern as `coverage.yml` + `e2e.yml`.

### Lane 2 — scheduled long-run (`fuzz-scheduled.yml`)

Runs every Monday at 06:00 UTC (`workflow_dispatch` for manual triggers
with a duration / target-filter override). Each target gets **30 min**
of coverage-guided mutation against an **evolving corpus**:

1. Downloads the previous scheduled run's `merged-corpus-<target>`
   artifact (if any) and uses it as the starting corpus
2. Runs `cargo fuzz run` for 30 min
3. Runs `cargo fuzz cmin` to minimize (deduplicate) the corpus
4. Uploads the new merged corpus as `merged-corpus-<target>` for the
   next run (90d retention — never expires while the schedule is live)
5. Uploads logs + any crash artifacts (`fuzz-scheduled-<target>`, 30d)

The two lanes together give us:

- **Fast feedback** on every PR (60s × 6 = 6 min total)
- **Cumulative coverage** across weeks (30 min × 6 = 3h per week,
  starting fresh corpora that grow over time)
- **Bounded CI cost** — the long lane only runs once per week

### Promoting corpus inputs to the repo

The scheduled lane's `merged-corpus-<target>` artifact is **ephemeral**
(re-uploaded each run, 90d expiry). To make a corpus input permanent,
pull it down and commit it to `crates/math/fuzz/corpus/<target>/`:

```bash
# Pull the latest merged corpus from the most recent scheduled run
gh run download --name merged-corpus-cascade -D /tmp/cascade-corpus

# Manually inspect the corpus — keep the most "interesting" inputs
# (the ones that triggered new coverage in the last run)
ls -la /tmp/cascade-corpus

# Copy selectively into the repo
cp /tmp/cascade-corpus/<input-hash> crates/math/fuzz/corpus/cascade/
git add crates/math/fuzz/corpus/cascade/
git commit -m "fuzz: add scheduled-lane corpus inputs for cascade target"
```

Manual rather than auto-commit by design: the repo doesn't need every
mutation, and auto-commit by a bot would add noise + risk runaway
corpus growth.

## Why `crates/math/fuzz` is NOT a workspace member

cargo-fuzz needs:

- nightly toolchain (for `-Cinstrument-coverage` flags)
- `libfuzzer-sys` linker setup (custom build script)
- different release profile

Including it as a workspace member would force the rest of the
workspace to deal with these settings. Cleaner to exclude it (see
`Cargo.toml` `workspace.exclude`), keep stable Rust everywhere else,
and have the fuzz lane install nightly + cargo-fuzz on its own runner.

## References

- ADR [0004](../../../docs/adr/0004-extract-roundfi-math-crate.md) — math crate extraction (proptest already integrated)
- Issue [#284](https://github.com/alrimarleskovar/RoundFinancial/issues/284) — original proposal
- [cargo-fuzz book](https://rust-fuzz.github.io/book/cargo-fuzz.html)
- Sister advisory lanes: `coverage.yml`, `e2e.yml`

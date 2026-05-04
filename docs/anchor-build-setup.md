# Anchor build setup (WSL / Linux)

Reproducible recipe for `anchor build` against the RoundFi workspace.
Documents the toolchain alignment landed in the PR that added this file
— if you're hitting one of the errors below, the fix is committed.

---

## TL;DR — fresh setup

```bash
# 1. Install Rust (host, used for cargo install + lockfile generation)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
. "$HOME/.cargo/env"

# 2. Install Solana Agave 3.0.0 (pinned — see "Pitfalls" below)
curl -sL -o /tmp/agave.tar.bz2 \
  https://github.com/anza-xyz/agave/releases/download/v3.0.0/solana-release-x86_64-unknown-linux-gnu.tar.bz2
mkdir -p "$HOME/agave"
tar -xjf /tmp/agave.tar.bz2 -C "$HOME/agave" --strip-components=1
export PATH="$HOME/agave/bin:$PATH"
solana --version  # → solana-cli 3.0.0

# 3. Install Anchor 0.30.1 (NO --locked — see "Pitfalls")
cargo install --git https://github.com/coral-xyz/anchor --tag v0.30.1 anchor-cli

# 4. Build (NO IDL — see "Pitfalls")
cd RoundFinancial
anchor build --no-idl
```

---

## Pitfalls (all already mitigated by the committed Cargo.lock + Anchor.toml)

### A. `solana-install init <ver>` fails

**Symptom:** `Error: No such file or directory (os error 2)` early in
`anchor build`, before any compile starts.

**Cause:** Stale `[toolchain] solana_version = "1.18.17"` in
`Anchor.toml` triggered `solana-install init 1.18.17` against an Anza
2.x/3.x install that no longer manages legacy 1.x versions.

**Fix:** Removed the `[toolchain]` block from `Anchor.toml`. Build now
uses whichever `solana` is in `PATH`.

### B. `feature 'edition2024' is required`

**Symptom:** `failed to parse manifest at .../hashbrown-0.17.0/Cargo.toml`
or `hybrid-array-0.4.11` or `block-buffer-0.12.0`. Platform-tools cargo
is 1.84 which doesn't support the `edition2024` feature.

**Cause:** `mpl-core 0.8.1` declares `solana-program >1.14` (loose),
which Cargo resolves to 2.3.0+ — that pulls modern hashbrown / hybrid-
array / block-buffer that all opted into edition2024 mid-2025.

**Fix:** Committed `Cargo.lock` pins:

- `solana-program = 1.18.26` (downgraded from 2.3.0)
- `blake3 = 1.5.0` (uses digest 0.10 / block-buffer 0.10 — pre-edition2024)
- `indexmap = 2.7.0` (last version using hashbrown 0.15)
- `proc-macro-crate = 3.2.0` (uses pre-edition2024 toml_edit)
- `unicode-segmentation = 1.12.0` (1.13 needs rustc 1.85)

If you regenerate `Cargo.lock`, run:

```bash
cargo update -p solana-program@2.3.0 --precise 1.18.26
cargo update -p blake3 --precise 1.5.0
cargo update -p indexmap --precise 2.7.0
cargo update -p proc-macro-crate@3.5.0 --precise 3.2.0
cargo update -p unicode-segmentation --precise 1.12.0
```

### C. `Span::source_file` not found

**Symptom:** `error[E0599]: no method named 'source_file' found for
struct 'proc_macro2::Span'` from inside `anchor-syn` during IDL build.

**Cause:** `Span::source_file()` was an unstable rustc API that was
removed in stable 1.84+. anchor 0.30.1 was written when this API still
worked. Fixed in anchor 0.31+ but our codebase is pinned to 0.30.1.

**Fix:** Build with `--no-idl`:

```bash
anchor build --no-idl
```

The IDL is needed for the TypeScript SDK to wire types automatically,
but the SBF program build itself does not depend on IDL. For the SDK
side, the generated IDL JSON is checked in under `sdk/src/generated/`
and refreshed by hand when the program ABI changes.

### D. `--locked` fails on `time` crate

**Symptom:** `cargo install ... --locked` aborts with E0282 in
`time-0.3.x`.

**Cause:** `time 0.3.x` (anchor's pinned dep) doesn't compile against
Rust 1.85+ due to a tightened type-inference rule. Anchor 0.30.1's own
`Cargo.lock` was last bumped before that rust release.

**Fix:** Drop `--locked` so cargo resolves a newer compatible `time`:

```bash
cargo install --git https://github.com/coral-xyz/anchor --tag v0.30.1 anchor-cli
```

### E. Stable channel install missing `platform-tools/rust/lib`

**Symptom:** Anchor's stable Anza installer (3.1.14 at time of writing)
finishes but the SBF compiler dir (`~/.local/share/solana/.../platform-tools/rust/lib`)
is missing.

**Cause:** Modern Anza moved `platform-tools` to lazy download on first
`cargo build-sbf` run. Sometimes the lazy download fails silently due
to network hiccups, leaving a half-installed state.

**Fix:** Pin to **Agave 3.0.0** (which ships platform-tools v1.51
inline with the install tarball). The TL;DR command above does this.
If you want to retry stable instead:

```bash
rm -rf ~/.cache/solana ~/.local/share/solana
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
cargo build-sbf --version  # forces the platform-tools download
```

---

## Verifying the build

After `anchor build --no-idl` runs through dependency resolution + the
SBF target compile, expect:

```
target/deploy/roundfi_core.so
target/deploy/roundfi_reputation.so
target/deploy/roundfi_yield_mock.so
target/deploy/roundfi_yield_kamino.so
```

If you hit `error[E0277]: the trait bound '[u8; 96]: BorshSerialize'`
in `roundfi-reputation`, that's a **borsh 1.x array-impl gap** that's
unrelated to the toolchain — it's a real codebase fix tracked
separately. The toolchain itself is unblocked at that point.

---

## CI parity

`.github/workflows/ci.yml`'s `anchor` lane runs the same recipe on a
fresh `ubuntu-latest` runner. The lane is **required** today (no
`continue-on-error`) — green there means a fresh ubuntu can reproduce
what we get on WSL. If a step fails in your WSL but passes in CI
(or vice versa), check:

1. The committed `Cargo.lock` matches what's on `main` (don't run
   `cargo update` casually — run the precise pins above).
2. `Anchor.toml` does NOT have a `[toolchain]` block.
3. Your `solana --version` reports `2.x` or `3.x`, not `1.x`.

---

## Why bankrun isn't in CI yet

`pnpm test:bankrun` exercises the full lifecycle suite against
`solana-bankrun`. It loads `target/idl/*.json` to build typed `Program`
handles. Those JSON files come from `anchor build` *without* `--no-idl`
— and that path hits Pitfall **C** above (`Span::source_file()`).

We investigated three solutions in depth:

### Option 1 — Bump anchor 0.30 → 0.31

Anchor 0.31 removed the `Span::source_file()` call upstream. But:

- `mpl-core 0.8.0` (which we use for the position NFTs) hard-pins
  `anchor-lang = "0.30.0"`. To bump anchor we must bump mpl-core to
  0.12+ as well.
- `mpl-core 0.12` reshapes the plugin builder (`CreateV2CpiBuilder`
  signatures, `Plugin` enum variants) — concrete code rewrites in
  `join_pool.rs`, `escape_valve_buy.rs`, `harvest_yield.rs`.
- Estimated effort: 1–2 days, including re-validating the audit fixes
  from PRs #122, #123, #124, #125, #127.

Tracked as a future "mainnet upgrade" PR. Not session-time.

### Option 2 — Hand-write IDL JSON files

Drop ~800 lines of hand-written IDL JSON into `sdk/src/generated/`
(one per program). Have the harness load from there instead of
`target/idl/`. Deterministic, but:

- Tedious to write correctly (instruction args, account structs,
  error codes, type defs, all by hand).
- Drift risk: every ABI change requires re-writing the JSON.
- Doesn't unlock `anchor test` (which still tries to build IDL); only
  unlocks bankrun.

Tracked as a follow-up if mainnet timeline forces it.

### Option 3 — Patch `anchor-syn` locally to skip `Span::source_file()`

Tried this. Vendored `anchor-syn 0.30.1` and replaced the call with
`CARGO_MANIFEST_DIR`-based path resolution. The patch compiled; it then
surfaced a deeper requirement: our `Payload` newtype (in
`roundfi-reputation/state/attestation.rs`, the borsh-array workaround
from PR #139) needs manual `IdlBuild` trait impls (`get_full_path`,
`create_type`, `insert_types`) — three methods that anchor's macros
auto-derive but only for `#[derive(AnchorSerialize, AnchorDeserialize)]`
types, not hand-rolled wrappers.

The vendor would have to maintain those impls per anchor version.
Net: the same maintenance burden as Option 2, with extra fragility.

### Decision

**Accept the gap. Document it. Move on.**

What CI gates today (per PR, required):

- prettier --check
- tsc --noEmit (workspace)
- 7 Rust↔TS parity tests
- 2 LifecycleEvent shape tests
- 34 Stress Lab L1 economic-parity tests (whitepaper math)
- cargo audit (advisory)
- `anchor build --no-idl` (SBF compile)

What's missing:

- bankrun integration suite (clock-warped lifecycle + escape-valve +
  default + yield flows)
- `anchor test` (full devnet lifecycle)

These come back in the mainnet upgrade PR (Option 1). Until then,
the L1 simulator + on-chain unit tests + property tests in
`math/waterfall.rs` (PR #129) cover the canonical economic invariants.

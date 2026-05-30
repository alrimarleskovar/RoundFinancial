#!/usr/bin/env bash
# Regenerate target/idl/*.json for the workspace programs.
#
# Wraps `anchor idl build` for each program after applying the #319
# patch to anchor-syn (see patch-anchor-syn-319.sh). The IDL JSONs
# are required by `tests/_harness/bankrun.ts`, which loads them via
# `loadIdl()` to construct typed Anchor `Program` handles over the
# bankrun env.
#
# Run order:
#   1. ensure cargo-build-sbf is on PATH (e.g. `/opt/solana/bin`)
#   2. bash scripts/dev/patch-anchor-syn-319.sh
#   3. bash scripts/dev/rebuild-idls.sh
#
# After this script: bankrun specs can `loadIdl("roundfi_core")` etc.
# without falling over on the "IDL not found" error.
set -euo pipefail

if ! command -v cargo-build-sbf >/dev/null 2>&1; then
  if [[ -x /opt/solana/bin/cargo-build-sbf ]]; then
    export PATH="/opt/solana/bin:$PATH"
  else
    echo "cargo-build-sbf not found on PATH or /opt/solana/bin" >&2
    exit 1
  fi
fi

# Populate the cargo registry (cache/ + src/) before we patch anchor-syn.
# The preceding `anchor build --no-idl` resolves the workspace with the
# `idl-build` feature OFF, so it doesn't fetch or extract anchor-syn —
# and modern `Swatinem/rust-cache@v2` strips `registry/src/` from its
# cache to save space. On a cache-restore boot the patch script would
# then find nothing to edit. A plain `cargo fetch` re-materializes the
# whole lockfile into the registry; the patch script has its own
# `cache → src` extraction fallback for the residual case where this
# step fetches into cache/ but not src/.
echo "→ cargo fetch (materialize anchor-syn-0.30.1 src for the patch below)"
cargo fetch --locked 2>/dev/null || cargo fetch 2>/dev/null || true

# Cargo hashes the registry URL into the directory name under
# ~/.cargo/registry/src/. `cargo install --git anchor-cli` extracts to one
# host hash; `anchor idl build` in this workspace uses the sparse-registry
# hash (different). Patching only the dirs visible right now misses the
# one `anchor idl build` will create on first invocation. Force that
# extraction up front via a deliberately-failing first IDL build (the
# #319 source_file() error trips, we ignore it) so the patch script
# sees the canonical sparse-registry dir and patches it before the real
# build calls run.
echo "→ priming sparse-registry extraction (expected to fail with #319)"
anchor idl build --program-name roundfi_core -o /dev/null >/dev/null 2>&1 || true

bash "$(dirname "$0")/patch-anchor-syn-319.sh"

mkdir -p target/idl

for prog in roundfi_core roundfi_reputation roundfi_yield_mock roundfi_yield_kamino; do
  echo "→ anchor idl build $prog"
  anchor idl build --program-name "$prog" -o "target/idl/${prog}.json" >/dev/null
done

echo "✓ IDLs regenerated:"
ls -la target/idl/

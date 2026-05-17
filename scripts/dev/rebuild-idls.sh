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

bash "$(dirname "$0")/patch-anchor-syn-319.sh"

mkdir -p target/idl

for prog in roundfi_core roundfi_reputation roundfi_yield_mock; do
  echo "→ anchor idl build $prog"
  anchor idl build --program-name "$prog" -o "target/idl/${prog}.json" >/dev/null
done

echo "✓ IDLs regenerated:"
ls -la target/idl/

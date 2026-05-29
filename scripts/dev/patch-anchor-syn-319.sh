#!/usr/bin/env bash
# Workaround for #319: anchor-syn 0.30.1's IDL builder calls
# `proc_macro2::Span::call_site().source_file()`, which proc-macro2
# 1.0.95+ removed even under the `procmacro2_semver_exempt` cfg. The
# call site is gated by `#[cfg(procmacro2_semver_exempt)]`, but the
# `anchor` CLI hard-codes that cfg in its `cargo` invocation (see
# `strings $(which anchor) | grep procmacro2_semver_exempt`), so the
# block compiles every time `anchor idl build` runs.
#
# This patches the cached anchor-syn-0.30.1 source in the local Cargo
# registry to swap the gate `#[cfg(procmacro2_semver_exempt)]` for
# `#[cfg(any())]` (always-false), excluding the broken block. The
# tradeoff: type-alias resolution for EXTERNAL types stops working,
# so any account field whose type is a re-exported alias from a
# different crate will fail IDL gen. The roundfi-* programs don't
# rely on that pattern — all account/instruction types are defined
# locally — so the workaround is safe for this workspace.
#
# The patch survives until the registry cache is wiped (e.g.
# `cargo clean -p anchor-syn` won't reach it; `rm -rf ~/.cargo/registry/src`
# will). Re-run after a fresh `cargo` install if IDL builds start
# failing with the same E0599 error.
#
# Resolves the local-only side of #319 (anchor-syn's IDL builder).
# The OTHER side of #319 — `anchor build` regenerating `metadata.address`
# as `11111…` placeholder — is unaffected; that's a separate Anchor 0.31+
# behavior fix.
set -euo pipefail

REG_PATH="${HOME}/.cargo/registry/src"
ANCHOR_SYN_DIR=$(find "$REG_PATH" -maxdepth 2 -name "anchor-syn-0.30.1" -type d 2>/dev/null | head -1)

# Modern `Swatinem/rust-cache@v2` (≥ 2.7) strips `~/.cargo/registry/src/`
# from the saved cache to halve its size — the expectation is that
# `cargo` will re-extract from `~/.cargo/registry/cache/*.crate` on demand.
# Our caller workflow (`anchor build --no-idl` then this script) never
# actually compiles anchor-syn before us — the `--no-idl` flag skips the
# `idl-build` feature that pulls anchor-syn into the dep graph — so on a
# cache-restore boot the .crate sits in `cache/` but the patch can't
# touch it: there's no source on disk yet. Manually extract it from the
# cached .crate (which is a plain `tar.gz`) into the matching `src/`
# index directory so the patch below can read+write the file. If no
# .crate is in cache either, fall through to the original error.
if [[ -z "$ANCHOR_SYN_DIR" ]]; then
  CACHE_PATH="${HOME}/.cargo/registry/cache"
  CRATE_FILE=$(find "$CACHE_PATH" -maxdepth 2 -name "anchor-syn-0.30.1.crate" 2>/dev/null | head -1)
  if [[ -n "$CRATE_FILE" ]]; then
    INDEX_HOST=$(basename "$(dirname "$CRATE_FILE")")
    DEST_DIR="${REG_PATH}/${INDEX_HOST}"
    mkdir -p "$DEST_DIR"
    echo "anchor-syn-0.30.1 src missing — extracting $CRATE_FILE → $DEST_DIR" >&2
    tar -xzf "$CRATE_FILE" -C "$DEST_DIR"
    ANCHOR_SYN_DIR="${DEST_DIR}/anchor-syn-0.30.1"
  fi
fi

if [[ -z "$ANCHOR_SYN_DIR" || ! -d "$ANCHOR_SYN_DIR" ]]; then
  echo "anchor-syn-0.30.1 not in $REG_PATH and no .crate in registry/cache — run 'cargo fetch' first" >&2
  exit 1
fi

DEFINED_RS="$ANCHOR_SYN_DIR/src/idl/defined.rs"
if grep -q "SANDBOX PATCH" "$DEFINED_RS"; then
  echo "$DEFINED_RS already patched, nothing to do"
  exit 0
fi

# Match exactly the procmacro2_semver_exempt-gated block that calls
# Span::call_site().source_file(). Replace the cfg gate with cfg(any())
# (always-false) so the block is excluded from compilation.
python3 - "$DEFINED_RS" <<'PYEOF'
import sys, re, pathlib
p = pathlib.Path(sys.argv[1])
src = p.read_text()
old = "            // Handle type aliases and external types\n            #[cfg(procmacro2_semver_exempt)]\n"
new = "            // Handle type aliases and external types\n            // SANDBOX PATCH (#319): was #[cfg(procmacro2_semver_exempt)]\n            // proc-macro2 1.0.95+ removed Span::source_file(). Anchor CLI\n            // hard-codes the cfg, so block always compiled — disable via cfg(any()).\n            #[cfg(any())]\n"
if old not in src:
    print("expected pattern not found in", p, file=sys.stderr)
    sys.exit(2)
p.write_text(src.replace(old, new, 1))
print("patched", p)
PYEOF

echo "anchor-syn-0.30.1 patched. Run 'anchor idl build --program-name <name> -o target/idl/<name>.json' for each program."

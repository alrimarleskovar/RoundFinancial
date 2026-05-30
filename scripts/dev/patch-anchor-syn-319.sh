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

# Verbose tracing so the CI log identifies which materialization path
# (registry/src direct → cache .crate → crates.io direct) fired and where
# the source landed. Trivial cost, huge debug value the next time the
# build environment shifts.
echo "::group::patch-anchor-syn-319: materialize anchor-syn-0.30.1 src"

REG_PATH="${HOME}/.cargo/registry/src"
CACHE_PATH="${HOME}/.cargo/registry/cache"
mkdir -p "$REG_PATH" "$CACHE_PATH"

# Cargo hashes the registry URL into the directory name. The sparse
# registry (used by `anchor idl build` in the workspace) and the git
# registry (sometimes used by `cargo install --git`) have DIFFERENT
# hashes — so a runner can end up with TWO `anchor-syn-0.30.1` dirs.
# We need to patch EVERY copy that exists, plus prime any that doesn't
# yet, otherwise cargo picks the unpatched one and the IDL build dies at
# the #319 source_file() call.
mapfile -t ANCHOR_SYN_DIRS < <(find "$REG_PATH" -maxdepth 2 -name "anchor-syn-0.30.1" -type d 2>/dev/null)
echo "step 1 — find in registry/src: ${#ANCHOR_SYN_DIRS[@]} dir(s)"
for d in "${ANCHOR_SYN_DIRS[@]}"; do echo "  - $d"; done

# Modern `Swatinem/rust-cache@v2` (≥ 2.7) strips `~/.cargo/registry/src/`
# from the saved cache to halve its size — cargo is expected to re-extract
# from `registry/cache/*.crate` on demand. Our caller workflow
# (`anchor build --no-idl` then this script) doesn't enable the
# `idl-build` feature that pulls anchor-syn into the dep graph, so cargo
# never extracts it for us. Recover by reading the .crate from cache.
if [[ ${#ANCHOR_SYN_DIRS[@]} -eq 0 ]]; then
  CRATE_FILE=$(find "$CACHE_PATH" -maxdepth 2 -name "anchor-syn-0.30.1.crate" 2>/dev/null | head -1)
  echo "step 2 — find .crate in registry/cache: '${CRATE_FILE:-<none>}'"
  if [[ -n "$CRATE_FILE" ]]; then
    INDEX_HOST=$(basename "$(dirname "$CRATE_FILE")")
    DEST_DIR="${REG_PATH}/${INDEX_HOST}"
    mkdir -p "$DEST_DIR"
    echo "    extracting $CRATE_FILE → $DEST_DIR"
    tar -xzf "$CRATE_FILE" -C "$DEST_DIR"
    ANCHOR_SYN_DIRS+=("${DEST_DIR}/anchor-syn-0.30.1")
  fi
fi

# Belt-and-suspenders: if cache is also empty (a fresh runner where
# `anchor build --no-idl` didn't even download anchor-syn), grab the
# .crate straight from crates.io. Static URL is the official CDN
# endpoint cargo itself uses.
NEEDS_CHECKSUM_GEN=0
TMP_CRATE=""
if [[ ${#ANCHOR_SYN_DIRS[@]} -eq 0 ]]; then
  echo "step 3 — downloading anchor-syn-0.30.1 from static.crates.io"
  TMP_CRATE=$(mktemp /tmp/anchor-syn-XXXXXX.crate)
  if ! curl -sSL --fail -o "$TMP_CRATE" \
        https://static.crates.io/crates/anchor-syn/anchor-syn-0.30.1.crate; then
    echo "    direct fetch failed" >&2
    rm -f "$TMP_CRATE"
    TMP_CRATE=""
  else
    EXISTING_HOST=$(find "$REG_PATH" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | head -1)
    if [[ -n "$EXISTING_HOST" ]]; then
      DEST_DIR="$EXISTING_HOST"
    else
      DEST_DIR="${REG_PATH}/index.crates.io-direct"
    fi
    mkdir -p "$DEST_DIR"
    echo "    extracting $TMP_CRATE → $DEST_DIR"
    tar -xzf "$TMP_CRATE" -C "$DEST_DIR"
    CACHE_HOST_DIR="${CACHE_PATH}/$(basename "$DEST_DIR")"
    mkdir -p "$CACHE_HOST_DIR"
    cp "$TMP_CRATE" "${CACHE_HOST_DIR}/anchor-syn-0.30.1.crate"
    ANCHOR_SYN_DIRS+=("${DEST_DIR}/anchor-syn-0.30.1")
    NEEDS_CHECKSUM_GEN=1
  fi
fi

if [[ ${#ANCHOR_SYN_DIRS[@]} -eq 0 ]]; then
  echo "::error::failed to materialize anchor-syn-0.30.1 (no registry/src, no cache .crate, no network)" >&2
  echo "::endgroup::"
  exit 1
fi

echo "resolved ${#ANCHOR_SYN_DIRS[@]} copy/copies of anchor-syn-0.30.1"
echo "::endgroup::"

# Patch each copy. Cargo's choice of which dir to use depends on the
# registry URL it derives at build time (sparse vs git index → different
# hash → different dir). Patching every existing copy means whichever
# cargo picks already has the fix.
for ANCHOR_SYN_DIR in "${ANCHOR_SYN_DIRS[@]}"; do
  echo "::group::patch ${ANCHOR_SYN_DIR}"
  DEFINED_RS="$ANCHOR_SYN_DIR/src/idl/defined.rs"
  if [[ ! -f "$DEFINED_RS" ]]; then
    echo "  defined.rs not present — skipping this dir"
    echo "::endgroup::"
    continue
  fi
  if grep -q "SANDBOX PATCH" "$DEFINED_RS"; then
    echo "  $DEFINED_RS already patched, nothing to do"
    echo "::endgroup::"
    continue
  fi
  python3 - "$DEFINED_RS" <<'PYEOF'
import sys, pathlib
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
  echo "::endgroup::"
done

# Generate .cargo-checksum.json only for dirs we created ourselves via
# direct download — cargo-extracted dirs typically already have one (or
# don't need one, as observed: the cargo-canonical dir on this runner
# also lacks the file and cargo accepts it). We only generate when the
# direct-download path fired AND the file isn't already present.
if [[ "${NEEDS_CHECKSUM_GEN:-0}" -eq 1 && -n "${TMP_CRATE:-}" ]]; then
  for ANCHOR_SYN_DIR in "${ANCHOR_SYN_DIRS[@]}"; do
    [[ -f "${ANCHOR_SYN_DIR}/.cargo-checksum.json" ]] && continue
    echo "→ generating .cargo-checksum.json for $ANCHOR_SYN_DIR"
    PACKAGE_SHA="f99daacb53b55cfd37ce14d6c9905929721137fd4c67bbab44a19802aecb622f"
    python3 - "$ANCHOR_SYN_DIR" "$PACKAGE_SHA" <<'PYEOF'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
pkg_sha = sys.argv[2]
files = {}
for p in root.rglob("*"):
    if not p.is_file():
        continue
    if p.name == ".cargo-checksum.json":
        continue
    rel = str(p.relative_to(root))
    files[rel] = hashlib.sha256(p.read_bytes()).hexdigest()
out = {"package": pkg_sha, "files": files}
(root / ".cargo-checksum.json").write_text(json.dumps(out))
print(f"wrote {len(files)} file checksums + package sha")
PYEOF
  done
fi

[[ -n "${TMP_CRATE:-}" ]] && rm -f "$TMP_CRATE"

echo "anchor-syn-0.30.1 patched in ${#ANCHOR_SYN_DIRS[@]} location(s). Run 'anchor idl build --program-name <name> -o target/idl/<name>.json' for each program."

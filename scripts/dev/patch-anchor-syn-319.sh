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

ANCHOR_SYN_DIR=$(find "$REG_PATH" -maxdepth 2 -name "anchor-syn-0.30.1" -type d 2>/dev/null | head -1)
echo "step 1 — find in registry/src: '${ANCHOR_SYN_DIR:-<none>}'"

# Modern `Swatinem/rust-cache@v2` (≥ 2.7) strips `~/.cargo/registry/src/`
# from the saved cache to halve its size — cargo is expected to re-extract
# from `registry/cache/*.crate` on demand. Our caller workflow
# (`anchor build --no-idl` then this script) doesn't enable the
# `idl-build` feature that pulls anchor-syn into the dep graph, so cargo
# never extracts it for us. Recover by reading the .crate from cache.
if [[ -z "$ANCHOR_SYN_DIR" ]]; then
  CRATE_FILE=$(find "$CACHE_PATH" -maxdepth 2 -name "anchor-syn-0.30.1.crate" 2>/dev/null | head -1)
  echo "step 2 — find .crate in registry/cache: '${CRATE_FILE:-<none>}'"
  if [[ -n "$CRATE_FILE" ]]; then
    INDEX_HOST=$(basename "$(dirname "$CRATE_FILE")")
    DEST_DIR="${REG_PATH}/${INDEX_HOST}"
    mkdir -p "$DEST_DIR"
    echo "    extracting $CRATE_FILE → $DEST_DIR"
    tar -xzf "$CRATE_FILE" -C "$DEST_DIR"
    ANCHOR_SYN_DIR="${DEST_DIR}/anchor-syn-0.30.1"
  fi
fi

# Belt-and-suspenders: if cache is also empty (a fresh runner where
# `anchor build --no-idl` didn't even download anchor-syn), grab the
# .crate straight from crates.io and place it as if cargo had. Static
# URL is the official CDN endpoint cargo itself uses.
NEEDS_CHECKSUM_GEN=0
if [[ -z "$ANCHOR_SYN_DIR" || ! -d "$ANCHOR_SYN_DIR" ]]; then
  echo "step 3 — downloading anchor-syn-0.30.1 from static.crates.io"
  TMP_CRATE=$(mktemp /tmp/anchor-syn-XXXXXX.crate)
  if ! curl -sSL --fail -o "$TMP_CRATE" \
        https://static.crates.io/crates/anchor-syn/anchor-syn-0.30.1.crate; then
    echo "    direct fetch failed" >&2
    rm -f "$TMP_CRATE"
  else
    # Place it into the FIRST index-host dir if one exists, else create
    # a deterministic dir name (cargo treats the dir name as opaque when
    # locating extracted sources — it consults the lockfile + checksum
    # to match a candidate, not the dir name itself).
    EXISTING_HOST=$(find "$REG_PATH" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | head -1)
    if [[ -n "$EXISTING_HOST" ]]; then
      DEST_DIR="$EXISTING_HOST"
    else
      DEST_DIR="${REG_PATH}/index.crates.io-direct"
    fi
    mkdir -p "$DEST_DIR"
    echo "    extracting $TMP_CRATE → $DEST_DIR"
    tar -xzf "$TMP_CRATE" -C "$DEST_DIR"
    # Also drop the .crate into registry/cache so subsequent invocations
    # (or cargo itself) find it without re-downloading.
    CACHE_HOST_DIR="${CACHE_PATH}/$(basename "$DEST_DIR")"
    mkdir -p "$CACHE_HOST_DIR"
    cp "$TMP_CRATE" "${CACHE_HOST_DIR}/anchor-syn-0.30.1.crate"
    rm -f "$TMP_CRATE"
    ANCHOR_SYN_DIR="${DEST_DIR}/anchor-syn-0.30.1"
    # When cargo extracts a .crate naturally it writes `.cargo-checksum.json`
    # alongside the source — a JSON map of each file's SHA256. Without
    # this file, cargo rejects the extracted directory as "not from a
    # registry" and re-fetches, blowing away our patch. The .crate doesn't
    # ship the checksum file, so we generate one ourselves below.
    NEEDS_CHECKSUM_GEN=1
  fi
fi

if [[ -z "$ANCHOR_SYN_DIR" || ! -d "$ANCHOR_SYN_DIR" ]]; then
  echo "::error::failed to materialize anchor-syn-0.30.1 (no registry/src, no cache .crate, no network)" >&2
  echo "::endgroup::"
  exit 1
fi

echo "resolved anchor-syn-0.30.1 at: $ANCHOR_SYN_DIR"
echo "::endgroup::"

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

# Generate .cargo-checksum.json if we materialized the source via direct
# download. Cargo expects every registry-extracted source dir to carry
# one, and refuses to use the dir otherwise — which would cause it to
# re-fetch the .crate and overwrite our patch. The file is a JSON map
# of relative-path → SHA256, plus a top-level `package` SHA matching
# the .crate file itself.
if [[ "${NEEDS_CHECKSUM_GEN:-0}" -eq 1 ]]; then
  echo "→ generating .cargo-checksum.json for $ANCHOR_SYN_DIR"
  PACKAGE_SHA="f99daacb53b55cfd37ce14d6c9905929721137fd4c67bbab44a19802aecb622f"
  python3 - "$ANCHOR_SYN_DIR" "$PACKAGE_SHA" <<'PYEOF'
import hashlib, json, os, pathlib, sys
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
fi

echo "anchor-syn-0.30.1 patched. Run 'anchor idl build --program-name <name> -o target/idl/<name>.json' for each program."

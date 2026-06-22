#!/usr/bin/env bash
# Reproducible Docker build for all 4 RoundFi Anchor programs via
# solana-verify. Produces hash-stable .so files under target/deploy/
# that can be matched against deployed bytecode on devnet.
#
# Usage:
#   pnpm devnet:verify-build              # all 4 programs
#   pnpm devnet:verify-build roundfi_core # single program
#
# Time: ~10-15 min per program (Docker pull + cargo build inside
# solanafoundation/solana-verifiable-build:VERSION). Total ~45-60 min
# the first time; later runs reuse Docker layer cache.
#
# Requirements:
#   - solana-verify   (cargo install solana-verify --locked)
#   - docker          (running daemon)

set -euo pipefail

PROGRAMS=(
  roundfi_core
  roundfi_reputation
  roundfi_yield_mock
  roundfi_yield_kamino
)

if [[ $# -gt 0 ]]; then
  PROGRAMS=("$@")
fi

if ! command -v solana-verify >/dev/null 2>&1; then
  echo "✗ solana-verify not found. Install with:"
  echo "    cargo install solana-verify --locked"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "✗ Docker daemon not reachable. Start Docker Desktop / dockerd first."
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# The reproducible-build image is pinned in Cargo.toml's
# [workspace.metadata.cli] solana key (single source of truth). solana-verify
# reads that key to PICK the image — BUT a CLI older than the image's publish
# date doesn't carry the new tag in its built-in known-image list and bails
# with "No compatible Docker image found for Solana version X.Y.Z". So we also
# derive the tag here and pass it via --base-image (the exact flag that error
# recommends), making the build work on any solana-verify >= 0.4.14 (the
# release that added metadata.cli parsing) no matter how new the pinned image.
SOLANA_VER="$(sed -n '/^\[workspace\.metadata\.cli\]/,/^\[/ s/^solana[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' Cargo.toml)"
if [[ -z "$SOLANA_VER" ]]; then
  echo "✗ Could not read [workspace.metadata.cli] solana = \"x.y.z\" from Cargo.toml"
  echo "  That pin selects the reproducible-build toolchain; see docs/verified-build.md."
  exit 1
fi
BASE_IMAGE="solanafoundation/solana-verifiable-build:${SOLANA_VER}"

echo "▶ Building ${#PROGRAMS[@]} program(s) reproducibly via solana-verify…"
echo "  base image: $BASE_IMAGE  (pinned in Cargo.toml [workspace.metadata.cli])"
echo ""

for prog in "${PROGRAMS[@]}"; do
  echo "─── $prog ─────────────────────────────────────────"
  solana-verify build --library-name "$prog" --base-image "$BASE_IMAGE"
  hash=$(solana-verify get-executable-hash "target/deploy/${prog}.so")
  echo "  local hash: $hash"
  echo ""
done

echo "✓ Build complete. Next: pnpm devnet:verify-check"

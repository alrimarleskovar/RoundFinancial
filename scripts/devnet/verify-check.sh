#!/usr/bin/env bash
# Compare local reproducible-build hashes against the on-chain bytecode
# hashes for all 4 deployed RoundFi programs. Tells you whether a
# redeploy is needed before running `verify-from-repo`.
#
# Usage:
#   pnpm devnet:verify-check
#
# Exit codes:
#   0  → all hashes match (ready for verify-from-repo)
#   1  → at least one hash mismatch (redeploy needed)
#   2  → tooling missing or build artifacts not found
#
# Requirements:
#   - scripts/devnet/verify-build.sh ran successfully first
#   - solana-verify on PATH
#   - internet access to https://api.devnet.solana.com

set -euo pipefail

declare -A PROGRAMS=(
  [roundfi_core]=8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw
  [roundfi_reputation]=Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2
  [roundfi_yield_mock]=GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ
  [roundfi_yield_kamino]=74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb
)

if ! command -v solana-verify >/dev/null 2>&1; then
  echo "✗ solana-verify not found. Install with:"
  echo "    cargo install solana-verify --locked"
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

RPC_URL="${ANCHOR_PROVIDER_URL:-https://api.devnet.solana.com}"
mismatches=0

for prog in "${!PROGRAMS[@]}"; do
  pid="${PROGRAMS[$prog]}"
  so_path="target/deploy/${prog}.so"

  echo "─── $prog ($pid) ────────────────────────────────"

  if [[ ! -f "$so_path" ]]; then
    echo "  ✗ $so_path not found — run scripts/devnet/verify-build.sh first"
    exit 2
  fi

  local_hash=$(solana-verify get-executable-hash "$so_path")
  echo "  local:    $local_hash"

  # `get-program-hash` reads the on-chain executable account
  if ! onchain_hash=$(solana-verify -u "$RPC_URL" get-program-hash "$pid" 2>/dev/null); then
    echo "  ✗ failed to fetch on-chain hash (RPC unreachable or program missing)"
    mismatches=$((mismatches + 1))
    continue
  fi
  echo "  on-chain: $onchain_hash"

  if [[ "$local_hash" == "$onchain_hash" ]]; then
    echo "  ✓ MATCH — ready for verify-from-repo"
  else
    echo "  ✗ MISMATCH — redeploy needed (target/deploy/${prog}.so vs deployed bytecode)"
    mismatches=$((mismatches + 1))
  fi
  echo ""
done

if [[ $mismatches -eq 0 ]]; then
  echo "✓ All 4 hashes match. Next: pnpm devnet:verify-onchain"
  exit 0
fi

echo "✗ $mismatches/${#PROGRAMS[@]} mismatch(es). To fix: redeploy with the verified build:"
echo "    solana program deploy --url $RPC_URL \\"
echo "      --program-id <upgrade-authority-keypair-of-prog> \\"
echo "      target/deploy/<prog>.so"
echo ""
echo "Then re-run: pnpm devnet:verify-check"
exit 1

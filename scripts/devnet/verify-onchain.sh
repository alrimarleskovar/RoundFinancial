#!/usr/bin/env bash
# Upload Verified Build attestation to OtterSec's PDA on Solana for all
# 4 deployed RoundFi programs. After this runs successfully, Solscan
# picks up the PDA and shows a "Verified Build" badge on each program
# account page within ~10 minutes.
#
# Usage:
#   pnpm devnet:verify-onchain
#
# Requirements:
#   - scripts/devnet/verify-check.sh exited 0 (all hashes match)
#   - Solana wallet at ~/.config/solana/id.json with ~0.05 SOL on devnet
#   - solana-verify on PATH
#
# Cost: ~0.01 SOL per program → ~0.04 SOL total. Devnet SOL is free
# via https://faucet.solana.com.

set -euo pipefail

declare -A PROGRAMS=(
  [roundfi_core]=8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw
  [roundfi_reputation]=Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2
  [roundfi_yield_mock]=GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ
  [roundfi_yield_kamino]=74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb
)

REPO_URL="https://github.com/alrimarleskovar/RoundFinancial"
RPC_URL="${ANCHOR_PROVIDER_URL:-https://api.devnet.solana.com}"

if ! command -v solana-verify >/dev/null 2>&1; then
  echo "✗ solana-verify not found"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Pin the commit hash so the attestation references an exact code state
COMMIT_HASH="$(git rev-parse HEAD)"
echo "▶ Verifying commit $COMMIT_HASH against $REPO_URL"
echo "▶ RPC: $RPC_URL"
echo ""

for prog in "${!PROGRAMS[@]}"; do
  pid="${PROGRAMS[$prog]}"
  echo "─── $prog ($pid) ────────────────────────────────"
  solana-verify -u "$RPC_URL" verify-from-repo \
    --program-id "$pid" \
    --library-name "$prog" \
    --commit-hash "$COMMIT_HASH" \
    --skip-prompt \
    "$REPO_URL"
  echo ""
done

echo "✓ All 4 attestation PDAs uploaded."
echo ""
echo "Next steps:"
echo "  1. Wait ~10 min for Solscan to ingest the PDAs"
echo "  2. Open each program on Solscan and confirm the 'Verified Build' badge:"
for prog in "${!PROGRAMS[@]}"; do
  pid="${PROGRAMS[$prog]}"
  echo "     - $prog: https://solscan.io/account/$pid?cluster=devnet"
done

#!/usr/bin/env bash
# Redeploy all 4 RoundFi programs on devnet using the reproducible
# .so files produced by `solana-verify build`. Required after
# verify-check.sh reports hash mismatches (~95% of the time on
# projects originally deployed with non-reproducible `anchor build`).
#
# Usage:
#   pnpm devnet:verify-redeploy            # all 4 programs
#   pnpm devnet:verify-redeploy roundfi_core  # single program
#
# Requirements:
#   - solana CLI on PATH (sh -c "$(curl -sSfL https://release.solana.com/stable/install)")
#   - ~/.config/solana/id.json must be the upgrade authority for each program
#   - ~8 SOL on devnet (free via `solana airdrop 5 --url devnet` or faucet.solana.com)
#   - target/deploy/<prog>.so must exist (run pnpm devnet:verify-build first)
#
# Cost: ~0.5-2 SOL per program (free on devnet). Each call takes ~1-3 min
# depending on RPC throughput. Re-running on a successful program is a
# no-op upload (Solana detects identical bytecode and skips).

set -euo pipefail

declare -A PROGRAMS=(
  [roundfi_core]=8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw
  [roundfi_reputation]=Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2
  [roundfi_yield_mock]=GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ
  [roundfi_yield_kamino]=74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb
)

if [[ $# -gt 0 ]]; then
  declare -A SUBSET=()
  for prog in "$@"; do
    if [[ -z "${PROGRAMS[$prog]:-}" ]]; then
      echo "✗ Unknown program: $prog"
      echo "  Valid: ${!PROGRAMS[*]}"
      exit 1
    fi
    SUBSET[$prog]="${PROGRAMS[$prog]}"
  done
  PROGRAMS=()
  for k in "${!SUBSET[@]}"; do PROGRAMS[$k]="${SUBSET[$k]}"; done
fi

if ! command -v solana >/dev/null 2>&1; then
  echo "✗ solana CLI not found. Install with:"
  echo "    sh -c \"\$(curl -sSfL https://release.solana.com/stable/install)\""
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

RPC_URL="${ANCHOR_PROVIDER_URL:-https://api.devnet.solana.com}"
WALLET="${SOLANA_WALLET:-$HOME/.config/solana/id.json}"

if [[ ! -f "$WALLET" ]]; then
  echo "✗ Wallet not found at $WALLET"
  echo "  Set SOLANA_WALLET=/path/to/keypair.json or run: solana-keygen new"
  exit 1
fi

echo "▶ Redeploying ${#PROGRAMS[@]} program(s) to $RPC_URL"
echo "▶ Wallet:  $WALLET"
balance=$(solana balance --url "$RPC_URL" --keypair "$WALLET" 2>/dev/null || echo "?")
echo "▶ Balance: $balance"
echo ""

failures=()

for prog in "${!PROGRAMS[@]}"; do
  pid="${PROGRAMS[$prog]}"
  so_path="target/deploy/${prog}.so"

  echo "─── $prog ($pid) ────────────────────────────────"

  if [[ ! -f "$so_path" ]]; then
    echo "  ✗ $so_path not found — run pnpm devnet:verify-build first"
    failures+=("$prog (missing .so)")
    continue
  fi

  if solana program deploy \
      --url "$RPC_URL" \
      --keypair "$WALLET" \
      --program-id "$pid" \
      "$so_path"; then
    echo "  ✓ $prog redeployed"
  else
    echo "  ✗ $prog deploy failed (insufficient SOL? authority mismatch? RPC?)"
    failures+=("$prog")
  fi
  echo ""
done

if [[ ${#failures[@]} -eq 0 ]]; then
  echo "✓ All ${#PROGRAMS[@]} program(s) redeployed."
  echo "  Next: pnpm devnet:verify-check  (should now exit 0)"
  exit 0
fi

echo "✗ ${#failures[@]} failure(s):"
for f in "${failures[@]}"; do echo "    - $f"; done
echo ""
echo "Re-run on the failing program(s) only, e.g.:"
echo "    pnpm devnet:verify-redeploy ${failures[0]%% *}"
exit 1

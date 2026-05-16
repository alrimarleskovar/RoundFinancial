#!/usr/bin/env bash
# scripts/test-fresh.sh — fresh local validator + program deployment for spec batch runs.
#
# Use case: when running localnet-bound specs back-to-back (the half of the suite
# that didn't migrate to bankrun via Item L/M), each spec creates deterministic
# accounts seeded by spec id. Re-running the same spec twice — or running specs
# that share fixtures — hits "account already exists" and similar pollution
# errors. The fix is to wipe the validator between batches; this script
# automates that.
#
# Bankrun specs are unaffected (in-memory state, fresh per `setupBankrunEnv*`
# call). Use this only for localnet specs.
#
# Usage:
#   bash scripts/test-fresh.sh                       # full reset: kill → start fresh → build → deploy
#   bash scripts/test-fresh.sh --no-deploy           # only reset the validator, skip build/deploy
#   bash scripts/test-fresh.sh --with-mpl-core       # also clone mpl_core from mainnet (slow first-time, ~5s)
#   bash scripts/test-fresh.sh --help
#
# Exit codes:
#   0  — fresh validator ready, programs deployed, IDLs present
#   1  — pre-flight failed (missing solana / anchor / cargo-build-sbf)
#   2  — validator failed to start
#   3  — deploy failed
#
# After this script returns 0, run specs via:
#   pnpm exec mocha 'tests/<spec_glob>.spec.ts' --exit

set -euo pipefail

# ─── Constants ────────────────────────────────────────────────────────

MPL_CORE_ID="CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
VALIDATOR_RPC_PORT=8899
VALIDATOR_LOG="${TMPDIR:-/tmp}/solana-test-validator-fresh.log"
VALIDATOR_PID_FILE="${TMPDIR:-/tmp}/solana-test-validator-fresh.pid"
LEDGER_DIR="${PWD}/test-ledger"
RPC_READY_TIMEOUT_SECS=30

# Programs we deploy — must match Anchor.toml [programs.localnet]
PROGRAMS=(
  "roundfi_core"
  "roundfi_reputation"
  "roundfi_yield_mock"
  "roundfi_yield_kamino"
)

# ─── Flags ────────────────────────────────────────────────────────────

DEPLOY=1
CLONE_MPL_CORE=0
SHOW_HELP=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-deploy) DEPLOY=0; shift ;;
    --with-mpl-core) CLONE_MPL_CORE=1; shift ;;
    -h|--help) SHOW_HELP=1; shift ;;
    *) echo "Unknown flag: $1 (try --help)" >&2; exit 1 ;;
  esac
done

if [[ "$SHOW_HELP" == 1 ]]; then
  # Print the docstring at the top of this file and exit.
  sed -n '/^# scripts\/test-fresh.sh/,/^set -euo pipefail/p' "$0" | sed -n '/^#/p' | sed 's/^# \?//'
  exit 0
fi

# ─── Pre-flight ───────────────────────────────────────────────────────

# Solana CLI: try PATH first, then /opt/solana/bin (Agave install location used
# in some sandboxes). Bake into PATH so `solana-test-validator` + `anchor build`
# both find cargo-build-sbf.
if ! command -v solana >/dev/null 2>&1; then
  if [[ -x /opt/solana/bin/solana ]]; then
    export PATH="/opt/solana/bin:$PATH"
  else
    echo "✗ solana CLI not found on PATH or /opt/solana/bin. Install via https://anza.xyz/agave/install" >&2
    exit 1
  fi
fi

for tool in solana solana-test-validator anchor; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "✗ $tool not on PATH after sourcing /opt/solana/bin" >&2
    exit 1
  fi
done

if [[ "$DEPLOY" == 1 ]] && ! command -v cargo-build-sbf >/dev/null 2>&1; then
  echo "✗ cargo-build-sbf not on PATH (required for anchor build). Pass --no-deploy to skip build." >&2
  exit 1
fi

# ─── Kill any running validator ───────────────────────────────────────

echo "→ killing any running solana-test-validator..."
pkill -f solana-test-validator 2>/dev/null || true
# Wait for RPC port to free (max 5s — pkill is usually instant).
for _ in $(seq 1 10); do
  if ! lsof -ti:"$VALIDATOR_RPC_PORT" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
if lsof -ti:"$VALIDATOR_RPC_PORT" >/dev/null 2>&1; then
  echo "✗ port $VALIDATOR_RPC_PORT still bound after 5s — manually kill the holding process" >&2
  lsof -i:"$VALIDATOR_RPC_PORT" >&2 || true
  exit 2
fi

# Wipe the ledger dir. `solana-test-validator --reset` does this too, but
# explicit wipe is faster (no consistency check) and surfaces permissions
# errors loudly.
if [[ -d "$LEDGER_DIR" ]]; then
  echo "→ wiping ledger: $LEDGER_DIR"
  rm -rf "$LEDGER_DIR"
fi

# ─── Start fresh validator ────────────────────────────────────────────

VALIDATOR_ARGS=(--reset --quiet --ledger "$LEDGER_DIR" --rpc-port "$VALIDATOR_RPC_PORT")
if [[ "$CLONE_MPL_CORE" == 1 ]]; then
  echo "→ will clone $MPL_CORE_ID from mainnet (requires network)"
  VALIDATOR_ARGS+=(--clone-upgradeable-program "$MPL_CORE_ID" --url mainnet-beta)
fi

echo "→ starting solana-test-validator (log: $VALIDATOR_LOG)..."
nohup solana-test-validator "${VALIDATOR_ARGS[@]}" > "$VALIDATOR_LOG" 2>&1 &
echo $! > "$VALIDATOR_PID_FILE"
VALIDATOR_PID=$(cat "$VALIDATOR_PID_FILE")
echo "  pid=$VALIDATOR_PID"

# Wait for RPC ready: poll `solana cluster-version` until success or timeout.
echo "→ waiting for RPC ready (max ${RPC_READY_TIMEOUT_SECS}s)..."
RPC_URL="http://127.0.0.1:$VALIDATOR_RPC_PORT"
for i in $(seq 1 "$RPC_READY_TIMEOUT_SECS"); do
  if solana cluster-version --url "$RPC_URL" >/dev/null 2>&1; then
    echo "  ready after ${i}s"
    break
  fi
  # Detect early death — validator may exit on a port conflict or missing toolchain.
  if ! kill -0 "$VALIDATOR_PID" 2>/dev/null; then
    echo "✗ validator died during startup. Tail of $VALIDATOR_LOG:" >&2
    tail -20 "$VALIDATOR_LOG" >&2 || true
    exit 2
  fi
  sleep 1
done

if ! solana cluster-version --url "$RPC_URL" >/dev/null 2>&1; then
  echo "✗ validator failed to become ready in ${RPC_READY_TIMEOUT_SECS}s. Tail of log:" >&2
  tail -20 "$VALIDATOR_LOG" >&2 || true
  exit 2
fi

# ─── Build + deploy ──────────────────────────────────────────────────

if [[ "$DEPLOY" == 0 ]]; then
  echo ""
  echo "✓ validator ready at $RPC_URL (pid $VALIDATOR_PID). Skipping deploy (--no-deploy)."
  echo "  Run specs via: pnpm exec mocha 'tests/<glob>.spec.ts' --exit"
  exit 0
fi

# `anchor build --no-idl` skips the IDL generation step (which is broken by
# spike #319 on Anchor 0.30.1). The .so files are what `anchor deploy` needs;
# IDLs are a separate concern handled by scripts/dev/rebuild-idls.sh.
echo "→ anchor build --no-idl..."
if ! anchor build --no-idl >/dev/null 2>&1; then
  # Re-run with visible output so we surface the actual error.
  echo "✗ anchor build failed — re-running with output:" >&2
  anchor build --no-idl >&2
  exit 3
fi

echo "→ anchor deploy --provider.cluster localnet..."
# `anchor deploy` uses the workspace's wallet for the upgrade authority. The
# program IDs in Anchor.toml [programs.localnet] must match declare_id! (the
# cb4ac6f commit on PR #360 fixed the previous 11111... placeholder drift).
if ! anchor deploy --provider.cluster localnet >/dev/null 2>&1; then
  echo "✗ anchor deploy failed — re-running with output:" >&2
  anchor deploy --provider.cluster localnet >&2
  exit 3
fi

# ─── Summary ─────────────────────────────────────────────────────────

echo ""
echo "✓ fresh local validator + programs ready"
echo "  rpc:    $RPC_URL"
echo "  pid:    $VALIDATOR_PID"
echo "  log:    $VALIDATOR_LOG"
echo "  ledger: $LEDGER_DIR"
echo ""
echo "  Deployed programs:"
for prog in "${PROGRAMS[@]}"; do
  if [[ -f "target/deploy/${prog}-keypair.json" ]]; then
    pubkey=$(solana-keygen pubkey "target/deploy/${prog}-keypair.json" 2>/dev/null || echo "<missing>")
    echo "    $prog: $pubkey"
  fi
done
echo ""
echo "  Next: pnpm exec mocha 'tests/<spec_glob>.spec.ts' --exit"
echo "  Stop the validator with: kill \$(cat $VALIDATOR_PID_FILE)"

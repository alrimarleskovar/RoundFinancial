#!/usr/bin/env bash
# SessionStart hook for Claude Code on the web.
#
# Installs the pnpm workspace's JS dependencies so a fresh web session can
# immediately run lint / typecheck / JS tests — preventing the
# "stale node_modules" class (e.g. a held-back major like the Next 15→16
# bump in #486 that errors on `next dev --webpack` until you reinstall)
# from biting mid-session.
#
# Scope: JS only. The Solana / Anchor toolchain (cargo-build-sbf, anchor)
# is NOT provisioned in web sandboxes, so program builds + the
# bankrun/litesvm test lanes stay on CI and local WSL. This hook
# deliberately does not try to install them.
#
# Mode: synchronous — the session waits for install to finish (a few
# seconds on a warm pnpm store). Flip to async (see the session-start-hook
# skill) if you prefer faster startup at the cost of a brief race window.
set -euo pipefail

# Web-only: no-op on local / CLI sessions, where devs manage their own
# installs and the Solana toolchain is present.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
echo "[session-start] pnpm install (workspace JS deps)…"
pnpm install
echo "[session-start] done — JS deps ready (lint / typecheck / JS tests)."

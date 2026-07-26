#!/usr/bin/env bash
# Drives the real app in a real browser, in demo mode.
#
#   ./test/run-tests.sh
#
# Needs Playwright available to node (npm i -g playwright, or set NODE_PATH).
# Set CHROME_PATH if Playwright can't find a browser on its own.
#
# flow.test.mjs   — the approval loop: mark done, undo, reject, redo, approve,
#                   pay out. Asserts that marking done alone never earns money.
# config.test.mjs — the parent editors: add/edit/re-price a chore, add a child,
#                   change currency, and the PIN lockout.

set -euo pipefail

PORT=${PORT:-8765}
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"

export BASE_URL="http://localhost:$PORT"
export SHOT_DIR="${SHOT_DIR:-$ROOT/.test-screenshots}"

# Playwright is usually installed globally; make it importable either way.
if [ -z "${NODE_PATH:-}" ] && [ -d /opt/node22/lib/node_modules ]; then
  export NODE_PATH=/opt/node22/lib/node_modules
fi

echo "==> serving $ROOT on port $PORT"
python3 -m http.server "$PORT" --directory "$ROOT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT

# Wait for the server rather than sleeping a fixed amount.
for _ in $(seq 1 40); do
  if curl -fsS "$BASE_URL/index.html" >/dev/null 2>&1; then break; fi
  sleep 0.25
done

echo "==> approval flow"
node "$HERE/flow.test.mjs"

echo
echo "==> configuration"
node "$HERE/config.test.mjs"

echo
echo "==> screenshots in $SHOT_DIR"

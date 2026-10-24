#!/usr/bin/env bash
# Local dev/test runner. Installs dependencies and bootstraps .env if
# missing, frees the configured port if something's already running on it,
# then starts the server with auto-reload on file changes.
#
# Usage: ./scripts/dev.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example - add your OpenWeatherMap API key there, or set it later from /admin."
fi

PORT="$(sed -nE 's/^PORT=([0-9]+).*/\1/p' .env | head -n1)"
PORT="${PORT:-3000}"

# `npm run dev` runs under `node --watch`, which supervises its own child
# process - killing just whatever's holding the port leaves that supervisor
# orphaned (it won't rebind: node --watch restarts on a file change, not on
# an external kill). Match on the shared script path instead, which catches
# the sh -c wrapper, the --watch supervisor, and the actual child together.
if pgrep -f "src/server/server\.js" >/dev/null 2>&1; then
  echo "An existing NimbusGlass dev server is running - stopping it."
  pkill -f "src/server/server\.js" 2>/dev/null || true
  sleep 1
fi

echo "Mirror display: http://localhost:$PORT"
echo "Admin console:  http://localhost:$PORT/admin"
echo "(Ctrl-C to stop. Restarts automatically when files under src/ change.)"
exec npm run dev

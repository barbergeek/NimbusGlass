#!/usr/bin/env bash
# Launches Chromium in kiosk mode against the local NimbusGlass server.
# Waits briefly for the Node server's systemd unit to come up first.
# Works under both the X11/Openbox and labwc/Wayland autostart paths -
# it picks up --ozone-platform=wayland automatically when run under one.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="3000"
if [ -f "$REPO_DIR/.env" ]; then
  env_port="$(sed -nE 's/^PORT=([0-9]+).*/\1/p' "$REPO_DIR/.env" | head -n1)"
  [ -n "$env_port" ] && PORT="$env_port"
fi
URL="http://localhost:$PORT"

for _ in $(seq 1 30); do
  curl -fs "$URL" > /dev/null 2>&1 && break
  sleep 1
done

# Raspberry Pi OS Bookworm (Debian 12-based) packages the browser as
# "chromium" (/usr/bin/chromium); older Debian/Ubuntu-based images used
# "chromium-browser". Support both rather than hardcoding one.
BROWSER_BIN="$(command -v chromium || command -v chromium-browser || true)"
[ -n "$BROWSER_BIN" ] || { echo "kiosk-start.sh: no chromium or chromium-browser binary found; run scripts/install.sh" >&2; exit 1; }

EXTRA_FLAGS=()
[ -n "${WAYLAND_DISPLAY:-}" ] && EXTRA_FLAGS+=(--ozone-platform=wayland)

exec "$BROWSER_BIN" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000 \
  "${EXTRA_FLAGS[@]}" \
  --app="$URL"

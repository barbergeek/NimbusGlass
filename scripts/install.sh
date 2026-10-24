#!/usr/bin/env bash
#
# NimbusGlass installer: takes a fresh Raspberry Pi OS Lite install (Pi 3,
# 4, or 5; Bullseye through Trixie) to a running, boots-into-kiosk
# NimbusGlass mirror. Safe to re-run - every step is idempotent.
#
# Usage: ./scripts/install.sh [options]
#   -y, --yes             Don't prompt for confirmation
#       --skip-upgrade     Skip `apt full-upgrade`
#       --skip-kiosk       Install the server only, no browser/kiosk autostart
#       --no-reboot        Don't offer to reboot at the end
#       --display-stack=x11|wayland   Override the auto-detected kiosk stack
#       --rotate=1|2|3     Rotate HDMI output 90/180/270 degrees
#   -h, --help             Show this help

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ASSUME_YES=false
SKIP_UPGRADE=false
SKIP_KIOSK=false
NO_REBOOT=false
DISPLAY_STACK_OVERRIDE=""
ROTATE=""

log()   { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()   { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

usage() { sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) ASSUME_YES=true ;;
    --skip-upgrade) SKIP_UPGRADE=true ;;
    --skip-kiosk) SKIP_KIOSK=true ;;
    --no-reboot) NO_REBOOT=true ;;
    --display-stack=*) DISPLAY_STACK_OVERRIDE="${1#*=}" ;;
    --rotate=*) ROTATE="${1#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (--help for usage)" ;;
  esac
  shift
done

confirm() {
  $ASSUME_YES && return 0
  read -r -p "$1 [y/N] " reply
  [ "$reply" = "y" ] || [ "$reply" = "Y" ]
}

# --- sanity checks -----------------------------------------------------

[ "$EUID" -ne 0 ] || die "Run this as your normal user (not root/sudo) - it calls sudo itself where needed."
command -v apt-get >/dev/null 2>&1 || die "This installer targets Raspberry Pi OS / Debian-based systems (no apt-get found)."
[ -f /etc/os-release ] || die "Can't find /etc/os-release - unsupported OS."
sudo -v || die "Need sudo access to install packages and system services."

# --- detect hardware and OS --------------------------------------------

PI_MODEL="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo "unknown")"
case "$PI_MODEL" in
  *"Raspberry Pi 5"*) PI_GEN=5 ;;
  *"Raspberry Pi 4"*) PI_GEN=4 ;;
  *"Raspberry Pi 3"*) PI_GEN=3 ;;
  *"Raspberry Pi 2"*) PI_GEN=2 ;;
  *"Raspberry Pi Zero 2"*) PI_GEN=2 ;;
  *"Raspberry Pi"*) PI_GEN=other ;;
  *) PI_GEN=unknown ;;
esac

# shellcheck disable=SC1091
. /etc/os-release
OS_CODENAME="${VERSION_CODENAME:-unknown}"
ARCH="$(uname -m)"

log "Detected: ${PI_MODEL:-unknown board} | $PRETTY_NAME ($OS_CODENAME) | $ARCH"

if [ "$PI_GEN" = "unknown" ]; then
  warn "Couldn't identify a Raspberry Pi model from /proc/device-tree/model - continuing anyway."
fi

# --- pick a kiosk display stack -----------------------------------------
#
# Pi 3/2 and anything on Bullseye or older: X11 + Openbox. It's the
# lighter, more reliably-driver-supported path on older boards and older
# OS releases that predate labwc.
#
# Pi 4/5 on Bookworm or newer: labwc (Wayland), matching the OS's own
# default compositor and driver stack, which is where KMS/GL driver work
# upstream actually lands on current Pi OS.

if [ -n "$DISPLAY_STACK_OVERRIDE" ]; then
  DISPLAY_STACK="$DISPLAY_STACK_OVERRIDE"
elif [ "$PI_GEN" = "2" ] || [ "$PI_GEN" = "3" ]; then
  DISPLAY_STACK=x11
elif [ "$OS_CODENAME" = "bullseye" ] || [ "$OS_CODENAME" = "buster" ]; then
  DISPLAY_STACK=x11
else
  DISPLAY_STACK=wayland
fi

case "$DISPLAY_STACK" in
  x11|wayland) ;;
  *) die "--display-stack must be x11 or wayland" ;;
esac

if [ -n "$ROTATE" ]; then
  case "$ROTATE" in 1|2|3) ;; *) die "--rotate must be 1, 2, or 3" ;; esac
fi

log "Kiosk display stack: $DISPLAY_STACK"

confirm "Proceed with this configuration?" || die "Aborted."

# --- apt update / upgrade ------------------------------------------------

log "Updating package lists..."
sudo apt-get update -y

if ! $SKIP_UPGRADE; then
  log "Upgrading installed packages (--skip-upgrade to skip)..."
  sudo apt-get full-upgrade -y
fi

# --- Node.js ---------------------------------------------------------------

NODE_MAJOR_REQUIRED=18
need_node=true
if command -v node >/dev/null 2>&1; then
  current_major="$(node -v 2>/dev/null | sed -nE 's/^v([0-9]+).*/\1/p')"
  if [ -n "$current_major" ] && [ "$current_major" -ge "$NODE_MAJOR_REQUIRED" ]; then
    log "Node.js $(node -v) already satisfies >=${NODE_MAJOR_REQUIRED}, skipping install."
    need_node=false
  fi
fi

if $need_node; then
  log "Installing Node.js 20.x LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

NODE_BIN="$(command -v node)"
log "Using Node at $NODE_BIN ($(node -v))"

# --- browser + display stack packages --------------------------------------

# Bookworm+ packages the browser as "chromium"; Bullseye and older used
# "chromium-browser". Try the current name first, fall back to the old one.
if apt-cache show chromium >/dev/null 2>&1; then
  BROWSER_PKG=chromium
elif apt-cache show chromium-browser >/dev/null 2>&1; then
  BROWSER_PKG=chromium-browser
else
  die "No chromium or chromium-browser package found in apt. Check your apt sources."
fi

if ! $SKIP_KIOSK; then
  log "Installing $DISPLAY_STACK kiosk stack ($BROWSER_PKG)..."
  case "$DISPLAY_STACK" in
    x11)
      sudo apt-get install -y --no-install-recommends \
        xserver-xorg x11-xserver-utils xinit openbox \
        "$BROWSER_PKG" curl unclutter
      ;;
    wayland)
      sudo apt-get install -y --no-install-recommends \
        labwc seatd "$BROWSER_PKG" curl unclutter
      ;;
  esac
else
  log "--skip-kiosk set: installing the server only, no browser/display packages."
fi

# --- app dependencies --------------------------------------------------

log "Installing NimbusGlass npm dependencies..."
(cd "$REPO_DIR" && npm install --omit=dev)

# --- .env ----------------------------------------------------------------

ENV_FILE="$REPO_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$REPO_DIR/.env.example" "$ENV_FILE"
  log "Created .env from .env.example."
  if ! $ASSUME_YES; then
    read -r -p "OpenWeatherMap API key (leave blank to set later from /admin): " owm_key
    if [ -n "$owm_key" ]; then
      sed -i "s/^OPENWEATHER_API_KEY=.*/OPENWEATHER_API_KEY=$owm_key/" "$ENV_FILE"
    fi
  fi
else
  log ".env already exists, leaving it as-is."
fi

PORT="$(sed -nE 's/^PORT=([0-9]+).*/\1/p' "$ENV_FILE" | head -n1)"
PORT="${PORT:-3000}"

# --- systemd service -------------------------------------------------------

log "Installing systemd service (user: $USER, dir: $REPO_DIR)..."
sed \
  -e "s#__NIMBUSGLASS_USER__#$USER#g" \
  -e "s#__NIMBUSGLASS_DIR__#$REPO_DIR#g" \
  -e "s#__NODE_BIN__#$NODE_BIN#g" \
  "$REPO_DIR/deploy/nimbusglass.service" | sudo tee /etc/systemd/system/nimbusglass.service >/dev/null

sudo systemctl daemon-reload
sudo systemctl enable --now nimbusglass

log "Waiting for the server to come up..."
for _ in $(seq 1 30); do
  curl -fs "http://localhost:$PORT" >/dev/null 2>&1 && break
  sleep 1
done
if curl -fs "http://localhost:$PORT" >/dev/null 2>&1; then
  log "NimbusGlass server is up on port $PORT."
else
  warn "Server didn't respond after 30s - check: sudo systemctl status nimbusglass"
fi

# --- kiosk autostart -------------------------------------------------------
#
# Raspberry Pi OS Lite has no display manager - nothing launches a graphical
# session on its own, for either stack. Console autologin (enabled below)
# gets a shell on tty1; that shell has to launch the window manager itself,
# which is what this ~/.bash_profile block does in both cases.

append_tty1_trigger() {
  local marker="$1" check_var="$2" exec_cmd="$3"
  if ! grep -qF "$marker" "$HOME/.bash_profile" 2>/dev/null; then
    cat <<EOF >> "$HOME/.bash_profile"
$marker
if [ -z "\${$check_var:-}" ] && [ "\$(tty)" = "/dev/tty1" ]; then
  exec $exec_cmd
fi
EOF
    log "Added $exec_cmd autostart to ~/.bash_profile."
  else
    log "~/.bash_profile already has the NimbusGlass autostart block."
  fi
}

if ! $SKIP_KIOSK; then
  chmod +x "$REPO_DIR/scripts/kiosk-start.sh"

  case "$DISPLAY_STACK" in
    x11)
      mkdir -p "$HOME/.config/openbox"
      sed -e "s#__NIMBUSGLASS_DIR__#$REPO_DIR#g" \
        "$REPO_DIR/deploy/openbox-autostart" > "$HOME/.config/openbox/autostart"
      chmod +x "$HOME/.config/openbox/autostart"
      append_tty1_trigger '# NimbusGlass kiosk autostart' DISPLAY 'startx -- -nocursor'
      ;;
    wayland)
      mkdir -p "$HOME/.config/labwc"
      sed -e "s#__NIMBUSGLASS_DIR__#$REPO_DIR#g" \
        "$REPO_DIR/deploy/labwc-autostart" > "$HOME/.config/labwc/autostart"
      chmod +x "$HOME/.config/labwc/autostart"
      append_tty1_trigger '# NimbusGlass kiosk autostart' WAYLAND_DISPLAY 'labwc'
      ;;
  esac

  if command -v raspi-config >/dev/null 2>&1; then
    log "Enabling console autologin (raspi-config B2)..."
    sudo raspi-config nonint do_boot_behaviour B2
  else
    warn "raspi-config not found - enable console autologin manually (System Options > Boot > Console Autologin)."
  fi
fi

# --- optional HDMI rotation -------------------------------------------------

if [ -n "$ROTATE" ]; then
  if [ -f /boot/firmware/config.txt ]; then
    BOOT_CONFIG=/boot/firmware/config.txt
  elif [ -f /boot/config.txt ]; then
    BOOT_CONFIG=/boot/config.txt
  else
    die "Can't find boot config.txt to apply --rotate."
  fi
  if ! grep -q '^display_hdmi_rotate=' "$BOOT_CONFIG" 2>/dev/null; then
    echo "display_hdmi_rotate=$ROTATE" | sudo tee -a "$BOOT_CONFIG" >/dev/null
    log "Set display_hdmi_rotate=$ROTATE in $BOOT_CONFIG."
  else
    sudo sed -i "s/^display_hdmi_rotate=.*/display_hdmi_rotate=$ROTATE/" "$BOOT_CONFIG"
    log "Updated display_hdmi_rotate to $ROTATE in $BOOT_CONFIG."
  fi
  log "Remember to set \"orientation\": \"portrait\" from /admin if this is a rotated panel."
fi

# --- done --------------------------------------------------------------

log "Install complete."
echo "  Mirror display: http://localhost:$PORT"
echo "  Admin console:  http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT/admin"
if $SKIP_KIOSK; then
  echo "  (--skip-kiosk was set: no browser/autostart was configured.)"
fi

if ! $SKIP_KIOSK && ! $NO_REBOOT; then
  if confirm "Reboot now to launch the kiosk?"; then
    sudo reboot
  fi
fi

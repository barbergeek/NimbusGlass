# NimbusGlass: Raspberry Pi OS Lite → Kiosk Setup

Target: Raspberry Pi 3, 4, or 5, running Raspberry Pi OS Lite (headless,
64-bit recommended), any release from Bullseye through Trixie, fresh flash.

`scripts/install.sh` automates everything below: it detects your Pi model
and OS release, installs Node.js and the right kiosk display stack for that
combination, deploys the systemd service, and wires up the kiosk autostart.
The manual steps further down are what it does under the hood — useful for
understanding what's happening, adapting to a non-standard setup, or
troubleshooting if something doesn't come up.

## Which display stack gets used, and why

| Board            | OS release           | Stack           |
|-------------------|----------------------|------------------|
| Pi 3 / Pi 2        | any                   | X11 + Openbox    |
| Pi 4 / Pi 5         | Bullseye or older      | X11 + Openbox    |
| Pi 4 / Pi 5         | Bookworm or newer       | labwc (Wayland)  |

X11 + Openbox is the lighter, more reliably-supported path on older boards
and older OS releases that predate labwc. On a Pi 4/5 running Bookworm+,
labwc is the OS's own default compositor and where current GPU driver work
actually lands, so the kiosk uses that instead rather than fighting it.
Override with `--display-stack=x11` or `--display-stack=wayland` if you
want something other than the default for your board/OS combination.

Either way, the browser package name is detected automatically: Bookworm+
calls it `chromium`; Bullseye and older called it `chromium-browser`.
`scripts/kiosk-start.sh` (which both stacks' autostart calls into) resolves
whichever one is actually installed, and adds `--ozone-platform=wayland`
itself when it detects it's running under Wayland.

## 1. Flash and first boot

1. Flash **Raspberry Pi OS Lite (64-bit)** with Raspberry Pi Imager. In the
   imager's OS customization, set hostname (`nimbusglass`), enable SSH, and
   create a user. (Imager no longer defaults to a `pi` user — any username
   works, the installer detects it.)
2. Boot the Pi, then SSH in:
   ```bash
   ssh <your-user>@nimbusglass.local
   ```

## 2. Clone and run the installer

```bash
git clone https://github.com/barbergeek/NimbusGlass.git
cd NimbusGlass
./scripts/install.sh
```

It will print what it detected (board, OS, chosen display stack) and ask
for confirmation before touching anything. Useful flags:

- `-y` / `--yes` — don't prompt (for scripted/unattended installs)
- `--skip-upgrade` — skip `apt full-upgrade`
- `--skip-kiosk` — install and run the server only, no browser/autostart
  (e.g. if NimbusGlass is just the backend and the display runs elsewhere)
- `--display-stack=x11|wayland` — override the auto-detected stack
- `--rotate=1|2|3` — rotate HDMI output 90°/180°/270° for a portrait panel
- `--no-reboot` — don't offer to reboot at the end

Run `./scripts/install.sh --help` for the full list. It's idempotent - safe
to re-run after pulling updates or if a step failed partway.

When it finishes, it offers to reboot. On boot: console autologin → the
window manager's own autostart → `kiosk-start.sh` waits for the Node
server → Chromium opens full-screen against `http://localhost:3000`.

Confirm it's reachable from another machine on the same VLAN too:
`http://<pi-ip>:3000` (mirror) and `http://<pi-ip>:3000/admin` (console).

## Doing it by hand

Everything here is what `install.sh` automates. Useful if you want to
understand each step, you're adapting to a non-standard image, or
something didn't come up and you're debugging which step failed.

### Update the system

```bash
sudo apt update && sudo apt full-upgrade -y
```

### Auto-login on the console

Needed so the window manager can start without a login prompt:

```bash
sudo raspi-config
# System Options -> Boot / Auto Login -> Console Autologin
```

### Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # expect v20.x; anything >=18 is fine, skip this step if already satisfied
```

### Install the kiosk display stack

**X11 + Openbox** (Pi 2/3 on any OS, or Pi 4/5 on Bullseye-or-older):

```bash
sudo apt install -y --no-install-recommends \
  xserver-xorg x11-xserver-utils xinit openbox \
  chromium curl unclutter
```

**labwc / Wayland** (Pi 4/5 on Bookworm-or-newer):

```bash
sudo apt install -y --no-install-recommends labwc seatd chromium curl unclutter
```

For either: if `apt install chromium` 404s, your image is old enough that
the package is still named `chromium-browser` - substitute that instead.

`unclutter` hides the mouse cursor after inactivity - nice to have on a
mirror with no pointer interaction.

### Deploy NimbusGlass

```bash
cd ~
git clone https://github.com/barbergeek/NimbusGlass.git
cd NimbusGlass
npm install --omit=dev
cp .env.example .env
nano .env   # set OPENWEATHER_API_KEY (or add it later via the admin console)
```

### Run the server as a systemd service

`deploy/nimbusglass.service` is a template - fill in your user, the repo
path, and your `node` binary path before installing it:

```bash
sed \
  -e "s#__NIMBUSGLASS_USER__#$USER#g" \
  -e "s#__NIMBUSGLASS_DIR__#$PWD#g" \
  -e "s#__NODE_BIN__#$(command -v node)#g" \
  deploy/nimbusglass.service | sudo tee /etc/systemd/system/nimbusglass.service

sudo systemctl daemon-reload
sudo systemctl enable --now nimbusglass
sudo systemctl status nimbusglass   # should show "active (running)"
```

### Configure the kiosk autostart

Same idea: the autostart templates use `__NIMBUSGLASS_DIR__` for the repo
path. For X11/Openbox:

```bash
mkdir -p ~/.config/openbox
sed "s#__NIMBUSGLASS_DIR__#$PWD#g" deploy/openbox-autostart > ~/.config/openbox/autostart
chmod +x ~/.config/openbox/autostart scripts/kiosk-start.sh
```

Launch X automatically on console login by appending to `~/.bash_profile`:

```bash
cat <<'EOF' >> ~/.bash_profile
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
  exec startx -- -nocursor
fi
EOF
```

For labwc/Wayland:

```bash
mkdir -p ~/.config/labwc
sed "s#__NIMBUSGLASS_DIR__#$PWD#g" deploy/labwc-autostart > ~/.config/labwc/autostart
chmod +x ~/.config/labwc/autostart scripts/kiosk-start.sh
```

Raspberry Pi OS Lite has no display manager for either stack - console
autologin gets you a shell on tty1, and that shell has to launch the
compositor itself, the same way it launches X via `startx`. Append to
`~/.bash_profile`:

```bash
cat <<'EOF' >> ~/.bash_profile
if [ -z "$WAYLAND_DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
  exec labwc
fi
EOF
```

If `labwc` exits immediately with a seat/device permission error, your
user likely isn't in the group `seatd`'s Unix socket is restricted to.
Check `ls -l /run/seatd.sock` for the owning group, add your user to it
with `sudo usermod -aG <group> $USER`, then log out and back in.

### Reboot and verify

```bash
sudo reboot
```

## Rotating the display (portrait mirrors)

For a physically rotated panel, set the HDMI rotation in
`/boot/firmware/config.txt` (Bookworm+) or `/boot/config.txt` (Bullseye and
older):

```ini
display_hdmi_rotate=1   # 90°, use 3 for 270°
```

(`install.sh --rotate=1` does this for you.) Then set `"orientation":
"portrait"` from the admin console (or directly in `data/config.json`) so
the CSS grid switches to its single-column layout.

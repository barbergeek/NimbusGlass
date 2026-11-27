'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const configStore = require('./configStore');

/**
 * Rotates the physical display output (config.rotation: 0/90/180/270) by
 * driving the kiosk session's compositor: wlr-randr under labwc/Wayland,
 * xrandr under X11/Openbox. The server runs as the same user as the kiosk
 * session, so it can reach that session's Wayland socket / X display.
 *
 * Compositors don't persist this across restarts, so scripts/kiosk-start.sh
 * calls POST /api/display/rotation each time the session comes up, and a
 * config change re-applies it live.
 *
 * Under labwc it also rotates touch input to match (applyTouchCalibration).
 * On X11 touch isn't rotated.
 *
 * This is separate from config.orientation, which only switches the CSS
 * layout between landscape and portrait.
 */

const VALID_ROTATIONS = [0, 90, 180, 270];
const WLR_TRANSFORMS = { 0: 'normal', 90: '90', 180: '180', 270: '270' };
const XRANDR_ROTATIONS = { 0: 'normal', 90: 'left', 180: 'inverted', 270: 'right' };

// libinput touch calibration per rotation, so taps land where the rotated
// picture is - the compositor rotates the picture but not the touch panel's
// coordinates. 180 is verified on the 7" DSI touchscreen; the 90/270
// matrices follow libinput's documented clockwise/counter-clockwise forms
// but haven't been tested on a panel - if taps come out mirrored at 90 or
// 270, swap those two.
const TOUCH_MATRICES = {
  0: '1 0 0 0 1 0',
  90: '0 1 0 -1 0 1',
  180: '-1 0 1 0 -1 1',
  270: '0 -1 1 1 0 0',
};
const RC_MARKER = '<!-- Managed by NimbusGlass (src/server/rotation.js) - rewritten when the screen rotation changes. -->';

function labwcConfigDir() {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'labwc');
}

/**
 * Writes the touch calibration for `rotation` into labwc's rc.xml and tells
 * labwc to reload it. Only touches an rc.xml NimbusGlass created - one you've
 * written yourself is left alone (add the calibrationMatrix to it by hand).
 * Returns a short status for the admin page.
 */
async function applyTouchCalibration(rotation) {
  const file = path.join(labwcConfigDir(), 'rc.xml');
  let existing = null;
  try {
    existing = fs.readFileSync(file, 'utf8');
  } catch {
    // no rc.xml yet - we'll create it
  }
  if (existing !== null && !existing.includes(RC_MARKER)) {
    return 'touch not rotated: ~/.config/labwc/rc.xml is your own file';
  }
  const xml = `<?xml version="1.0"?>
${RC_MARKER}
<labwc_config>
  <libinput>
    <device category="touch">
      <calibrationMatrix>${TOUCH_MATRICES[rotation]}</calibrationMatrix>
    </device>
  </libinput>
</labwc_config>
`;
  if (existing === xml) return 'touch rotated';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, xml);
  // SIGHUP is labwc's "reconfigure" (what `labwc --reconfigure` sends).
  await run('pkill', ['-HUP', '-x', 'labwc'], {}).catch(() => {});
  return 'touch rotated';
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env: { ...process.env, ...env }, timeout: 10000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout);
    });
  });
}

function runtimeDir() {
  return process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
}

/** Find the kiosk session's display: { kind: 'wayland'|'x11', env } or null if no session is up. */
function findSession() {
  const dir = runtimeDir();
  let sockets = [];
  try {
    sockets = fs.readdirSync(dir).filter((name) => /^wayland-\d+$/.test(name)).sort();
  } catch {
    // no runtime dir - no Wayland session
  }
  if (sockets.length) {
    return { kind: 'wayland', env: { XDG_RUNTIME_DIR: dir, WAYLAND_DISPLAY: sockets[0] } };
  }
  if (fs.existsSync('/tmp/.X11-unix/X0')) {
    return {
      kind: 'x11',
      env: { DISPLAY: ':0', XAUTHORITY: process.env.XAUTHORITY || path.join(os.homedir(), '.Xauthority') },
    };
  }
  return null;
}

async function applyWayland(rotation, env) {
  const outputs = JSON.parse(await run('wlr-randr', ['--json'], env))
    .filter((output) => output.enabled)
    .map((output) => output.name);
  for (const name of outputs) {
    await run('wlr-randr', ['--output', name, '--transform', WLR_TRANSFORMS[rotation]], env);
  }
  return outputs;
}

async function applyX11(rotation, env) {
  const outputs = (await run('xrandr', ['--query'], env))
    .split('\n')
    .filter((line) => / connected/.test(line))
    .map((line) => line.split(' ')[0]);
  for (const name of outputs) {
    await run('xrandr', ['--output', name, '--rotate', XRANDR_ROTATIONS[rotation]], env);
  }
  return outputs;
}

class RotationController {
  constructor() {
    this.lastApplied = null;
    this.lastResult = { ok: null, message: 'Not applied yet' };
  }

  start() {
    configStore.onChange((config) => {
      if (normalize(config.rotation) !== this.lastApplied) this.apply();
    });
    this.apply(); // no-op if the kiosk session isn't up yet; kiosk-start.sh retries
  }

  status() {
    return { rotation: normalize(configStore.get().rotation), ...this.lastResult };
  }

  async apply() {
    const rotation = normalize(configStore.get().rotation);
    const session = findSession();
    if (!session) {
      this.lastResult = { ok: false, message: 'No display session running yet' };
      return this.status();
    }
    try {
      const outputs =
        session.kind === 'wayland' ? await applyWayland(rotation, session.env) : await applyX11(rotation, session.env);
      const touch = session.kind === 'wayland' ? `; ${await applyTouchCalibration(rotation)}` : '';
      this.lastApplied = rotation;
      this.lastResult = { ok: true, message: `Rotated ${outputs.join(', ') || 'no outputs'} to ${rotation}°${touch}` };
    } catch (err) {
      const hint = session.kind === 'wayland' ? ' (is wlr-randr installed?)' : '';
      this.lastResult = { ok: false, message: `Rotation failed: ${err.message}${hint}` };
    }
    console.log(`Rotation: ${this.lastResult.message}`);
    return this.status();
  }
}

function normalize(value) {
  const n = Number(value) || 0;
  return VALID_ROTATIONS.includes(n) ? n : 0;
}

module.exports = new RotationController();

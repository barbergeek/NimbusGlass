'use strict';

const fs = require('fs');
const path = require('path');
const configStore = require('./configStore');
const { targetBrightness } = require('../../public/js/dimSchedule');

/**
 * Hardware backlight dimming for panels that expose one under
 * /sys/class/backlight (e.g. the official Pi DSI touchscreen). Runs on the
 * server rather than in the kiosk page so the schedule holds even if
 * Chromium is restarting. The sysfs `brightness` file is group-writable by
 * `video` on Pi OS, so the service user only needs to be in that group.
 *
 * Set BACKLIGHT_DEVICE in .env to pick a specific device (a name under
 * /sys/class/backlight, or a full path); otherwise the first one found is
 * used. With no backlight, or dimming.method = "overlay", the display page
 * dims itself with a CSS overlay instead (see public/js/app.js).
 */

const SYSFS_ROOT = '/sys/class/backlight';
const CHECK_INTERVAL_MS = 30 * 1000;
const FADE_STEPS = 15;
const FADE_STEP_MS = 200; // ~3s fade, matching the overlay's CSS transition

function findDevice() {
  const configured = process.env.BACKLIGHT_DEVICE;
  const candidates = configured
    ? [configured.includes('/') ? configured : path.join(SYSFS_ROOT, configured)]
    : safeReaddir(SYSFS_ROOT).map((name) => path.join(SYSFS_ROOT, name));

  for (const dir of candidates) {
    try {
      const max = Number(fs.readFileSync(path.join(dir, 'max_brightness'), 'utf8'));
      fs.accessSync(path.join(dir, 'brightness'), fs.constants.W_OK);
      if (max > 0) return { dir, max };
    } catch {
      // not present or not writable - try the next one
    }
  }
  return null;
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

class BacklightController {
  constructor() {
    this.device = findDevice();
    this.timer = null;
    this.fadeTimer = null;
    this.lastTarget = null;
    if (this.device) {
      console.log(`Backlight: using ${this.device.dir} (max ${this.device.max})`);
    } else {
      console.log('Backlight: none found (or not writable) - overnight dimming will use the on-screen overlay.');
    }
  }

  get available() {
    return !!this.device;
  }

  /** "backlight" or "overlay" - what's actually dimming the display under the current config. */
  effectiveMethod(dimming) {
    const method = (dimming && dimming.method) || 'auto';
    return method !== 'overlay' && this.available ? 'backlight' : 'overlay';
  }

  status() {
    const { dimming } = configStore.get();
    return {
      available: this.available,
      device: this.device ? path.basename(this.device.dir) : null,
      method: this.effectiveMethod(dimming),
      level: this.available ? this._readLevel() : null,
      max: this.available ? this.device.max : null,
    };
  }

  start() {
    if (!this.available) return;
    configStore.onChange(() => this.apply());
    this.timer = setInterval(() => this.apply(), CHECK_INTERVAL_MS);
    this.apply();
  }

  apply() {
    const { dimming } = configStore.get();
    // Using the overlay instead (or dimming off): keep the backlight at full.
    const percent = this.effectiveMethod(dimming) === 'backlight' ? targetBrightness(dimming, new Date()) : 100;
    const target = Math.max(1, Math.round((percent / 100) * this.device.max));
    if (target === this.lastTarget) return;
    this.lastTarget = target;
    this._fadeTo(target);
  }

  _readLevel() {
    try {
      return Number(fs.readFileSync(path.join(this.device.dir, 'brightness'), 'utf8'));
    } catch {
      return null;
    }
  }

  _write(level) {
    try {
      fs.writeFileSync(path.join(this.device.dir, 'brightness'), String(level));
    } catch (err) {
      console.error(`Backlight: write failed (${err.message})`);
    }
  }

  _fadeTo(target) {
    clearInterval(this.fadeTimer);
    const from = this._readLevel();
    if (from == null || from === target) {
      this._write(target);
      return;
    }
    let step = 0;
    this.fadeTimer = setInterval(() => {
      step += 1;
      const level = step >= FADE_STEPS ? target : Math.round(from + ((target - from) * step) / FADE_STEPS);
      this._write(level);
      if (step >= FADE_STEPS) clearInterval(this.fadeTimer);
    }, FADE_STEP_MS);
  }
}

module.exports = new BacklightController();

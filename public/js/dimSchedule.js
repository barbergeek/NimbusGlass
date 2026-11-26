/*
  Overnight dimming schedule, shared by the browser (public/js/app.js, for
  the overlay) and the server (src/server/backlight.js, for the panel
  backlight) so the two can never disagree about whether it's "night".

  config.dimming = { enabled, start: "HH:MM", end: "HH:MM", brightness: %,
  method: "auto" | "backlight" | "overlay" }. The window may wrap past
  midnight (22:00 -> 07:00). Brightness is clamped to 5-100% so a dimmed
  mirror is never fully dark.
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NimbusDimSchedule = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN_BRIGHTNESS = 5;
  const DEFAULT_BRIGHTNESS = 40;

  function minutesOfDay(hhmm) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function isDimNow(settings, now) {
    if (!settings || !settings.enabled) return false;
    const start = minutesOfDay(settings.start);
    const end = minutesOfDay(settings.end);
    if (start == null || end == null || start === end) return false;
    const t = now.getHours() * 60 + now.getMinutes();
    return start < end ? t >= start && t < end : t >= start || t < end;
  }

  function dimBrightness(settings) {
    const value = Number(settings && settings.brightness) || DEFAULT_BRIGHTNESS;
    return Math.min(100, Math.max(MIN_BRIGHTNESS, value));
  }

  /** Brightness (%) the display should be at right now: 100 by day, the configured level at night. */
  function targetBrightness(settings, now) {
    return isDimNow(settings, now) ? dimBrightness(settings) : 100;
  }

  return { minutesOfDay, isDimNow, dimBrightness, targetBrightness };
});

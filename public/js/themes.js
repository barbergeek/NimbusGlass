/*
  Theme catalog + the "seasonal" auto-theme resolver, shared by the display
  page (public/js/app.js) and the admin console (public/admin/admin.js) so
  the theme picker and what the mirror actually shows can't drift apart.
  Each theme's colors live in public/css/theme.css under [data-theme='<id>'].
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NimbusThemes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SEASONAL = 'seasonal';

  const THEMES = [
    { id: 'vibrant-dark', label: 'Vibrant Dark', group: 'Everyday' },
    { id: 'ocean', label: 'Ocean', group: 'Everyday' },
    { id: 'forest', label: 'Forest', group: 'Everyday' },
    { id: 'ember', label: 'Ember', group: 'Everyday' },
    { id: 'aurora', label: 'Aurora', group: 'Everyday' },
    { id: 'high-contrast', label: 'High Contrast', group: 'Everyday' },
    { id: 'mono', label: 'Mono', group: 'Everyday' },
    { id: 'vibrant-light', label: 'Vibrant Light', group: 'Light' },
    { id: 'paper', label: 'Paper', group: 'Light' },
    { id: 'winter', label: 'Winter', group: 'Seasons' },
    { id: 'spring', label: 'Spring', group: 'Seasons' },
    { id: 'summer', label: 'Summer', group: 'Seasons' },
    { id: 'autumn', label: 'Autumn', group: 'Seasons' },
    { id: 'valentines', label: "Valentine's Day", group: 'Holidays' },
    { id: 'st-patricks', label: "St. Patrick's Day", group: 'Holidays' },
    { id: 'independence', label: 'Independence Day', group: 'Holidays' },
    { id: 'halloween', label: 'Halloween', group: 'Holidays' },
    { id: 'thanksgiving', label: 'Thanksgiving', group: 'Holidays' },
    { id: 'festive', label: 'Festive (December)', group: 'Holidays' },
  ];

  const KNOWN = new Set(THEMES.map((t) => t.id));

  function labelOf(id) {
    if (id === SEASONAL) return 'Automatic (seasonal)';
    const theme = THEMES.find((t) => t.id === id);
    return theme ? theme.label : id;
  }

  /** US Thanksgiving: the fourth Thursday of November. */
  function thanksgiving(year) {
    const firstWeekday = new Date(year, 10, 1).getDay(); // 0 = Sunday
    return new Date(year, 10, 1 + ((4 - firstWeekday + 7) % 7) + 21);
  }

  function dayStart(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  /** Holiday theme in effect on `date`, or null. Ranges are inclusive. */
  function holidayFor(date) {
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const md = m * 100 + d; // e.g. Feb 14 -> 214
    if (md >= 207 && md <= 214) return 'valentines';
    if (md >= 310 && md <= 317) return 'st-patricks';
    if (md >= 628 && md <= 704) return 'independence';
    if (md >= 1017 && md <= 1031) return 'halloween';
    if (m === 11) {
      // The week leading up to Thanksgiving, through the Friday after.
      const day = dayStart(date).getTime();
      const tg = thanksgiving(date.getFullYear()).getTime();
      const DAY = 24 * 60 * 60 * 1000;
      if (day >= tg - 6 * DAY && day <= tg + DAY) return 'thanksgiving';
    }
    if (m === 12 || md === 101) return 'festive';
    return null;
  }

  /** Meteorological season, flipped for the southern hemisphere (lat < 0). */
  function seasonFor(date, lat) {
    const seasons = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
    const season = seasons[date.getMonth()];
    if (!(Number(lat) < 0)) return season;
    return { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' }[season];
  }

  /**
   * The concrete theme to show: `id` itself, or for "seasonal" the holiday
   * (US calendar) or season in effect on `date`. Unknown ids fall back to
   * the default so a stale config can't leave the mirror unstyled.
   */
  function resolve(id, date, lat) {
    if (id === SEASONAL) return holidayFor(date) || seasonFor(date, lat);
    return KNOWN.has(id) ? id : 'vibrant-dark';
  }

  return { SEASONAL, THEMES, labelOf, resolve, holidayFor, seasonFor, thanksgiving };
});

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'config.default.json');
const LIVE_CONFIG_PATH = path.join(__dirname, '..', '..', 'data', 'config.json');

/**
 * Holds the single source of truth for module/layout/theme state in memory,
 * persists it to data/config.json, and notifies subscribers (the websocket
 * layer) whenever it changes so the mirror display can update without a
 * page reload.
 */
class ConfigStore {
  constructor() {
    this.listeners = new Set();
    this.config = this._load();
  }

  _load() {
    if (!fs.existsSync(path.dirname(LIVE_CONFIG_PATH))) {
      fs.mkdirSync(path.dirname(LIVE_CONFIG_PATH), { recursive: true });
    }
    const defaults = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8'));
    if (!fs.existsSync(LIVE_CONFIG_PATH)) {
      fs.writeFileSync(LIVE_CONFIG_PATH, JSON.stringify(defaults, null, 2));
      return defaults;
    }

    const live = JSON.parse(fs.readFileSync(LIVE_CONFIG_PATH, 'utf8'));
    migrateLegacyScoreboardSettings(live);
    // Backfill keys a code update added (e.g. a new module) that an
    // existing data/config.json predates, so it doesn't crash on first read
    // after an upgrade. This only adds missing object keys - it won't graft
    // a new module into an existing layout array (arrays are taken from
    // `live` wholesale, deliberately, so a user's own ordering/assignment
    // is never silently overwritten); a newly-added module just starts
    // unassigned until placed from /admin.
    const merged = deepMerge(defaults, live);
    if (JSON.stringify(merged) !== JSON.stringify(live)) {
      fs.writeFileSync(LIVE_CONFIG_PATH, JSON.stringify(merged, null, 2));
    }
    return merged;
  }

  get() {
    return this.config;
  }

  /** Shallow-merge a partial update (e.g. { layout }, { theme }, { modules: { weather: {...} } }). */
  update(partial) {
    this.config = deepMerge(this.config, partial);
    fs.writeFileSync(LIVE_CONFIG_PATH, JSON.stringify(this.config, null, 2));
    for (const listener of this.listeners) listener(this.config);
    return this.config;
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

// One-time upgrade paths for scoreboard.settings.leagues, run in order and
// each a no-op once already applied - mutates `live` in place before the
// defaults merge runs, so an existing data/config.json picks these up on
// first boot after an upgrade.
function migrateLegacyScoreboardSettings(live) {
  const settings = live && live.modules && live.modules.scoreboard && live.modules.scoreboard.settings;
  if (!settings) return;

  // v1 -> v2: leagues was a flat array (all leagues sharing one global
  // `teams` filter). Now an object keyed by league so each can be
  // enabled/filtered independently. There's no way to carry the old global
  // `teams` filter forward correctly (it wasn't scoped per league), so
  // previously-enabled leagues just start unfiltered again.
  if (Array.isArray(settings.leagues)) {
    const leagues = {};
    for (const league of settings.leagues) {
      leagues[league] = { enabled: true, teams: [] };
    }
    settings.leagues = leagues;
    delete settings.teams;
  }

  // v2 -> v3: each league's `teams` was an exclusive filter (show ONLY
  // these teams). It's now `favorites` - always shown, pinned first -
  // plus a `conferences` list for which other teams' games follow. A
  // straight rename carries the old exclusive-filter teams forward as
  // favorites with no conferences selected, which reproduces the old
  // behavior exactly (favorites-only, nothing else).
  for (const league of Object.values(settings.leagues || {})) {
    if ('teams' in league) {
      league.favorites = league.teams;
      delete league.teams;
    }
    if (!('favorites' in league)) league.favorites = [];
    if (!('conferences' in league)) league.conferences = [];
  }
}

function deepMerge(base, patch) {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return patch;
  }
  const result = { ...base };
  for (const key of Object.keys(patch)) {
    result[key] = deepMerge(base ? base[key] : undefined, patch[key]);
  }
  return result;
}

module.exports = new ConfigStore();

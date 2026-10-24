'use strict';

/**
 * Minimal in-memory TTL cache. Keeps every upstream fetch (ESPN, OpenWeatherMap)
 * off the Pi's UI thread's critical path and off the upstream rate limit -
 * both APIs here are public/undocumented and get unhappy if hammered.
 */
class TTLCache {
  constructor() {
    this.store = new Map();
  }

  get(key) {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value, ttlMs) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Fetch-through helper: return the cached value, or call `fn`, cache its
   * resolved value for `ttlMs`, and return that.
   */
  async wrap(key, ttlMs, fn) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await fn();
    this.set(key, value, ttlMs);
    return value;
  }
}

module.exports = new TTLCache();

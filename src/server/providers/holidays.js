'use strict';

const cache = require('../cache');

// Nager.Date: free, no API key, public holiday data by ISO 3166-1 alpha-2
// country code. https://date.nager.at
const REFRESH_MS = 24 * 60 * 60 * 1000; // holiday calendars don't change intraday

function holidaysUrl(year, country) {
  return `https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`;
}

/**
 * Fetch one year's holidays. Returns [] (rather than throwing) on a 404 -
 * Nager.Date 404s for a country/year it doesn't have data for yet (e.g.
 * next year's calendar not published), which shouldn't take down the
 * current year's data fetched alongside it.
 */
async function fetchYear(year, country) {
  const response = await fetch(holidaysUrl(year, country));
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`Holiday lookup failed for ${country} ${year}: ${response.status}`);
  }
  return response.json();
}

async function fetchHolidays(location, count) {
  const country = location && location.country;
  if (!country) {
    return { error: 'No country configured for holidays', holidays: [] };
  }

  const now = new Date();
  const cacheKey = `holidays:${country}:${now.getFullYear()}`;
  const raw = await cache.wrap(cacheKey, REFRESH_MS, async () => {
    const [thisYear, nextYear] = await Promise.all([
      fetchYear(now.getFullYear(), country),
      fetchYear(now.getFullYear() + 1, country),
    ]);
    return [...thisYear, ...nextYear];
  });

  const today = now.toISOString().slice(0, 10);
  const holidays = raw
    .filter((h) => h.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, count)
    .map((h) => ({ date: h.date, name: h.name }));

  return { error: null, holidays };
}

module.exports = { fetchHolidays };

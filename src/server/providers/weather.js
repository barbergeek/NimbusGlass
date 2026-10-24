'use strict';

const cache = require('../cache');

const REFRESH_MS = 10 * 60 * 1000; // OpenWeatherMap free tier: stay well under 60 calls/min

function currentAndForecastUrl({ apiKey, units, city, lat, lon }) {
  const loc = lat != null && lon != null ? `lat=${lat}&lon=${lon}` : `q=${encodeURIComponent(city)}`;
  return {
    current: `https://api.openweathermap.org/data/2.5/weather?${loc}&units=${units}&appid=${apiKey}`,
    forecast: `https://api.openweathermap.org/data/2.5/forecast?${loc}&units=${units}&appid=${apiKey}`,
  };
}

/**
 * OpenWeatherMap's current-weather response has no state/region field, only
 * city name + country code - so "Haymarket,VA,US" in config would otherwise
 * always display as "Haymarket, US". Prefer the second segment of the
 * configured city string (state for a US-style query, region for others)
 * when there is one, and only fall back to the API's bare name+country for
 * lat/lon-based configs that have no city string to draw from.
 */
function formatLocation(settings, currentBody) {
  if (settings.city) {
    const parts = settings.city.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}, ${parts[1]}`;
    if (parts.length === 1) return parts[0];
  }
  return [currentBody.name, currentBody.sys.country].filter(Boolean).join(', ');
}

/** Collapse OpenWeatherMap's 3-hourly forecast list into one entry per day (noon-ish reading, daily min/max). */
function summarizeDailyForecast(list, days) {
  const byDate = new Map();
  for (const entry of list) {
    const date = entry.dt_txt.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(entry);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const dates = [...byDate.keys()].filter((d) => d !== todayStr).slice(0, days);

  return dates.map((date) => {
    const entries = byDate.get(date);
    const temps = entries.map((e) => e.main.temp);
    const midday = entries.find((e) => e.dt_txt.includes('12:00:00')) || entries[Math.floor(entries.length / 2)];
    return {
      date,
      high: Math.round(Math.max(...temps)),
      low: Math.round(Math.min(...temps)),
      summary: midday.weather[0].main,
      icon: midday.weather[0].icon,
    };
  });
}

async function fetchWeather(settings, apiKey) {
  if (!apiKey) {
    return { error: 'OPENWEATHER_API_KEY is not set', current: null, forecast: [] };
  }

  const cacheKey = `weather:${settings.city}:${settings.lat}:${settings.lon}:${settings.units}`;
  return cache.wrap(cacheKey, REFRESH_MS, async () => {
    const urls = currentAndForecastUrl({ ...settings, apiKey });
    const [currentRes, forecastRes] = await Promise.all([fetch(urls.current), fetch(urls.forecast)]);

    if (!currentRes.ok || !forecastRes.ok) {
      throw new Error(`OpenWeatherMap request failed (${currentRes.status}/${forecastRes.status})`);
    }

    const [currentBody, forecastBody] = await Promise.all([currentRes.json(), forecastRes.json()]);

    return {
      error: null,
      location: formatLocation(settings, currentBody),
      current: {
        temp: Math.round(currentBody.main.temp),
        feelsLike: Math.round(currentBody.main.feels_like),
        condition: currentBody.weather[0].main,
        icon: currentBody.weather[0].icon,
        humidity: currentBody.main.humidity,
      },
      forecast: summarizeDailyForecast(forecastBody.list, settings.forecastDays || 3),
    };
  });
}

module.exports = { fetchWeather };

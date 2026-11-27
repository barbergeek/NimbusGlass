'use strict';

const express = require('express');
const configStore = require('../configStore');
const backlight = require('../backlight');
const rotation = require('../rotation');
const { fetchWeather } = require('../providers/weather');
const { fetchScores } = require('../providers/sports');
const { fetchGameDetail } = require('../providers/gameDetail');
const { fetchHolidays } = require('../providers/holidays');
const { fetchTeams } = require('../providers/teams');
const { fetchConferences } = require('../providers/conferences');

function buildApiRouter() {
  const router = express.Router();

  router.get('/config', (req, res) => {
    res.json(configStore.get());
  });

  router.post('/config', (req, res) => {
    const updated = configStore.update(req.body);
    res.json(updated);
  });

  // Hardware display state: what's dimming the display (backlight vs.
  // on-screen overlay - the display page reads this to decide whether to
  // draw its overlay) and the last screen-rotation result.
  router.get('/display', (req, res) => {
    res.json({ ...backlight.status(), rotation: rotation.status() });
  });

  // Re-apply config.rotation to the running compositor. Called by
  // scripts/kiosk-start.sh each time the kiosk session starts.
  router.post('/display/rotation', async (req, res) => {
    res.json(await rotation.apply());
  });

  router.get('/weather', async (req, res) => {
    const { location, modules } = configStore.get();
    const { settings } = modules.weather;
    try {
      const data = await fetchWeather({ ...location, ...settings }, settings.apiKey || process.env.OPENWEATHER_API_KEY);
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err.message, current: null, forecast: [] });
    }
  });

  router.get('/scores', async (req, res) => {
    const { settings } = configStore.get().modules.scoreboard;
    try {
      const data = await fetchScores(settings.leagues, {
        rolloverHours: settings.rolloverHours,
        upcomingDays: settings.upcomingDays,
      });
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err.message, leagues: [], upcoming: [] });
    }
  });

  // One game's details, for tapping a game on the scoreboard.
  router.get('/scores/:league/:eventId', async (req, res) => {
    try {
      res.json(await fetchGameDetail(req.params.league, req.params.eventId));
    } catch (err) {
      res.status(err.status || 502).json({ error: err.message });
    }
  });

  router.get('/teams/:league', async (req, res) => {
    try {
      const data = await fetchTeams(req.params.league);
      res.json({ teams: data });
    } catch (err) {
      res.status(502).json({ error: err.message, teams: [] });
    }
  });

  router.get('/conferences/:league', async (req, res) => {
    try {
      const data = await fetchConferences(req.params.league);
      res.json({ conferences: data });
    } catch (err) {
      res.status(502).json({ error: err.message, conferences: [] });
    }
  });

  router.get('/holidays', async (req, res) => {
    const { location, modules } = configStore.get();
    const holidaysModule = modules.holidays;
    if (!holidaysModule) {
      res.status(502).json({ error: 'Holidays module not configured', holidays: [] });
      return;
    }
    try {
      const data = await fetchHolidays(location, holidaysModule.settings.count || 5);
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err.message, holidays: [] });
    }
  });

  return router;
}

module.exports = { buildApiRouter };

'use strict';

const express = require('express');
const configStore = require('../configStore');
const { fetchWeather } = require('../providers/weather');
const { fetchScores } = require('../providers/sports');
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
      const data = await fetchScores(settings.leagues);
      res.json({ leagues: data });
    } catch (err) {
      res.status(502).json({ error: err.message, leagues: [] });
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

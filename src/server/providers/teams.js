'use strict';

const cache = require('../cache');
const { LEAGUE_PATHS } = require('./leaguePaths');

/**
 * Team rosters for the league/team picker in /admin. Separate from
 * sports.js's scoreboard fetch (different endpoint, different cadence) -
 * team lists only change between seasons, so this uses a much longer TTL.
 * Same ESPN "site" API family, no key: .../teams?limit=1000
 */

const REFRESH_MS = 24 * 60 * 60 * 1000;

function teamsUrl(league) {
  const leaguePath = LEAGUE_PATHS[league];
  if (!leaguePath) throw new Error(`Unsupported league: ${league}`);
  // NCAA football/basketball span hundreds of teams across every division
  // (762 for college football alone) - limit high enough to get them all
  // in one page rather than guessing at ESPN's undocumented paging.
  return `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/teams?limit=1000`;
}

function normalizeTeam({ team }) {
  return {
    abbreviation: team.abbreviation,
    location: team.location, // city, or school name for NCAA
    name: team.name, // nickname/mascot
    displayName: team.displayName,
    shortDisplayName: team.shortDisplayName,
  };
}

async function fetchTeams(league) {
  return cache.wrap(`teams:${league}`, REFRESH_MS, async () => {
    const response = await fetch(teamsUrl(league));
    if (!response.ok) {
      throw new Error(`ESPN teams request failed for ${league}: ${response.status}`);
    }
    const body = await response.json();
    const entries = body.sports?.[0]?.leagues?.[0]?.teams || [];
    return entries
      .map(normalizeTeam)
      .sort((a, b) => (a.location + a.name).localeCompare(b.location + b.name));
  });
}

module.exports = { fetchTeams };

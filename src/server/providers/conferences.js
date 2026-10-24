'use strict';

const cache = require('../cache');
const { LEAGUE_PATHS } = require('./leaguePaths');

/**
 * Conference/division membership for the admin "select conferences" picker
 * and for filtering the scoreboard. ESPN's consumer standings endpoint
 * returns conferences as `children`, each with its teams embedded directly
 * under `standings.entries` - one request gets every team's conference for
 * the whole league, no per-team fetches. A league with a single flat table
 * (soccer leagues have no conference split) comes back with 0 or 1
 * children; treated as "no conference structure" rather than one giant
 * conference.
 *
 * URL shape: https://site.web.api.espn.com/apis/v2/sports/{leaguePath}/standings
 */

const REFRESH_MS = 24 * 60 * 60 * 1000; // conference membership barely changes mid-season

function standingsUrl(league) {
  const leaguePath = LEAGUE_PATHS[league];
  if (!leaguePath) throw new Error(`Unsupported league: ${league}`);
  return `https://site.web.api.espn.com/apis/v2/sports/${leaguePath}/standings`;
}

async function fetchStandingsTree(league) {
  return cache.wrap(`standings:${league}`, REFRESH_MS, async () => {
    const response = await fetch(standingsUrl(league));
    if (!response.ok) {
      throw new Error(`ESPN standings request failed for ${league}: ${response.status}`);
    }
    const body = await response.json();
    const children = Array.isArray(body.children) ? body.children : [];
    return children.length > 1 ? children : []; // 0 or 1 = no real conference split
  });
}

/** [{ abbreviation, name }] for the admin conference picker. */
async function fetchConferences(league) {
  const children = await fetchStandingsTree(league);
  return children.map((c) => ({ abbreviation: c.abbreviation, name: c.name }));
}

/** { teamAbbreviation: conferenceAbbreviation }, for filtering games by conference. */
async function fetchConferenceMap(league) {
  const children = await fetchStandingsTree(league);
  const map = {};
  for (const conference of children) {
    const entries = (conference.standings && conference.standings.entries) || [];
    for (const entry of entries) {
      map[entry.team.abbreviation] = conference.abbreviation;
    }
  }
  return map;
}

module.exports = { fetchConferences, fetchConferenceMap };

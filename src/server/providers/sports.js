'use strict';

const cache = require('../cache');
const { LEAGUE_PATHS, NCAA_GROUPS } = require('./leaguePaths');
const { fetchConferenceMap } = require('./conferences');

/**
 * Score data-fetching strategy ported from the dathbe/MMM-MyScoreboard
 * MagicMirror module (fork of jclarke0000/MMM-MyScoreboard): hit ESPN's
 * free, undocumented "site" scoreboard API directly rather than a paid
 * sports-data API. There's no API key and no documented rate limit, so we
 * cache aggressively (REFRESH_MS) and poll on a shared interval instead of
 * per-client, per the upstream module's "please don't hammer this" notice.
 *
 * URL shape: https://site.api.espn.com/apis/site/v2/sports/{leaguePath}/scoreboard?dates=YYYYMMDD&limit=200
 */

const REFRESH_MS = 2 * 60 * 1000; // matches MMM-MyScoreboard's default poll interval

// ESPN buckets games by US Eastern calendar date; this uses the server's
// local date instead. Fine for Eastern-ish deployments (the default config
// targets Columbus, OH), but a late-night game can briefly disappear from
// both "today" fetches for a server running well outside US time zones.
// MMM-MyScoreboard's neighborGameDate() handles this properly if that
// matters for your deployment.
function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function scoreboardUrl(league) {
  const leaguePath = LEAGUE_PATHS[league];
  if (!leaguePath) throw new Error(`Unsupported league: ${league}`);
  let url = `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/scoreboard?dates=${todayStr()}&limit=200`;
  if (NCAA_GROUPS[league]) url += `&groups=${NCAA_GROUPS[league]}`;
  return url;
}

function teamLine(competitor) {
  return {
    abbreviation: competitor.team.abbreviation,
    name: competitor.team.shortDisplayName || competitor.team.displayName,
    logo: competitor.team.logo || null,
    score: competitor.score ?? null,
    winner: competitor.winner === true,
    homeAway: competitor.homeAway,
  };
}

// `broadcast` is ESPN's single "primary" network (usually the national feed)
// but it's blank for some leagues (soccer) even though the fuller
// `broadcasts` list still has per-market entries - fall back to the
// national-market entry, then just the first one listed.
function broadcastName(competition) {
  if (competition.broadcast) return competition.broadcast;
  const broadcasts = competition.broadcasts || [];
  const national = broadcasts.find((b) => b.market === 'national');
  const pick = national || broadcasts[0];
  return pick && pick.names && pick.names.length ? pick.names[0] : null;
}

/** Normalize one ESPN event into the shape the scoreboard module renders. */
function normalizeEvent(event) {
  const competition = event.competitions[0];
  const competitors = competition.competitors.map(teamLine);
  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  const status = event.status.type;

  return {
    id: event.id,
    startTime: competition.date,
    state: status.state, // 'pre' | 'in' | 'post'
    statusDetail: status.shortDetail || status.detail || status.description,
    completed: status.completed === true,
    broadcast: broadcastName(competition),
    home,
    away,
  };
}

async function fetchLeague(league) {
  return cache.wrap(`sports:${league}`, REFRESH_MS, async () => {
    const url = scoreboardUrl(league);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`ESPN scoreboard request failed for ${league}: ${response.status}`);
    }
    const body = await response.json();
    const events = Array.isArray(body.events) ? body.events : [];
    return events.map(normalizeEvent);
  });
}

function gameHasTeam(game, abbreviation) {
  return game.home.abbreviation === abbreviation || game.away.abbreviation === abbreviation;
}

/**
 * Favorites always show, pinned first; after them, any other game whose
 * home or away team belongs to one of the selected conferences. With
 * neither set, the whole league's games pass through untouched (ESPN's own
 * ordering). A conference map lookup is only needed when conferences are
 * actually selected - skips the standings fetch otherwise.
 */
async function selectAndOrderGames(league, games, favorites, conferences) {
  if (!favorites.length && !conferences.length) return games;

  const isFavorite = (game) => favorites.some((abbr) => gameHasTeam(game, abbr));

  let inSelectedConference = () => false;
  if (conferences.length) {
    const conferenceOf = await fetchConferenceMap(league); // team abbreviation -> conference abbreviation
    inSelectedConference = (game) =>
      conferences.includes(conferenceOf[game.home.abbreviation]) || conferences.includes(conferenceOf[game.away.abbreviation]);
  }

  const favoriteGames = games.filter(isFavorite);
  const otherGames = games.filter((g) => !isFavorite(g) && inSelectedConference(g));
  return [...favoriteGames, ...otherGames];
}

/**
 * Fetch every enabled league in parallel. `leagueSettings` is
 * `{ [league]: { enabled, favorites, conferences } }` - see
 * config/config.default.json and selectAndOrderGames() above for the
 * favorites/conferences selection rules.
 */
async function fetchScores(leagueSettings = {}) {
  const enabledLeagues = Object.keys(leagueSettings).filter((league) => leagueSettings[league].enabled);
  const results = await Promise.all(
    enabledLeagues.map(async (league) => {
      const { favorites = [], conferences = [] } = leagueSettings[league];
      try {
        const games = await fetchLeague(league);
        const selected = await selectAndOrderGames(league, games, favorites, conferences);
        return { league, games: selected, error: null };
      } catch (err) {
        return { league, games: [], error: err.message };
      }
    })
  );
  return results;
}

module.exports = { fetchScores, LEAGUE_PATHS };

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
// Yesterday's finals and future days' schedules barely change - fetch them
// far less often than today's live scores.
const OTHER_DAY_TTL_MS = 60 * 60 * 1000;
const MAX_UPCOMING_DAYS = 14;

// ESPN buckets games by US Eastern calendar date; this uses the server's
// local date instead. Fine for Eastern-ish deployments (the default config
// targets Columbus, OH), but a late-night game can briefly disappear from
// both "today" fetches for a server running well outside US time zones.
// MMM-MyScoreboard's neighborGameDate() handles this properly if that
// matters for your deployment.
function dateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

// ESPN's scoreboard takes one date per request (a "YYYYMMDD-YYYYMMDD" range
// returns HTTP 400), so yesterday and each upcoming day are fetched separately.
function scoreboardUrl(league, date) {
  const leaguePath = LEAGUE_PATHS[league];
  if (!leaguePath) throw new Error(`Unsupported league: ${league}`);
  let url = `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/scoreboard?dates=${date}&limit=200`;
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

/** One league's games on one date ("YYYYMMDD"), cached for `ttlMs`. */
async function fetchLeagueDay(league, date, ttlMs) {
  return cache.wrap(`sports:${league}:${date}`, ttlMs, async () => {
    const url = scoreboardUrl(league, date);
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
 *
 * Options:
 * - rolloverHours: before this hour (local time), yesterday's games are
 *   still shown after today's, tagged when: 'yesterday' - so last night's
 *   final scores stay up through the morning. 0 turns it off.
 * - upcomingDays: favorites' next game within this many days (after
 *   today) is returned in a separate `upcoming` list, soonest first - one
 *   per favorite team, skipped for a team that already plays today.
 *   0 turns it off.
 */
async function fetchScores(leagueSettings = {}, { rolloverHours = 0, upcomingDays = 0 } = {}) {
  const enabledLeagues = Object.keys(leagueSettings).filter((league) => leagueSettings[league].enabled);
  const showYesterday = new Date().getHours() < Number(rolloverHours);
  const days = Math.min(MAX_UPCOMING_DAYS, Math.max(0, Math.floor(Number(upcomingDays) || 0)));

  const results = await Promise.all(
    enabledLeagues.map(async (league) => {
      const { favorites = [], conferences = [] } = leagueSettings[league];
      let games = [];
      let upcoming = [];
      let error = null;
      try {
        const today = await fetchLeagueDay(league, dateStr(0), REFRESH_MS);
        games = (await selectAndOrderGames(league, today, favorites, conferences)).map((g) => ({ ...g, when: 'today' }));

        if (showYesterday) {
          const yesterday = await fetchLeagueDay(league, dateStr(-1), OTHER_DAY_TTL_MS);
          const selected = await selectAndOrderGames(league, yesterday, favorites, conferences);
          games = games.concat(selected.map((g) => ({ ...g, when: 'yesterday' })));
        }

        if (days && favorites.length) {
          upcoming = await nextFavoriteGames(league, favorites, games, days);
        }
      } catch (err) {
        error = err.message;
      }
      return { league, games, upcoming, error };
    })
  );

  const upcoming = results
    .flatMap((r) => r.upcoming.map((game) => ({ ...game, league: r.league })))
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  return { leagues: results.map(({ upcoming: _u, ...rest }) => rest), upcoming };
}

/** Each favorite's first game in the next `days` days, unless it plays today. */
async function nextFavoriteGames(league, favorites, todaysGames, days) {
  const playingToday = new Set(
    favorites.filter((abbr) => todaysGames.some((g) => g.when === 'today' && gameHasTeam(g, abbr)))
  );
  const pending = favorites.filter((abbr) => !playingToday.has(abbr));
  if (!pending.length) return [];

  const dayGames = await Promise.all(
    Array.from({ length: days }, (_, i) => fetchLeagueDay(league, dateStr(i + 1), OTHER_DAY_TTL_MS).catch(() => []))
  );

  const found = new Map(); // game id -> game (two favorites can share one game)
  for (const abbr of pending) {
    for (const games of dayGames) {
      const game = games.find((g) => g.state === 'pre' && gameHasTeam(g, abbr));
      if (game) {
        found.set(game.id, { ...game, when: 'upcoming' });
        break;
      }
    }
  }
  return [...found.values()];
}

module.exports = { fetchScores, LEAGUE_PATHS };

'use strict';

const cache = require('../cache');
const { LEAGUE_PATHS } = require('./leaguePaths');

/**
 * One game's details for the tap-to-expand view on the scoreboard, from
 * ESPN's (free, undocumented) per-event "summary" endpoint:
 *   https://site.api.espn.com/apis/site/v2/sports/{leaguePath}/summary?event={id}
 *
 * A summary is 100-500KB of JSON (rosters, box scores, play-by-play, news) -
 * far too much for the Pi's browser to chew through for a popup - so it's
 * trimmed here to just what the detail view shows.
 */

// Live games change constantly; a pre-game check soon enough that a game
// that's started doesn't look scheduled for long; finals barely change.
const TTL_MS = { in: 30 * 1000, pre: 2 * 60 * 1000, post: 10 * 60 * 1000 };
const MAX_SCORING_PLAYS = 4;

// Regulation periods per league, so extra periods can be labeled OT.
// Baseball innings are always numbered, so it isn't listed.
const REGULATION_PERIODS = {
  NFL: 4,
  NBA: 4,
  NCAAF: 4,
  NCAAW: 4,
  NCAAM: 2,
  NHL: 3,
  'English Premier League': 2,
  MLS: 2,
};

function periodLabels(league, count) {
  const regulation = REGULATION_PERIODS[league];
  return Array.from({ length: count }, (_, i) => {
    if (!regulation || i < regulation) return String(i + 1);
    const ot = i - regulation + 1;
    return ot === 1 ? 'OT' : `${ot}OT`;
  });
}

function teamDetail(competitor) {
  const team = competitor.team || {};
  const logo = (team.logos && team.logos[0] && team.logos[0].href) || team.logo || null;
  const records = competitor.record || [];
  const overall = records.find((r) => r.type === 'total') || records[0];
  const rank = Number(competitor.rank || competitor.curatedRank?.current);
  return {
    id: team.id,
    abbreviation: team.abbreviation,
    name: team.displayName || team.shortDisplayName || team.abbreviation,
    logo,
    record: overall ? overall.summary || overall.displayValue : null,
    rank: rank > 0 && rank <= 25 ? rank : null,
    score: competitor.score ?? null,
    winner: competitor.winner === true,
    linescores: (competitor.linescores || []).map((l) => l.displayValue ?? String(l.value ?? '')),
  };
}

/** Top player per stat category, per team (season leaders before the game, game leaders after). */
function leaders(summary) {
  return (summary.leaders || [])
    .map((group) => ({
      team: group.team && group.team.abbreviation,
      categories: (group.leaders || [])
        .slice(0, 3)
        .map((category) => {
          const top = (category.leaders || [])[0];
          if (!top) return null;
          return {
            label: category.displayName || category.name,
            player: (top.athlete && (top.athlete.shortName || top.athlete.displayName)) || '',
            // Soccer season leaders read "Matches: 10, Goals: 3" - the
            // category label already says what the number is.
            value: (top.displayValue || '').replace(/^Matches: \d+, [^:]+: /, ''),
          };
        })
        .filter(Boolean),
    }))
    .filter((group) => group.team && group.categories.length);
}

/** The most recent scoring plays (soccer calls them key events). */
function scoringPlays(summary) {
  let plays = summary.scoringPlays;
  if (!Array.isArray(plays) || !plays.length) {
    plays = (summary.keyEvents || []).filter((event) => event.scoringPlay);
  }
  return plays.slice(-MAX_SCORING_PLAYS).map((play) => ({
    team: play.team && (play.team.abbreviation || play.team.displayName),
    text: (play.text || play.type?.text || '').trim(),
    period: play.period ? play.period.number : null,
    clock: play.clock ? play.clock.displayValue : null,
    awayScore: play.awayScore ?? null,
    homeScore: play.homeScore ?? null,
  }));
}

function odds(summary) {
  const line = (summary.pickcenter || [])[0];
  if (!line) return null;
  return {
    line: line.details || null,
    overUnder: line.overUnder ?? null,
  };
}

function winChance(summary) {
  const predictor = summary.predictor;
  if (!predictor || !predictor.homeTeam || !predictor.awayTeam) return null;
  const home = Number(predictor.homeTeam.gameProjection);
  const away = Number(predictor.awayTeam.gameProjection);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away };
}

function trimSummary(league, summary) {
  const competition = summary.header.competitions[0];
  const status = competition.status.type;
  const competitors = competition.competitors.map((c) => ({ ...teamDetail(c), homeAway: c.homeAway }));
  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  const periods = Math.max(home.linescores.length, away.linescores.length);
  const info = summary.gameInfo || {};
  const venue = info.venue || {};
  const address = venue.address || {};

  return {
    league,
    startTime: competition.date,
    state: status.state, // 'pre' | 'in' | 'post'
    statusDetail: status.detail || status.shortDetail || status.description,
    home,
    away,
    periods: periodLabels(league, periods),
    broadcasts: [
      ...new Set(
        (competition.broadcasts || [])
          .map((b) => (b.media && b.media.shortName) || (b.names && b.names[0]))
          .filter(Boolean)
      ),
    ].slice(0, 3),
    venue: venue.fullName
      ? { name: venue.fullName, city: [address.city, address.state].filter(Boolean).join(', ') }
      : null,
    attendance: info.attendance || null,
    leaders: leaders(summary),
    leadersAre: status.state === 'pre' ? 'season' : 'game',
    scoringPlays: status.state === 'pre' ? [] : scoringPlays(summary),
    odds: status.state === 'pre' ? odds(summary) : null,
    winChance: status.state === 'pre' ? winChance(summary) : null,
  };
}

/**
 * `league` is a config league key (see leaguePaths.js) and `eventId` an ESPN
 * event id - both end up in an outbound URL, so both are validated here.
 */
async function fetchGameDetail(league, eventId) {
  const leaguePath = Object.prototype.hasOwnProperty.call(LEAGUE_PATHS, league) ? LEAGUE_PATHS[league] : null;
  if (!leaguePath) throw Object.assign(new Error(`Unsupported league: ${league}`), { status: 400 });
  if (!/^\d{1,15}$/.test(String(eventId))) throw Object.assign(new Error('Invalid game id'), { status: 400 });

  const key = `game:${league}:${eventId}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/summary?event=${eventId}`);
  if (!response.ok) throw new Error(`ESPN game summary request failed: ${response.status}`);
  const detail = trimSummary(league, await response.json());
  cache.set(key, detail, TTL_MS[detail.state] || TTL_MS.pre);
  return detail;
}

module.exports = { fetchGameDetail, trimSummary };

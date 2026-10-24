'use strict';

// League identifier -> ESPN sport/league path segment. Shared by sports.js
// (scores), teams.js (rosters), and conferences.js (standings/conferences) -
// split out on its own so those three don't have to require each other.
const LEAGUE_PATHS = {
  NFL: 'football/nfl',
  NHL: 'hockey/nhl',
  MLB: 'baseball/mlb',
  NBA: 'basketball/nba',
  NCAAF: 'football/college-football',
  NCAAM: 'basketball/mens-college-basketball',
  NCAAW: 'basketball/womens-college-basketball',
  'English Premier League': 'soccer/eng.1',
  MLS: 'soccer/usa.1',
};

// ESPN only returns Top 25 for these by default; append the group id used on
// espn.com's own scoreboard pages to get the full slate.
const NCAA_GROUPS = {
  NCAAF: 80,
  NCAAM: 50,
};

module.exports = { LEAGUE_PATHS, NCAA_GROUPS };

(function () {
  // Mirrors the keys in src/server/providers/leaguePaths.js - only needs an
  // entry where the config key itself is too wide for the mirror display.
  const LEAGUE_ABBREVIATIONS = {
    'English Premier League': 'EPL',
  };

  // Narrowest a column of games can get before the table drops to fewer
  // columns. One game is one line: league, away team, score, home team,
  // status - about 340px at the mirror's font size.
  const MIN_COLUMN_PX = 340;
  const FADE_MS = 350;

  // Game data comes from ESPN (via the server) and league names from
  // config, which any device on the network can set - escape all of it
  // before it goes into innerHTML.
  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function isGameFavorite(game, favorites) {
    return favorites.includes(game.home.abbreviation) || favorites.includes(game.away.abbreviation);
  }

  /**
   * A team's name cell. Favorites are marked on the team itself, in the
   * accent color, rather than on the whole row - so a league with no
   * favorites doesn't look like it's missing something, and you can tell
   * which side is yours. That leaves color free, so a finished game marks
   * its result by graying out the loser.
   */
  function teamCell(team, side, game, favorites) {
    const classes = ['score-team', side];
    if (favorites.includes(team.abbreviation)) classes.push('fav');
    if (game.state === 'post' && !team.winner && (game.home.winner || game.away.winner)) classes.push('loser');
    const name = esc(team.abbreviation);
    const inner = side === 'away' ? `${teamLogo(team)}${name}` : `${name}${teamLogo(team)}`;
    return `<span class="${classes.join(' ')}">${inner}</span>`;
  }

  // Scoreboard images only - hide a dead/renamed logo URL rather than
  // showing a broken-image icon on the kiosk display. It keeps its space,
  // so the columns still line up.
  function teamLogo(team) {
    return team.logo ? `<img class="score-logo" src="${esc(team.logo)}" alt="" onerror="this.style.visibility='hidden'">` : '';
  }

  function timeOnly(startTime) {
    return new Date(startTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  /** "Fri 3:00 PM" in the mirror's local time. */
  function dayAndTime(startTime) {
    return new Date(startTime).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }

  /**
   * The one-line status: ESPN's own text for live and finished games, but
   * our own short local time for games that haven't started - ESPN's
   * "11/27 - 3:00 PM EST" is twice as wide and repeats today's date.
   */
  function statusText(game) {
    if (game.when === 'upcoming') return dayAndTime(game.startTime);
    if (game.state === 'pre') return timeOnly(game.startTime);
    if (game.when === 'yesterday') {
      const day = new Date(game.startTime).toLocaleDateString(undefined, { weekday: 'short' });
      return `${day} ${game.statusDetail}`; // "Thu Final"
    }
    return game.statusDetail;
  }

  /**
   * One game, one line. The cells are direct grid items of the column (via
   * subgrid), so every game's team names, scores and statuses line up
   * vertically no matter how wide each one's text is.
   */
  function gameRow(game, leagueSettings) {
    const notStarted = game.when === 'upcoming' || game.state === 'pre';
    const score = notStarted
      ? '<span class="score-sep">@</span>'
      : `${esc(game.away.score ?? '-')}<span class="score-sep">–</span>${esc(game.home.score ?? '-')}`;
    const league = LEAGUE_ABBREVIATIONS[game.league] || game.league;
    const favorites = (leagueSettings[game.league] && leagueSettings[game.league].favorites) || [];
    const classes = ['score-row', game.when === 'yesterday' ? 'yesterday' : '', game.state === 'in' ? 'live' : '']
      .filter(Boolean)
      .join(' ');
    return `
      <div class="${classes}">
        <span class="score-league-tag">${esc(league)}</span>
        ${teamCell(game.away, 'away', game, favorites)}
        <span class="score-value">${score}</span>
        ${teamCell(game.home, 'home', game, favorites)}
        <span class="score-status"><span class="score-status-text">${esc(statusText(game))}</span>${game.broadcast ? `<span class="score-network">${esc(game.broadcast)}</span>` : ''}</span>
      </div>
    `;
  }

  /**
   * Everything in one list: favorites' games today (and last night's) first,
   * then the rest of today's games, then favorites' upcoming games. Leagues
   * share rows - a row per league would stack five or six rows on a small
   * panel, most of them holding a single game.
   */
  function orderGames(leagues, upcoming, leagueSettings) {
    const pinned = [];
    const rest = [];
    for (const { league, games, error } of leagues) {
      if (error || !games) continue;
      const favorites = (leagueSettings[league] && leagueSettings[league].favorites) || [];
      for (const game of games) {
        const entry = { ...game, league: game.league || league, favorite: isGameFavorite(game, favorites) };
        (entry.favorite ? pinned : rest).push(entry);
      }
    }
    return { pinned, rotating: rest.concat(upcoming.map((g) => ({ ...g, favorite: true }))) };
  }

  /**
   * Splits the games into screens of `cols x rows`. Favorites playing today
   * stay on every screen (unless they alone overflow it - then they page
   * like everything else); the remaining slots cycle through the rest.
   */
  function paginate({ pinned, rotating }, pageSize) {
    const all = pinned.concat(rotating);
    if (all.length <= pageSize) return [all];
    if (pinned.length >= pageSize) {
      const pages = [];
      for (let i = 0; i < all.length; i += pageSize) pages.push(all.slice(i, i + pageSize));
      return pages;
    }
    const slots = pageSize - pinned.length;
    const pages = [];
    for (let i = 0; i < rotating.length; i += slots) pages.push(pinned.concat(rotating.slice(i, i + slots)));
    return pages;
  }

  /**
   * Lays one page out row by row across `cols` columns. Each column is its
   * own grid so its rows align; a page short of games is padded with
   * invisible rows so the module's height doesn't jump as pages turn.
   */
  function pageHtml(games, cols, rows, leagueSettings) {
    const columns = Array.from({ length: cols }, () => []);
    games.forEach((game, i) => columns[i % cols].push(gameRow(game, leagueSettings)));
    return columns
      .map((col) => {
        while (col.length < rows) col.push('<div class="score-row filler" aria-hidden="true"><span></span></div>');
        return `<div class="scoreboard-column">${col.join('')}</div>`;
      })
      .join('');
  }

  function columnCount(container) {
    const width = container.clientWidth || MIN_COLUMN_PX;
    return Math.max(1, Math.floor(width / MIN_COLUMN_PX));
  }

  function render(container, state, settings) {
    clearInterval(state.pageTimer);
    const { leagues, upcoming } = state.data;
    const ordered = orderGames(leagues, upcoming, settings.leagues || {});
    if (!ordered.pinned.length && !ordered.rotating.length) {
      container.innerHTML = '<div class="score-status">No games today</div>';
      return;
    }

    const all = ordered.pinned.length + ordered.rotating.length;
    const cols = Math.min(columnCount(container), all);
    const maxRows = Math.max(1, Number(settings.maxRows) || 3);
    const pages = paginate(ordered, cols * maxRows);
    // Every page is padded to the tallest one's row count.
    const rows = Math.min(maxRows, Math.ceil(Math.max(...pages.map((p) => p.length)) / cols));

    const grid = document.createElement('div');
    grid.className = 'scoreboard-grid';
    grid.style.setProperty('--score-cols', cols);
    container.innerHTML = '';
    container.appendChild(grid);

    state.page = state.page % pages.length || 0;
    grid.innerHTML = pageHtml(pages[state.page], cols, rows, settings.leagues || {});
    if (pages.length < 2) return;

    state.pageTimer = setInterval(() => {
      grid.classList.add('turning');
      setTimeout(() => {
        state.page = (state.page + 1) % pages.length;
        grid.innerHTML = pageHtml(pages[state.page], cols, rows, settings.leagues || {});
        grid.classList.remove('turning');
      }, FADE_MS);
    }, (settings.rotateSeconds || 8) * 1000);
  }

  async function fetchGames(container, state, settings) {
    try {
      const res = await fetch('/api/scores');
      const data = await res.json();
      state.data = { leagues: data.leagues || [], upcoming: data.upcoming || [] };
      render(container, state, settings);
    } catch (err) {
      clearInterval(state.pageTimer);
      container.innerHTML = '<div class="score-status">Scores unavailable</div>';
    }
  }

  window.NimbusModules = window.NimbusModules || {};
  window.NimbusModules.scoreboard = {
    mount(container, settings) {
      container.classList.add('scoreboard-module');
      const state = { data: null, page: 0, pageTimer: null, width: 0 };

      fetchGames(container, state, settings);
      const refreshId = setInterval(
        () => fetchGames(container, state, settings),
        (settings.refreshMinutes || 2) * 60 * 1000
      );

      // The column count depends on the module's width, which changes with
      // the layout (zone, orientation, scale) - re-lay out when it does.
      const observer = new ResizeObserver(() => {
        const width = Math.round(container.clientWidth);
        if (!state.data || width === state.width) return;
        state.width = width;
        render(container, state, settings);
      });
      observer.observe(container);

      return {
        destroy() {
          clearInterval(refreshId);
          clearInterval(state.pageTimer);
          observer.disconnect();
        },
      };
    },
  };
})();

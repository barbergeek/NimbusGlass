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
      <div class="${classes}" data-league="${esc(game.league)}" data-game-id="${esc(game.id)}">
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
   * panel, most of them holding a single game. Returns the favorites that
   * get a fixed spot (`pinned`) and everything that shares the rest.
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
   * Assigns the games to `count` on-screen slots. Favorites playing today
   * (or last night) each get a fixed slot of their own. Everything else is
   * grouped by sport, and each sport gets at least one slot - more if it has
   * more games, in proportion - so a slot always cycles within one sport
   * and its league tag never changes. If there are more sports than free
   * slots, the last slot cycles through the leftover sports together.
   *
   * Returns [{ key, games }], one per slot; a slot with more than one game
   * rotates through them in place.
   */
  function assignSlots({ pinned, rotating }, count) {
    let fixed = pinned;
    let pool = rotating;
    // Too many favorites to all stay put - let them rotate by sport too.
    if (fixed.length >= count && pinned.length + rotating.length > count) {
      fixed = [];
      pool = pinned.concat(rotating);
    }
    const slots = fixed.map((game) => ({ key: `fav:${game.id}`, games: [game] }));
    const free = count - slots.length;
    if (!pool.length || free <= 0) return slots;

    const groups = new Map(); // league -> games, in first-seen order
    for (const game of pool) {
      if (!groups.has(game.league)) groups.set(game.league, []);
      groups.get(game.league).push(game);
    }
    let entries = [...groups.entries()];
    if (entries.length > free) {
      const leftover = entries.slice(free - 1);
      entries = entries.slice(0, free - 1).concat([['mixed', leftover.flatMap(([, games]) => games)]]);
    }

    // One slot each, then hand out the rest to whichever sport has the most
    // games per slot, never more slots than it has games.
    const alloc = entries.map(() => 1);
    let spare = free - entries.length;
    while (spare > 0) {
      let best = -1;
      entries.forEach(([, games], i) => {
        if (alloc[i] >= games.length) return;
        if (best < 0 || games.length / alloc[i] > entries[best][1].length / alloc[best]) best = i;
      });
      if (best < 0) break;
      alloc[best] += 1;
      spare -= 1;
    }

    entries.forEach(([league, games], i) => {
      for (let k = 0; k < alloc[i]; k++) {
        slots.push({ key: `${league}:${k}`, games: games.filter((_, j) => j % alloc[i] === k) });
      }
    });
    return slots;
  }

  function rowElement(game, leagueSettings) {
    const holder = document.createElement('div');
    holder.innerHTML = gameRow(game, leagueSettings).trim();
    return holder.firstElementChild;
  }

  /**
   * Pins the column tracks to the widest values across every game in
   * rotation, not just the ones showing - otherwise a longer team name or
   * status swapping in would resize the column and nudge every other row.
   */
  function lockColumnWidths(grid, columns, allGames, leagueSettings) {
    const probe = document.createElement('div');
    probe.className = 'scoreboard-column';
    probe.style.cssText = `position:absolute;visibility:hidden;width:${columns[0].clientWidth}px;`;
    probe.innerHTML = allGames.map((game) => gameRow(game, leagueSettings)).join('');
    grid.appendChild(probe);
    const tracks = getComputedStyle(probe).gridTemplateColumns.split(' ');
    probe.remove();
    if (tracks.length !== 5) return;
    const fixedTracks = tracks.slice(0, 4).join(' ');
    columns.forEach((col) => {
      col.style.gridTemplateColumns = `${fixedTracks} minmax(0, 1fr)`;
    });
  }

  function columnCount(container) {
    const width = container.clientWidth || MIN_COLUMN_PX;
    return Math.max(1, Math.floor(width / MIN_COLUMN_PX));
  }

  function render(container, state, settings) {
    clearInterval(state.rotateTimer);
    const leagueSettings = settings.leagues || {};
    const { leagues, upcoming } = state.data;
    const ordered = orderGames(leagues, upcoming, leagueSettings);
    const total = ordered.pinned.length + ordered.rotating.length;
    if (!total) {
      container.innerHTML = '<div class="score-status">No games today</div>';
      return;
    }

    const maxRows = Math.max(1, Number(settings.maxRows) || 3);
    const cols = Math.min(columnCount(container), total);
    const slots = assignSlots(ordered, Math.min(total, cols * maxRows));

    const grid = document.createElement('div');
    grid.className = 'scoreboard-grid';
    grid.style.setProperty('--score-cols', cols);
    const columns = Array.from({ length: cols }, () => {
      const col = document.createElement('div');
      col.className = 'scoreboard-column';
      grid.appendChild(col);
      return col;
    });
    container.innerHTML = '';
    container.appendChild(grid);

    // Slots fill row by row; each remembers where it was in its rotation
    // across the 2-minute data refresh, so a long list still gets all the
    // way through instead of restarting from the top every refresh.
    const positions = state.positions;
    state.positions = {};
    const live = slots.map((slot, i) => {
      const pos = (positions[slot.key] || 0) % slot.games.length;
      state.positions[slot.key] = pos;
      const el = rowElement(slot.games[pos], leagueSettings);
      columns[i % cols].appendChild(el);
      return { ...slot, el };
    });
    // Measure once the bundled font is in - fallback-font widths would be wrong.
    const allGames = slots.flatMap((slot) => slot.games);
    document.fonts.ready.then(() => {
      if (grid.isConnected) lockColumnWidths(grid, columns, allGames, leagueSettings);
    });

    // Swap one rotating slot at a time, round-robin, so each one changes
    // every rotateSeconds but the panel never changes all at once.
    const rotating = live.filter((slot) => slot.games.length > 1);
    if (!rotating.length) return;
    let turn = 0;
    const stepMs = ((settings.rotateSeconds || 8) * 1000) / rotating.length;
    state.rotateTimer = setInterval(() => {
      const slot = rotating[turn % rotating.length];
      turn += 1;
      const pos = (state.positions[slot.key] + 1) % slot.games.length;
      state.positions[slot.key] = pos;
      slot.el.classList.add('swapping');
      setTimeout(() => {
        const next = rowElement(slot.games[pos], leagueSettings);
        next.classList.add('swapping');
        slot.el.replaceWith(next);
        slot.el = next;
        requestAnimationFrame(() => requestAnimationFrame(() => next.classList.remove('swapping')));
      }, FADE_MS);
    }, stepMs);
  }

  async function fetchGames(container, state, settings) {
    try {
      const res = await fetch('/api/scores');
      const data = await res.json();
      state.data = { leagues: data.leagues || [], upcoming: data.upcoming || [] };
      render(container, state, settings);
    } catch (err) {
      clearInterval(state.rotateTimer);
      container.innerHTML = '<div class="score-status">Scores unavailable</div>';
    }
  }

  // --- Tap a game for details ---------------------------------------------
  // The detail view lives on <body>, outside the module, so the scoreboard's
  // periodic re-render (and config pushes) can't tear it down mid-read.

  const DETAIL_AUTO_CLOSE_MS = 45 * 1000; // someone taps, reads, walks away
  const DETAIL_LIVE_REFRESH_MS = 30 * 1000;
  let detail = null; // { el, closeTimer, refreshTimer }

  function closeDetail() {
    if (!detail) return;
    clearTimeout(detail.closeTimer);
    clearInterval(detail.refreshTimer);
    detail.el.remove();
    detail = null;
  }

  function detailTeam(team, side) {
    const rank = team.rank ? `<span class="gd-rank">${esc(team.rank)}</span>` : '';
    return `
      <div class="gd-team ${side}${team.winner ? ' winner' : ''}">
        ${team.logo ? `<img class="gd-logo" src="${esc(team.logo)}" alt="" onerror="this.style.visibility='hidden'">` : ''}
        <div class="gd-team-name">${rank}${esc(team.name)}</div>
        ${team.record ? `<div class="gd-record">${esc(team.record)}</div>` : ''}
      </div>`;
  }

  function detailCenter(d) {
    if (d.state === 'pre') {
      return `<div class="gd-center"><div class="gd-at">@</div><div class="gd-start">${esc(dayAndTime(d.startTime))}</div></div>`;
    }
    return `
      <div class="gd-center">
        <div class="gd-score">
          <span class="${d.away.winner ? 'winner' : ''}">${esc(d.away.score ?? '-')}</span>
          <span class="score-sep">–</span>
          <span class="${d.home.winner ? 'winner' : ''}">${esc(d.home.score ?? '-')}</span>
        </div>
      </div>`;
  }

  function lineScore(d) {
    if (!d.periods.length) return '';
    const head = d.periods.map((p) => `<th>${esc(p)}</th>`).join('');
    const row = (team) =>
      `<tr><th class="gd-ls-team">${esc(team.abbreviation)}</th>${d.periods
        .map((_, i) => `<td>${esc(team.linescores[i] ?? '')}</td>`)
        .join('')}<td class="gd-ls-total">${esc(team.score ?? '')}</td></tr>`;
    return `<table class="gd-linescore"><tr><th></th>${head}<th>T</th></tr>${row(d.away)}${row(d.home)}</table>`;
  }

  function leadersBlock(d) {
    if (!d.leaders.length) return '';
    const title = d.leadersAre === 'season' ? 'Season leaders' : 'Game leaders';
    // Away team first, to match the matchup row above.
    const ordered = [...d.leaders].sort((a, b) => (b.team === d.away.abbreviation) - (a.team === d.away.abbreviation));
    const groups = ordered
      .map(
        (group) => `
        <div class="gd-leader-team">
          <div class="gd-leader-abbr">${esc(group.team)}</div>
          ${group.categories
            .map(
              (c) => `<div class="gd-leader"><span class="gd-leader-label">${esc(c.label.replace(/ Yards$/, ''))}</span>
                <span class="gd-leader-player">${esc(c.player)}</span>
                <span class="gd-leader-value">${esc(c.value)}</span></div>`
            )
            .join('')}
        </div>`
      )
      .join('');
    return `<div class="gd-block"><div class="gd-block-title">${title}</div><div class="gd-leaders">${groups}</div></div>`;
  }

  function sideBlock(d) {
    if (d.scoringPlays.length) {
      const plays = d.scoringPlays
        .map(
          (p) => `<div class="gd-play">
            <span class="gd-play-team">${esc(p.team || '')}</span>
            <span class="gd-play-text">${esc(p.text)}</span>
            ${p.awayScore != null ? `<span class="gd-play-score">${esc(p.awayScore)}–${esc(p.homeScore)}</span>` : ''}
          </div>`
        )
        .join('');
      return `<div class="gd-block"><div class="gd-block-title">Latest scoring</div>${plays}</div>`;
    }
    const lines = [];
    if (d.winChance) {
      const fav = d.winChance.home >= d.winChance.away ? d.home : d.away;
      lines.push(`<div class="gd-fact"><span>Win chance</span>${esc(fav.abbreviation)} ${esc(Math.round(Math.max(d.winChance.home, d.winChance.away)))}%</div>`);
    }
    if (d.odds && d.odds.line) lines.push(`<div class="gd-fact"><span>Line</span>${esc(d.odds.line)}</div>`);
    if (d.odds && d.odds.overUnder != null) lines.push(`<div class="gd-fact"><span>Over/under</span>${esc(d.odds.overUnder)}</div>`);
    return lines.length ? `<div class="gd-block"><div class="gd-block-title">Matchup</div>${lines.join('')}</div>` : '';
  }

  function detailHtml(d) {
    const league = LEAGUE_ABBREVIATIONS[d.league] || d.league;
    const status = d.state === 'pre' ? '' : `<span class="gd-status${d.state === 'in' ? ' live' : ''}">${esc(d.statusDetail)}</span>`;
    const where = [d.venue && d.venue.name, d.venue && d.venue.city].filter(Boolean).join(' · ');
    const crowd = d.attendance ? ` · ${Number(d.attendance).toLocaleString()} attending` : '';
    return `
      <div class="gd-card">
        <div class="gd-header">
          <span class="score-league-tag">${esc(league)}</span>
          ${status}
          ${d.broadcasts.length ? `<span class="gd-tv">${esc(d.broadcasts.join(' · '))}</span>` : ''}
        </div>
        <div class="gd-matchup">
          ${detailTeam(d.away, 'away')}
          ${detailCenter(d)}
          ${detailTeam(d.home, 'home')}
        </div>
        ${lineScore(d)}
        <div class="gd-body">
          ${leadersBlock(d)}
          ${sideBlock(d)}
        </div>
        <div class="gd-footer">
          <span>${esc(where)}${esc(crowd)}</span>
          <span class="gd-close-hint">Tap to close</span>
        </div>
      </div>`;
  }

  async function loadDetail(league, id) {
    const res = await fetch(`/api/scores/${encodeURIComponent(league)}/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || res.status);
    return data;
  }

  async function openDetail(league, id) {
    closeDetail();
    const el = document.createElement('div');
    el.id = 'game-detail';
    el.innerHTML = '<div class="gd-card gd-loading">Loading…</div>';
    el.addEventListener('click', closeDetail);
    document.body.appendChild(el);
    const current = { el, closeTimer: setTimeout(closeDetail, DETAIL_AUTO_CLOSE_MS), refreshTimer: null };
    detail = current;

    const show = async () => {
      try {
        const data = await loadDetail(league, id);
        if (detail !== current) return; // closed or replaced while loading
        el.innerHTML = detailHtml(data);
        if (data.state === 'in' && !current.refreshTimer) {
          current.refreshTimer = setInterval(show, DETAIL_LIVE_REFRESH_MS);
        }
      } catch (err) {
        if (detail === current) el.innerHTML = '<div class="gd-card gd-loading">Game details unavailable</div>';
      }
    };
    show();
  }

  window.NimbusModules = window.NimbusModules || {};
  window.NimbusModules.scoreboard = {
    mount(container, settings) {
      container.classList.add('scoreboard-module');
      // One handler on the module rather than per row: rotating slots swap
      // their row elements every few seconds.
      const onTap = (e) => {
        const row = e.target.closest('.score-row[data-game-id]');
        if (row) openDetail(row.dataset.league, row.dataset.gameId);
      };
      container.addEventListener('click', onTap);
      const state = { data: null, positions: {}, rotateTimer: null, width: 0 };

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
          clearInterval(state.rotateTimer);
          observer.disconnect();
          container.removeEventListener('click', onTap);
        },
      };
    },
  };
})();

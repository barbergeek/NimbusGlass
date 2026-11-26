(function () {
  // Mirrors the keys in src/server/providers/leaguePaths.js - only needs an
  // entry where the config key itself is too wide for the mirror display.
  const LEAGUE_ABBREVIATIONS = {
    'English Premier League': 'EPL',
  };

  // Game data comes from ESPN (via the server) and league names from
  // config, which any device on the network can set - escape all of it
  // before it goes into innerHTML.
  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function isGameFavorite(game, favorites) {
    return favorites.includes(game.home.abbreviation) || favorites.includes(game.away.abbreviation);
  }

  // Scoreboard images only - hide a dead/renamed logo URL rather than
  // showing a broken-image icon on the kiosk display.
  function teamLogo(team) {
    return team.logo ? `<img class="score-logo" src="${esc(team.logo)}" alt="" onerror="this.style.display='none'">` : '';
  }

  /** "Fri 3:00 PM" in the mirror's local time. */
  function upcomingTime(startTime) {
    return new Date(startTime).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }

  function gameCard(game, favorite) {
    const awayWin = game.away.winner;
    const homeWin = game.home.winner;
    const upcoming = game.when === 'upcoming';
    // Upcoming games have no score yet - show "AWAY @ HOME" instead of 0 - 0.
    const middle = upcoming
      ? `<span class="score-sep">@</span>`
      : `<span class="score-value">${esc(game.away.score ?? '-')}</span>
          <span class="score-sep">–</span>
          <span class="score-value">${esc(game.home.score ?? '-')}</span>`;
    let meta;
    if (upcoming) {
      const league = LEAGUE_ABBREVIATIONS[game.league] || game.league;
      meta = `<span class="score-league-tag">${esc(league)}</span>
          <span class="score-status">${esc(upcomingTime(game.startTime))}</span>`;
    } else {
      meta = `${game.when === 'yesterday' ? '<span class="score-when">Yesterday</span>' : ''}
          <span class="score-status">${esc(game.statusDetail)}</span>`;
    }
    const classes = ['score-card', favorite ? 'favorite' : '', game.when === 'yesterday' ? 'yesterday' : '']
      .filter(Boolean)
      .join(' ');
    return `
      <div class="${classes}">
        <div class="score-teams">
          ${teamLogo(game.away)}
          <span class="score-team${awayWin ? ' winner' : ''}">${esc(game.away.abbreviation)}</span>
          ${middle}
          <span class="score-team${homeWin ? ' winner' : ''}">${esc(game.home.abbreviation)}</span>
          ${teamLogo(game.home)}
        </div>
        <div class="score-meta">
          ${meta}
          ${game.broadcast ? `<span class="score-network">${esc(game.broadcast)}</span>` : ''}
        </div>
      </div>
    `;
  }

  function leagueSection(league, games, favorites) {
    const section = document.createElement('div');
    section.className = 'scoreboard-league';
    const label = LEAGUE_ABBREVIATIONS[league] || league;

    const pinned = games.filter((game) => isGameFavorite(game, favorites));
    const rest = games.filter((game) => !isGameFavorite(game, favorites));

    const pinnedHtml = pinned.length
      ? `<div class="scoreboard-pinned">${pinned.map((g) => gameCard(g, true)).join('')}</div>`
      : '';
    const restHtml = rest.length
      ? `<div class="scoreboard-games">${rest.map((g) => gameCard(g, false)).join('')}</div>`
      : '';

    section.innerHTML = `
      <div class="scoreboard-league-name">${esc(label)}</div>
      ${pinnedHtml}
      ${restHtml}
    `;
    return section;
  }

  /**
   * Favorites' next games across all leagues, soonest first, in one row -
   * a row per league would stack five or six rows on a small panel. It's a
   * scrolling track like any other, so it rotates when it overflows.
   */
  function upcomingSection(games) {
    const section = document.createElement('div');
    section.className = 'scoreboard-league scoreboard-upcoming';
    section.innerHTML = `
      <div class="scoreboard-league-name">Next</div>
      <div class="scoreboard-games">${games.map((g) => gameCard(g, true)).join('')}</div>
    `;
    return section;
  }

  function render(container, leagues, upcoming, leagueSettings) {
    container.innerHTML = '';
    const withGames = leagues.filter(({ games, error }) => !error && games.length);
    if (!withGames.length && !upcoming.length) {
      container.innerHTML = '<div class="score-status">No games today</div>';
      return;
    }
    for (const { league, games } of withGames) {
      const favorites = (leagueSettings[league] && leagueSettings[league].favorites) || [];
      container.appendChild(leagueSection(league, games, favorites));
    }
    if (upcoming.length) container.appendChild(upcomingSection(upcoming));
  }

  /** Eases scrollLeft from its current value to `target` over `durationMs`, then calls `onDone`. */
  function animateScroll(track, target, durationMs, onDone) {
    const start = track.scrollLeft;
    const change = target - start;
    if (!change) {
      if (onDone) onDone();
      return;
    }
    const startTime = performance.now();
    function step(now) {
      const t = Math.min(1, (now - startTime) / durationMs);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out
      track.scrollLeft = start + change * eased;
      if (t < 1) requestAnimationFrame(step);
      else if (onDone) onDone();
    }
    requestAnimationFrame(step);
  }

  /** A card's left edge within the track's scrollable content, regardless of CSS positioning context. */
  function cardOffset(track, card) {
    // getBoundingClientRect is in screen pixels, after the display-scale
    // transform (config.scale); scrollLeft is in the track's own layout
    // pixels. Convert so the two agree at any scale.
    const trackRect = track.getBoundingClientRect();
    const ratio = track.offsetWidth ? trackRect.width / track.offsetWidth : 1;
    return (card.getBoundingClientRect().left - trackRect.left) / (ratio || 1) + track.scrollLeft;
  }

  /**
   * Favorite teams' cards live in `.scoreboard-pinned`, which never scrolls -
   * they stay on screen. Everything else is in `.scoreboard-games`, which
   * rotates sideways on an interval, one card at a time, when it has more
   * games than fit (EPL on a full weekend slate, NCAAF on a Saturday); a row
   * that already fits is left alone, static.
   *
   * Cards vary in width (status/network text differs per game), so each
   * step targets the next card's actual left edge rather than advancing by
   * a fixed pixel amount - a fixed step drifts out of alignment with card
   * boundaries as soon as cards aren't all the same width.
   *
   * To rotate in one direction forever instead of bouncing back to the
   * start, the card list is duplicated once - scrolling past the first copy
   * lands on pixel-identical content from the second, so snapping back by
   * exactly one copy's width is an invisible reset rather than a visible
   * jump.
   */
  function startAutoScroll(container, intervalSeconds) {
    const timers = [];
    container.querySelectorAll('.scoreboard-games').forEach((track) => {
      if (track.scrollWidth <= track.clientWidth + 4) return;

      const originalWidth = track.scrollWidth;
      [...track.children].forEach((card) => track.appendChild(card.cloneNode(true)));

      const glideMs = Math.min(1800, intervalSeconds * 1000 * 0.6);

      const timer = setInterval(() => {
        const cards = [...track.children];
        const next = cards.find((card) => cardOffset(track, card) > track.scrollLeft + 2);
        if (!next) return;
        animateScroll(track, cardOffset(track, next), glideMs, () => {
          if (track.scrollLeft >= originalWidth - 2) track.scrollLeft -= originalWidth;
        });
      }, intervalSeconds * 1000);
      timers.push(timer);
    });
    return timers;
  }

  async function fetchGames(container, state, settings) {
    try {
      const res = await fetch('/api/scores');
      const data = await res.json();
      render(container, data.leagues || [], data.upcoming || [], settings.leagues || {});
    } catch (err) {
      container.innerHTML = '<div class="score-status">Scores unavailable</div>';
    }
    state.scrollTimers.forEach(clearInterval);
    state.scrollTimers = startAutoScroll(container, settings.rotateSeconds || 8);
  }

  window.NimbusModules = window.NimbusModules || {};
  window.NimbusModules.scoreboard = {
    mount(container, settings) {
      container.classList.add('scoreboard-module');
      const state = { scrollTimers: [] };

      fetchGames(container, state, settings);
      const refreshId = setInterval(
        () => fetchGames(container, state, settings),
        (settings.refreshMinutes || 2) * 60 * 1000
      );

      return {
        destroy() {
          clearInterval(refreshId);
          state.scrollTimers.forEach(clearInterval);
        },
      };
    },
  };
})();

(function () {
  // Mirrors the keys in src/server/providers/leaguePaths.js - only needs an
  // entry where the config key itself is too wide for the mirror display.
  const LEAGUE_ABBREVIATIONS = {
    'English Premier League': 'EPL',
  };

  function isGameFavorite(game, favorites) {
    return favorites.includes(game.home.abbreviation) || favorites.includes(game.away.abbreviation);
  }

  // Scoreboard images only - hide a dead/renamed logo URL rather than
  // showing a broken-image icon on the kiosk display.
  function teamLogo(team) {
    return team.logo ? `<img class="score-logo" src="${team.logo}" alt="" onerror="this.style.display='none'">` : '';
  }

  function gameCard(game, favorite) {
    const awayWin = game.away.winner;
    const homeWin = game.home.winner;
    return `
      <div class="score-card${favorite ? ' favorite' : ''}">
        <div class="score-teams">
          ${teamLogo(game.away)}
          <span class="score-team${awayWin ? ' winner' : ''}">${game.away.abbreviation}</span>
          <span class="score-value">${game.away.score ?? '-'}</span>
          <span class="score-sep">–</span>
          <span class="score-value">${game.home.score ?? '-'}</span>
          <span class="score-team${homeWin ? ' winner' : ''}">${game.home.abbreviation}</span>
          ${teamLogo(game.home)}
        </div>
        <div class="score-meta">
          <span class="score-status">${game.statusDetail}</span>
          ${game.broadcast ? `<span class="score-network">${game.broadcast}</span>` : ''}
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
      <div class="scoreboard-league-name">${label}</div>
      ${pinnedHtml}
      ${restHtml}
    `;
    return section;
  }

  function render(container, leagues, leagueSettings) {
    container.innerHTML = '';
    const withGames = leagues.filter(({ games, error }) => !error && games.length);
    if (!withGames.length) {
      container.innerHTML = '<div class="score-status">No games today</div>';
      return;
    }
    for (const { league, games } of withGames) {
      const favorites = (leagueSettings[league] && leagueSettings[league].favorites) || [];
      container.appendChild(leagueSection(league, games, favorites));
    }
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
    return card.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft;
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
      render(container, data.leagues || [], settings.leagues || {});
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

(function () {
  const socket = io();
  const statusEl = document.getElementById('status');

  // Mirrors the keys supported by src/server/providers/sports.js LEAGUE_PATHS.
  const AVAILABLE_LEAGUES = ['NFL', 'NHL', 'MLB', 'English Premier League', 'NCAAF', 'NCAAM'];

  let currentConfig = null;
  let activeLeague = AVAILABLE_LEAGUES[0];
  let activeLeagueSearch = '';
  const teamsByLeague = new Map(); // league -> Promise<team[]>, fetched once and reused across tab switches
  const conferencesByLeague = new Map(); // league -> Promise<conference[]>, same deal

  function flash() {
    statusEl.classList.add('visible');
    setTimeout(() => statusEl.classList.remove('visible'), 1200);
  }

  function send(patch) {
    socket.emit('config:set', patch);
    flash();
  }

  function updatePreview(config) {
    const frame = document.getElementById('preview-frame');
    const wrapper = document.getElementById('preview-wrapper');
    const [presetW, presetH] = document.getElementById('preview-size-select').value.split('x').map(Number);
    const landscape = config.orientation !== 'portrait';
    const sourceW = landscape ? presetW : presetH;
    const sourceH = landscape ? presetH : presetW;

    const maxPreviewWidth = 480; // fits comfortably inside the admin card
    const scale = Math.min(1, maxPreviewWidth / sourceW);

    frame.style.width = `${sourceW}px`;
    frame.style.height = `${sourceH}px`;
    frame.style.transform = `scale(${scale})`;
    wrapper.style.width = `${Math.round(sourceW * scale)}px`;
    wrapper.style.height = `${Math.round(sourceH * scale)}px`;
  }

  function zoneOfModule(config, moduleId) {
    for (const [zone, ids] of Object.entries(config.layout)) {
      if (ids.includes(moduleId)) return zone;
    }
    return '';
  }

  function buildLayoutWithModuleInZone(config, moduleId, targetZone) {
    const layout = {};
    for (const zone of config.zones) {
      layout[zone] = (config.layout[zone] || []).filter((id) => id !== moduleId);
    }
    if (targetZone) layout[targetZone].push(moduleId);
    return layout;
  }

  /** One draggable row: enable toggle, label, zone-reassign dropdown. */
  function buildModuleRow(config, moduleId) {
    const moduleConfig = config.modules[moduleId];
    const item = document.createElement('li');
    item.className = 'module-row';
    item.draggable = true;
    item.dataset.moduleId = moduleId;

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'toggle';
    toggle.draggable = false;
    toggle.checked = moduleConfig.enabled;
    toggle.addEventListener('change', () => {
      send({ modules: { [moduleId]: { enabled: toggle.checked } } });
    });

    const label = document.createElement('div');
    label.textContent = moduleConfig.label || moduleId;

    const zoneSelect = document.createElement('select');
    zoneSelect.draggable = false;
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '— unassigned —';
    zoneSelect.appendChild(noneOpt);
    for (const zone of config.zones) {
      const opt = document.createElement('option');
      opt.value = zone;
      opt.textContent = zone;
      zoneSelect.appendChild(opt);
    }
    zoneSelect.value = zoneOfModule(config, moduleId);
    zoneSelect.addEventListener('change', () => {
      send({ layout: buildLayoutWithModuleInZone(currentConfig, moduleId, zoneSelect.value) });
    });

    item.append(toggle, label, zoneSelect);
    return item;
  }

  function renderModuleRows(config) {
    const container = document.getElementById('module-rows');
    container.innerHTML = '';

    const assignedZones = config.zones.filter((z) => (config.layout[z] || []).length > 0);
    const unassigned = Object.keys(config.modules).filter((id) => !zoneOfModule(config, id));

    for (const zone of assignedZones) {
      const group = document.createElement('div');
      group.className = 'zone-order-group';

      const heading = document.createElement('h3');
      heading.textContent = zone;
      group.appendChild(heading);

      const list = document.createElement('ul');
      list.className = 'zone-order-list';
      list.dataset.zone = zone;
      for (const moduleId of config.layout[zone]) {
        list.appendChild(buildModuleRow(config, moduleId));
      }
      group.appendChild(list);
      container.appendChild(group);
    }

    if (unassigned.length) {
      const group = document.createElement('div');
      group.className = 'zone-order-group';

      const heading = document.createElement('h3');
      heading.textContent = 'Unassigned';
      group.appendChild(heading);

      const list = document.createElement('ul');
      list.className = 'zone-order-list';
      list.dataset.zone = ''; // dragging has nothing to reorder here, but the dropdown still works
      for (const moduleId of unassigned) {
        const row = buildModuleRow(config, moduleId);
        row.draggable = false;
        list.appendChild(row);
      }
      group.appendChild(list);
      container.appendChild(group);
    }

    wireModuleRowDragAndDrop();
  }

  function dragAfterElement(list, y) {
    const items = [...list.querySelectorAll('li:not(.dragging)')];
    return items.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        return offset < 0 && offset > closest.offset ? { offset, element: child } : closest;
      },
      { offset: Number.NEGATIVE_INFINITY, element: null }
    ).element;
  }

  function wireModuleRowDragAndDrop() {
    document.querySelectorAll('.zone-order-list[data-zone]').forEach((list) => {
      if (!list.dataset.zone) return; // unassigned group - nothing to reorder

      list.addEventListener('dragstart', (e) => {
        e.target.closest('li').classList.add('dragging');
      });

      list.addEventListener('dragend', (e) => {
        e.target.closest('li').classList.remove('dragging');
        const order = [...list.querySelectorAll('li')].map((li) => li.dataset.moduleId);
        send({ layout: { [list.dataset.zone]: order } });
      });

      list.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = list.querySelector('.dragging');
        if (!dragging) return;
        const after = dragAfterElement(list, e.clientY);
        if (after == null) {
          list.appendChild(dragging);
        } else {
          list.insertBefore(dragging, after);
        }
      });
    });
  }

  function leagueSettings(config, league) {
    return config.modules.scoreboard.settings.leagues[league] || { enabled: false, favorites: [], conferences: [] };
  }

  function setLeagueSettings(league, patch) {
    send({ modules: { scoreboard: { settings: { leagues: { [league]: patch } } } } });
  }

  /** Fetch a league's team roster once (ESPN "teams" endpoint), reused across tab switches. */
  function getTeams(league) {
    if (!teamsByLeague.has(league)) {
      teamsByLeague.set(
        league,
        fetch(`/api/teams/${encodeURIComponent(league)}`)
          .then((res) => res.json())
          .then((data) => data.teams || [])
          .catch(() => [])
      );
    }
    return teamsByLeague.get(league);
  }

  /** Fetch a league's conference list once (ESPN "standings" endpoint) - empty for leagues with no conference split (e.g. soccer). */
  function getConferences(league) {
    if (!conferencesByLeague.has(league)) {
      conferencesByLeague.set(
        league,
        fetch(`/api/conferences/${encodeURIComponent(league)}`)
          .then((res) => res.json())
          .then((data) => data.conferences || [])
          .catch(() => [])
      );
    }
    return conferencesByLeague.get(league);
  }

  function teamMatchesSearch(team, query) {
    if (!query) return true;
    const haystack = `${team.location} ${team.name} ${team.displayName} ${team.abbreviation}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  }

  function renderLeagueTabs(config) {
    const container = document.getElementById('league-tabs');
    container.innerHTML = '';
    for (const league of AVAILABLE_LEAGUES) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'league-tab';
      if (league === activeLeague) tab.classList.add('active');
      if (leagueSettings(config, league).enabled) tab.classList.add('enabled');
      tab.textContent = league;
      tab.addEventListener('click', () => {
        activeLeague = league;
        activeLeagueSearch = '';
        renderLeagueTabs(currentConfig);
        renderLeaguePanel(currentConfig);
      });
      container.appendChild(tab);
    }
  }

  async function renderLeaguePanel(config) {
    const league = activeLeague;
    const panel = document.getElementById('league-panel');
    const settings = leagueSettings(config, league);

    panel.innerHTML = '';

    const enableRow = document.createElement('label');
    enableRow.className = 'row';
    const enableToggle = document.createElement('input');
    enableToggle.type = 'checkbox';
    enableToggle.className = 'toggle';
    enableToggle.checked = settings.enabled;
    enableToggle.addEventListener('change', () => setLeagueSettings(league, { enabled: enableToggle.checked }));
    enableRow.append(enableToggle, document.createTextNode(`Show ${league} on the mirror`));
    panel.appendChild(enableRow);

    const favoritesHeading = document.createElement('h3');
    favoritesHeading.className = 'panel-subheading';
    favoritesHeading.textContent = 'Favorite teams';
    panel.appendChild(favoritesHeading);
    const favoritesHint = document.createElement('p');
    favoritesHint.className = 'hint';
    favoritesHint.textContent = 'Always shown first, if they have a game today.';
    panel.appendChild(favoritesHint);
    const favoritesHost = document.createElement('div');
    favoritesHost.id = 'favorites-picker-host';
    panel.appendChild(favoritesHost);
    await renderFavoritesPicker(league, settings.favorites);

    const conferencesHost = document.createElement('div');
    conferencesHost.id = 'conference-picker-host';
    panel.appendChild(conferencesHost);
    await renderConferencePicker(league, settings.conferences);
  }

  async function renderFavoritesPicker(league, selectedTeams) {
    const host = document.getElementById('favorites-picker-host');
    if (!host) return;
    host.innerHTML = '<p class="hint">Loading teams…</p>';

    const teams = await getTeams(league);
    if (activeLeague !== league) return; // user switched tabs while this was loading

    const selected = new Set(selectedTeams);
    host.innerHTML = '';

    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = `Search ${league} teams by city, school, or name…`;
    search.value = activeLeagueSearch;
    search.addEventListener('input', () => {
      activeLeagueSearch = search.value;
      renderTeamList(list, teams, selected, league);
    });
    host.appendChild(search);

    const list = document.createElement('div');
    list.className = 'team-search-results';
    host.appendChild(list);

    renderTeamList(list, teams, selected, league);
  }

  function renderTeamList(list, teams, selected, league) {
    list.innerHTML = '';
    const matches = teams.filter((team) => teamMatchesSearch(team, activeLeagueSearch));
    if (!matches.length) {
      list.innerHTML = '<p class="hint">No teams match.</p>';
      return;
    }
    for (const team of matches) {
      const label = document.createElement('label');
      label.className = 'team-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected.has(team.abbreviation);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(team.abbreviation);
        else selected.delete(team.abbreviation);
        setLeagueSettings(league, { favorites: [...selected] });
      });
      label.append(checkbox, document.createTextNode(`${team.location} ${team.name}`));
      list.appendChild(label);
    }
  }

  async function renderConferencePicker(league, selectedConferences) {
    const host = document.getElementById('conference-picker-host');
    if (!host) return;
    host.innerHTML = '';

    const conferences = await getConferences(league);
    if (activeLeague !== league) return; // user switched tabs while this was loading
    if (!conferences.length) return; // this league has no conference split (e.g. soccer)

    const heading = document.createElement('h3');
    heading.className = 'panel-subheading';
    heading.textContent = 'Conferences';
    host.appendChild(heading);
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent =
      'Other games shown after favorites. Leave both empty for the whole league; pick favorites with no conferences for just your favorites.';
    host.appendChild(hint);

    const selected = new Set(selectedConferences);
    const list = document.createElement('div');
    list.className = 'team-search-results';
    for (const conference of conferences) {
      const label = document.createElement('label');
      label.className = 'team-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected.has(conference.abbreviation);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(conference.abbreviation);
        else selected.delete(conference.abbreviation);
        setLeagueSettings(league, { conferences: [...selected] });
      });
      label.append(checkbox, document.createTextNode(conference.name));
      list.appendChild(label);
    }
    host.appendChild(list);
  }

  function renderForm(config) {
    currentConfig = config;

    updatePreview(config);

    document.getElementById('theme-select').value = config.theme;
    document.getElementById('orientation-select').value = config.orientation;

    document.getElementById('location-city').value = config.location.city || '';
    document.getElementById('location-country').value = config.location.country || '';

    document.getElementById('weather-units').value = config.modules.weather.settings.units;
    document.getElementById('weather-apikey').value = config.modules.weather.settings.apiKey || '';

    document.getElementById('holidays-count').value = config.modules.holidays.settings.count;

    document.getElementById('scoreboard-rotate').value = config.modules.scoreboard.settings.rotateSeconds;

    renderModuleRows(config);
    renderLeagueTabs(config);
    renderLeaguePanel(config);
  }

  document.getElementById('preview-size-select').addEventListener('change', () => {
    if (currentConfig) updatePreview(currentConfig);
  });

  document.getElementById('theme-select').addEventListener('change', (e) => send({ theme: e.target.value }));
  document.getElementById('orientation-select').addEventListener('change', (e) => send({ orientation: e.target.value }));

  document.getElementById('location-city').addEventListener('change', (e) =>
    send({ location: { city: e.target.value } })
  );
  document.getElementById('location-country').addEventListener('change', (e) =>
    send({ location: { country: e.target.value.trim().toUpperCase() } })
  );

  document.getElementById('weather-units').addEventListener('change', (e) =>
    send({ modules: { weather: { settings: { units: e.target.value } } } })
  );
  document.getElementById('weather-apikey').addEventListener('change', (e) =>
    send({ modules: { weather: { settings: { apiKey: e.target.value } } } })
  );

  document.getElementById('holidays-count').addEventListener('change', (e) =>
    send({ modules: { holidays: { settings: { count: Number(e.target.value) } } } })
  );

  document.getElementById('scoreboard-rotate').addEventListener('change', (e) =>
    send({ modules: { scoreboard: { settings: { rotateSeconds: Number(e.target.value) } } } })
  );

  // Server pushes the current config on connect, and again on every change
  // (including ones made from this very form) - that round trip is what
  // keeps the admin console and mirror display in sync.
  socket.on('config:update', renderForm);
})();

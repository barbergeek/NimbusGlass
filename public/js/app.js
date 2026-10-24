(function () {
  const grid = document.getElementById('mirror-grid');
  const socket = io();
  let mounted = []; // [{ handle }] for every currently-live module instance

  grid.innerHTML = '<div style="color:#8a90b8;padding:24px;font-size:1.1rem;">Connecting to NimbusGlass…</div>';

  function teardown() {
    for (const { handle } of mounted) {
      if (handle && typeof handle.destroy === 'function') handle.destroy();
    }
    mounted = [];
    grid.innerHTML = '';
  }

  function mountZone(parent, zoneName, config) {
    const zoneEl = document.createElement('div');
    zoneEl.className = 'zone';
    zoneEl.dataset.zone = zoneName;
    parent.appendChild(zoneEl);

    const moduleIds = config.layout[zoneName] || [];
    for (const moduleId of moduleIds) {
      const moduleConfig = config.modules[moduleId];
      if (!moduleConfig || !moduleConfig.enabled) continue;

      const moduleImpl = window.NimbusModules && window.NimbusModules[moduleId];
      if (!moduleImpl) {
        console.warn(`NimbusGlass: no module implementation registered for "${moduleId}"`);
        continue;
      }

      const card = document.createElement('div');
      card.className = 'module-card';
      zoneEl.appendChild(card);

      const handle = moduleImpl.mount(card, moduleConfig.settings);
      mounted.push({ handle });
    }
  }

  function renderConfig(config) {
    teardown();

    document.body.dataset.theme = config.theme;
    document.documentElement.dataset.theme = config.theme;
    document.body.dataset.orientation = config.orientation || 'landscape';

    // Each of the three columns (left/center/right) is its own independent
    // flex container - a column's row heights are driven by that column's
    // own content only, never forced to match the other two columns' zones.
    const columns = { left: [], center: [], right: [] };
    let bottomBarZone = null;
    for (const zoneName of config.zones) {
      if (zoneName === 'bottom-bar') {
        bottomBarZone = zoneName;
      } else if (zoneName.endsWith('-left')) {
        columns.left.push(zoneName);
      } else if (zoneName.endsWith('-center')) {
        columns.center.push(zoneName);
      } else if (zoneName.endsWith('-right')) {
        columns.right.push(zoneName);
      }
    }

    const columnsRow = document.createElement('div');
    columnsRow.className = 'columns-row';
    grid.appendChild(columnsRow);

    for (const columnName of ['left', 'center', 'right']) {
      const columnEl = document.createElement('div');
      columnEl.className = 'column';
      columnEl.dataset.column = columnName;
      columnsRow.appendChild(columnEl);

      for (const zoneName of columns[columnName]) {
        mountZone(columnEl, zoneName, config);
      }
    }

    if (bottomBarZone) {
      mountZone(grid, bottomBarZone, config);
    }
  }

  socket.on('config:update', renderConfig);
})();

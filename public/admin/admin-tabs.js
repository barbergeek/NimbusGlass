// Admin console tabs. The selected tab lives in the URL hash (#sports etc.)
// so a reload, bookmark or back button lands on the same tab.
(function () {
  const tabs = [...document.querySelectorAll('.admin-tab')];
  const ids = tabs.map((tab) => tab.dataset.tab);

  function show(id) {
    if (!ids.includes(id)) id = ids[0];
    for (const tab of tabs) {
      const active = tab.dataset.tab === id;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(`tab-${tab.dataset.tab}`).hidden = !active;
    }
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      history.replaceState(null, '', `#${tab.dataset.tab}`);
      show(tab.dataset.tab);
    });
  }

  // Arrow keys move between tabs, per the WAI-ARIA tabs pattern.
  document.querySelector('.admin-tabs').addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    const current = tabs.findIndex((tab) => tab.classList.contains('active'));
    const next = tabs[(current + step + tabs.length) % tabs.length];
    next.focus();
    next.click();
  });

  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(location.hash.slice(1));
})();

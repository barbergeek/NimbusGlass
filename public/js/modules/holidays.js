(function () {
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render(container, data) {
    if (data.error) {
      container.innerHTML = `<div class="holidays-status">Holidays unavailable: ${escapeHtml(data.error)}</div>`;
      return;
    }
    if (!data.holidays.length) {
      container.innerHTML = `<div class="holidays-status">No upcoming holidays found</div>`;
      return;
    }
    container.innerHTML = `
      <ul class="holidays-list">
        ${data.holidays
          .map((h) => {
            const d = new Date(`${h.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            return `<li><span class="holiday-date">${d}</span><span class="holiday-name">${escapeHtml(h.name)}</span></li>`;
          })
          .join('')}
      </ul>
    `;
    trimToFitColumn(container);
  }

  /**
   * Zones size to their own content (see grid.css), so this module's
   * configured count isn't capped by a fixed zone height - but a column's
   * *total* content can still exceed the column's own height (e.g. a large
   * configured count, or several modules stacked in one zone). Rather than
   * let that clip mid-item via the column's overflow:hidden safety net,
   * drop trailing holidays one at a time until the column fits, so what's
   * shown is always a clean "up to N" list, never a half-cut-off entry.
   */
  function trimToFitColumn(container) {
    const column = container.closest('.column');
    const list = container.querySelector('.holidays-list');
    if (!column || !list) return;

    let guard = 0;
    while (column.scrollHeight > column.clientHeight && list.children.length > 1 && guard < 50) {
      list.removeChild(list.lastElementChild);
      guard++;
    }
  }

  async function refresh(container) {
    try {
      const res = await fetch('/api/holidays');
      const data = await res.json();
      render(container, data);
    } catch (err) {
      container.innerHTML = `<div class="holidays-status">Holidays unavailable</div>`;
    }
  }

  window.NimbusModules = window.NimbusModules || {};
  window.NimbusModules.holidays = {
    mount(container, settings) {
      container.classList.add('holidays-module');
      refresh(container);
      const intervalId = setInterval(() => refresh(container), (settings.refreshHours || 12) * 60 * 60 * 1000);
      return {
        destroy() {
          clearInterval(intervalId);
        },
      };
    },
  };
})();

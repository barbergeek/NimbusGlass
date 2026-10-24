(function () {
  function render(container, settings) {
    container.innerHTML = `
      <div class="clock-time"></div>
      <div class="clock-date"></div>
      <ul class="clock-events"></ul>
    `;
    tick(container, settings);
    const interval = setInterval(() => tick(container, settings), 1000);
    return interval;
  }

  function tick(container, settings) {
    const now = new Date();
    const timeEl = container.querySelector('.clock-time');
    const dateEl = container.querySelector('.clock-date');

    const hours24 = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    let timeStr;
    if (settings.format24h) {
      timeStr = `${String(hours24).padStart(2, '0')}:${minutes}`;
    } else {
      const h12 = hours24 % 12 || 12;
      const ampm = hours24 < 12 ? 'AM' : 'PM';
      timeStr = `${h12}:${minutes} ${ampm}`;
    }
    if (settings.showSeconds) timeStr += `:${seconds}`;
    timeEl.textContent = timeStr;

    if (settings.showDate) {
      dateEl.textContent = now.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
      dateEl.style.display = '';
    } else {
      dateEl.style.display = 'none';
    }

    const eventsEl = container.querySelector('.clock-events');
    const upcoming = (settings.events || [])
      .filter((e) => new Date(e.date) >= now)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 3);
    eventsEl.innerHTML = upcoming
      .map((e) => {
        const d = new Date(e.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        return `<li>${d} — ${escapeHtml(e.label)}</li>`;
      })
      .join('');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.NimbusModules = window.NimbusModules || {};
  window.NimbusModules.clock = {
    mount(container, settings) {
      container.classList.add('clock-module');
      const intervalId = render(container, settings);
      return {
        destroy() {
          clearInterval(intervalId);
        },
      };
    },
  };
})();

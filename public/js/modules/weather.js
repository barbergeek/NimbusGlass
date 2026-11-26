(function () {
  const ICON_URL = (icon) => `https://openweathermap.org/img/wn/${encodeURIComponent(icon)}@2x.png`;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render(container, data) {
    if (data.error) {
      container.innerHTML = `<div class="weather-condition">Weather unavailable: ${escapeHtml(data.error)}</div>`;
      return;
    }
    const { current, forecast, location } = data;
    // Everything below comes from the upstream weather API via the server -
    // escape it all before it goes into innerHTML.
    const esc = escapeHtml;
    container.innerHTML = `
      ${location ? `<div class="weather-location">${escapeHtml(location)}</div>` : ''}
      <div class="weather-current">
        <img src="${esc(ICON_URL(current.icon))}" alt="${esc(current.condition)}" class="weather-icon-current" />
        <div>
          <div class="weather-temp">${esc(current.temp)}&deg;</div>
          <div class="weather-condition">${esc(current.condition)} · feels ${esc(current.feelsLike)}&deg;</div>
        </div>
      </div>
      <div class="weather-forecast">
        ${forecast
          .map(
            (day) => `
          <div class="forecast-day">
            <div>${esc(new Date(day.date).toLocaleDateString(undefined, { weekday: 'short' }))}</div>
            <img src="${esc(ICON_URL(day.icon))}" alt="${esc(day.summary)}" class="weather-icon-forecast" />
            <div><span class="hi">${esc(day.high)}&deg;</span> / <span class="lo">${esc(day.low)}&deg;</span></div>
          </div>`
          )
          .join('')}
      </div>
    `;
  }

  async function refresh(container) {
    try {
      const res = await fetch('/api/weather');
      const data = await res.json();
      render(container, data);
    } catch (err) {
      container.innerHTML = `<div class="weather-condition">Weather unavailable</div>`;
    }
  }

  window.NimbusModules = window.NimbusModules || {};
  window.NimbusModules.weather = {
    mount(container, settings) {
      container.classList.add('weather-module');
      refresh(container);
      const intervalId = setInterval(() => refresh(container), (settings.refreshMinutes || 10) * 60 * 1000);
      return {
        destroy() {
          clearInterval(intervalId);
        },
      };
    },
  };
})();

(function () {
  const ICON_URL = (icon) => `https://openweathermap.org/img/wn/${icon}@2x.png`;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render(container, data) {
    if (data.error) {
      container.innerHTML = `<div class="weather-condition">Weather unavailable: ${data.error}</div>`;
      return;
    }
    const { current, forecast, location } = data;
    container.innerHTML = `
      ${location ? `<div class="weather-location">${escapeHtml(location)}</div>` : ''}
      <div class="weather-current">
        <img src="${ICON_URL(current.icon)}" alt="${current.condition}" width="56" height="56" />
        <div>
          <div class="weather-temp">${current.temp}&deg;</div>
          <div class="weather-condition">${current.condition} · feels ${current.feelsLike}&deg;</div>
        </div>
      </div>
      <div class="weather-forecast">
        ${forecast
          .map(
            (day) => `
          <div class="forecast-day">
            <div>${new Date(day.date).toLocaleDateString(undefined, { weekday: 'short' })}</div>
            <img src="${ICON_URL(day.icon)}" alt="${day.summary}" width="32" height="32" />
            <div><span class="hi">${day.high}&deg;</span> / <span class="lo">${day.low}&deg;</span></div>
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

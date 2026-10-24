# NimbusGlass

A lightweight, modular smart mirror display system built for the Raspberry
Pi 3. Node.js backend, no-build vanilla JS frontend, CSS-grid layout engine,
live theming, and a WebSocket-driven admin console that pushes layout/theme/
module changes to the mirror instantly — no reload.

Ships with four modules: Clock & Calendar, Upcoming Holidays
([date.nager.at](https://date.nager.at), free, no key), Local Weather
(OpenWeatherMap), and a Sports Scoreboard (NFL, NHL, MLB, English Premier
League, NCAA) built on the same free/undocumented ESPN scoreboard endpoints
used by the [`dathbe/MMM-MyScoreboard`](https://github.com/dathbe/MMM-MyScoreboard)
MagicMirror module. Weather and Holidays share one configured location
(`/admin` → Location) rather than each module wanting its own; neither
sports data nor holiday data needs an API key.

## Why it's built this way

- **Vanilla JS, no bundler.** On a Pi 3 (1GB RAM, quad-core Cortex-A53),
  every MB and build step matters. There's no webpack/vite step — the
  browser loads `public/js/*.js` directly.
- **Server does the fetching.** The Node server proxies and caches
  OpenWeatherMap and ESPN requests (`src/server/cache.js`), so the Chromium
  kiosk tab never makes slow/flaky upstream calls itself, and upstream rate
  limits are respected regardless of how many browser tabs are open.
- **One config, pushed over a socket.** `data/config.json` is the single
  source of truth for theme, layout, and per-module settings. The admin
  console edits it; Socket.IO pushes the new config to every connected
  mirror display, which tears down and re-renders its grid — no page
  reload, no polling for config changes.

## Project layout

```
NimbusGlass/
├── config/
│   └── config.default.json     # seed config, copied to data/config.json on first run
├── data/
│   └── config.json              # live, mutable config (gitignored)
├── deploy/
│   ├── nimbusglass.service      # systemd unit template (__PLACEHOLDER__ tokens)
│   ├── openbox-autostart         # kiosk autostart template, X11/Openbox (Pi 2/3, or Bullseye-)
│   └── labwc-autostart            # kiosk autostart template, labwc/Wayland (Pi 4/5 + Bookworm+)
├── docs/
│   └── KIOSK_SETUP.md           # Pi OS Lite -> booted kiosk, step by step
├── scripts/
│   ├── install.sh                # one-shot installer: detects Pi model/OS, does everything below
│   └── kiosk-start.sh             # waits for the server, launches Chromium kiosk
├── src/server/
│   ├── server.js                 # Express app, binds 0.0.0.0
│   ├── websocket.js               # Socket.IO: config:update / config:set
│   ├── configStore.js              # load/merge/persist data/config.json
│   ├── cache.js                    # in-memory TTL cache for upstream fetches
│   ├── providers/
│   │   ├── weather.js                 # OpenWeatherMap current + 3-day forecast
│   │   ├── holidays.js                 # date.nager.at upcoming public holidays
│   │   ├── sports.js                  # ESPN scoreboard fetch, league path map
│   │   └── teams.js                    # ESPN team rosters, for the /admin team picker
│   └── routes/
│       └── api.js                      # /api/config, /api/weather, /api/holidays, /api/scores, /api/teams/:league
├── public/                       # the mirror display itself
│   ├── index.html
│   ├── css/
│   │   ├── theme.css              # CSS variable theme definitions
│   │   ├── grid.css                # zone layout grid
│   │   └── modules.css              # per-module styling
│   ├── js/
│   │   ├── app.js                  # renders zones/modules from config, socket client
│   │   └── modules/
│   │       ├── clock.js
│   │       ├── holidays.js
│   │       ├── weather.js
│   │       └── scoreboard.js
│   └── admin/                     # management console at /admin
│       ├── index.html
│       ├── admin.css
│       └── admin.js
├── .env.example
└── package.json
```

## Getting started (development machine)

```bash
git clone https://github.com/barbergeek/NimbusGlass.git
cd NimbusGlass
./scripts/dev.sh
```

`scripts/dev.sh` installs dependencies and bootstraps `.env` on first run
if they're missing, stops any previously-running dev instance (so re-running
it is always safe), and starts the server with `node --watch` so it
restarts automatically whenever a file under `src/` changes. Ctrl-C to stop.

Then open:
- Mirror display: http://localhost:3000
- Admin console: http://localhost:3000/admin

Set `OPENWEATHER_API_KEY` in `.env` (or paste it into the Weather section
at `/admin` once it's running - takes effect instantly, no restart needed).

## Deploying to a Raspberry Pi kiosk

```bash
git clone https://github.com/barbergeek/NimbusGlass.git
cd NimbusGlass
./scripts/install.sh
```

`scripts/install.sh` detects your Pi model (3/4/5) and OS release
(Bullseye through Trixie), installs Node.js and the right kiosk display
stack for that combination (X11/Openbox or labwc/Wayland), deploys the
systemd service, and wires up the kiosk autostart. See
[docs/KIOSK_SETUP.md](docs/KIOSK_SETUP.md) for flags, the decision table
behind the auto-detection, and the manual step-by-step equivalent.

## Configuration

Everything lives in `data/config.json` (seeded from
`config/config.default.json` on first run) and is editable live from
`/admin`:

- `theme` — `vibrant-dark`, `vibrant-light`, or `mono` (see `public/css/theme.css`)
- `orientation` — `landscape` or `portrait`
- `location` — `city` (OpenWeatherMap-style, e.g. `"Haymarket,VA,US"`) and
  `country` (ISO 3166-1 alpha-2, e.g. `"US"`), shared by the Weather and
  Holidays modules rather than configured per-module
- `zones` — the 9 grid regions plus a full-width `bottom-bar`
- `layout` — which module id(s) render in each zone, in render order. Edit
  from "Modules & Layout" in `/admin` (grouped by zone, drag to reorder
  within a zone) rather than by hand
- `modules` — per-module `enabled` flag and `settings`

## Adding a module

1. Create `public/js/modules/<id>.js` registering `window.NimbusModules.<id> = { mount(container, settings) }`.
   `mount` returns `{ update(settings), destroy() }`.
2. Add a `<script>` tag for it in `public/index.html`.
3. Add its default entry under `modules` in `config/config.default.json`.
4. If it needs server-side data/caching, add a provider under
   `src/server/providers/` and a route in `src/server/routes/api.js`.

## License

MIT, see [LICENSE](LICENSE).

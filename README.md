# ET Home Dashboard

A single-page dashboard for monitoring a house: a Particle-based fridge/freezer
sensor, a Particle-based sump pump monitor, local weather, and a Google Nest
thermostat -- all on one page, hosted for free on GitHub Pages.

**Live site:** https://etilberg.github.io/ETHome/

## What it shows

- **Fridge/Freezer Monitor** -- live temp for fridge, freezer, and garage; a
  freeze-protection heater's status and run time; history charts with an
  outdoor-temp overlay (from NWS) on the garage chart.
- **Sump Pump Monitor** -- live basement temp, external power, pump runtime,
  and time-since-last-run; history charts including a daily cycle-count chart
  (90-day analytics) and a time-since-run chart with precipitation bars
  overlaid, so you can see rain events line up with pump activity.
- **Indoor Climate** -- live indoor temp, humidity, and HVAC status (color
  coded: red while heating, blue while cooling) from a Google Nest
  thermostat, plus a history chart.
- **Weather History** -- local station humidity/pressure and a separate
  wind chart (speed, gusts, and direction as rotated arrows) at native
  ~5-minute resolution, plus a 5-day/night forecast strip with icons and a
  wind-direction compass vane in the current-conditions widget.
- **Diagnostics** (collapsed by default, click to expand) -- connection
  status for both Particle devices, firmware-reported dropped/failed publish
  counters with 24h deltas, data-source freshness for every feed on the page,
  and the last error hit anywhere in the app. Also holds the device reset
  button.

All charts share one range selector (4h / 12h / 24h / 48h / 1 week) and
support pan/zoom (drag to pan, scroll/pinch to zoom, double-click to reset).

## Architecture

This is a static site (GitHub Pages can't run server-side code) plus one
small serverless backend for the two integrations that need a real secret:

```
Browser (GitHub Pages)
  |
  |-- CSV history --------------> Google Sheets ("Publish to web")
  |-- live event streams -------> Particle Cloud SSE (via Worker proxy)
  |-- current conditions/forecast -> api.weather.gov (NWS, no key needed)
  |-- precipitation ------------> mesonet.agron.iastate.edu (IEM Reanalysis, no key needed)
  |-- fridge heater control/reset -> Cloudflare Worker -> Particle Cloud API
  |-- indoor climate data ------> Cloudflare Worker -> KV (polled by a Cron Trigger)
```

**Why a backend at all:** the dashboard used to embed a raw Particle access
token directly in client-side JS -- fully visible to anyone viewing page
source, with the ability to control both devices. Particle doesn't offer
scoped/read-only tokens outside its paid Product tier, so the fix is a small
Cloudflare Worker that holds the real token (and the Nest OAuth
credentials) as hidden secrets, exposing only a handful of fixed operations
to the browser. See `cloudflare-worker/README.md` for the full design and
setup steps.

**Why Nest needs its own storage:** Google's Smart Device Management API
only exposes *current* thermostat state, not history. The Worker polls it
every 5 minutes on a Cron Trigger and builds its own rolling 7-day history
in Cloudflare KV.

## File structure

```
index.html              Page structure, all sections
style.css                Dark theme, chart containers, diagnostics styling
config.js                 Device IDs, coordinates, Worker URL, CSV URLs
script.js                  All dashboard logic: fetching, charting, SSE, diagnostics
cloudflare-worker/
  worker.js                The backend Worker (Particle proxy + Nest polling)
  wrangler.toml             Worker config -- bindings/cron/observability declared
                             here so they survive every deploy (see note below)
  README.md                 Backend setup: Particle token, Nest OAuth flow,
                             KV namespace, Cron Trigger
TempMonitor.ino            Firmware for the fridge/freezer Particle device
```

## Setting this up for yourself

1. **Firmware**: flash the two Particle devices (fridge/freezer monitor,
   sump pump monitor) with their respective firmware, publishing the
   expected event names/JSON shapes (see `script.js`'s SSE handlers for the
   exact fields each device is expected to send).
2. **Historical data**: each device's firmware (or a connected script) logs
   readings to a Google Sheet, published to the web as CSV. Put those CSV
   URLs in `config.js`.
3. **Backend**: follow `cloudflare-worker/README.md` in full -- Particle
   token, Google Cloud/Nest Device Access setup, KV namespace, and
   connecting the Worker to this same repo via Cloudflare's Git integration
   (root directory `cloudflare-worker`) so pushes to that folder auto-deploy.
4. **Frontend config**: set `NWS_LATITUDE`/`NWS_LONGITUDE` to your property's
   coordinates, `PARTICLE_PROXY_BASE_URL` to your deployed Worker's URL, and
   the two Particle device IDs, in `config.js`.
5. **GitHub Pages**: enable Pages on this repo (Settings -> Pages), serving
   from the `main` branch root. That's it -- `index.html` is the entry point.

No local build step, no npm install for the frontend -- it's plain
HTML/CSS/JS loading Chart.js and a couple of small plugins from a CDN.

## Known data-source quirks (not bugs)

- **KATY's own precipitation sensor is out of service** (confirmed via its
  raw METAR reports showing a persistent `PNO` -- "precipitation
  discriminator not operating" -- flag), which is why precip comes from a
  radar-based source (IEM Reanalysis) instead of the local station directly.
- **NWS observation data isn't perfectly regular.** Occasional gaps or
  `null` fields in wind/humidity/pressure reflect real station reporting
  gaps, not a fetch bug.
- **Indoor Climate readings can go flat for hours** when the HVAC isn't
  running and conditions are stable -- that's real data, not a stalled poll
  (verified against the Worker's own Cron Trigger logs, which run reliably
  every 5 minutes with no gaps).

## Roadmap / TODO

- Move the "Enable Fridge Heater" button into the Diagnostics section, and
  move its current on/off status text up into the Fridge/Freezer Monitor's
  live-value cards (next to the existing "Heater Off" run-time box) --
  this would let the standalone Controls section be removed entirely.

# ET Home Dashboard

A single-page dashboard for monitoring a house: a Particle-based fridge/freezer
sensor, a Particle-based sump pump monitor, local weather, and a Google Nest
thermostat -- all on one page, hosted for free on GitHub Pages.

**Live site:** https://theethome.com/

## What it shows

- **Fridge/Freezer Monitor** -- live temp for fridge, freezer, and garage; a
  freeze-protection heater's status and run time; history charts with an
  outdoor-temp overlay (from NWS) on the garage chart.
- **Sump Pump Monitor** -- live basement temp, external power, pump runtime,
  and time-since-last-run; cycles and average gap over the last 24 hours; a
  run-time trend (last 10 cycles against the 30-day median) that turns red
  if the pump starts taking longer; history charts including a daily
  cycle-count chart (90-day analytics) and a time-since-run chart with
  precipitation bars overlaid, plus the precipitation total for the range.
- **Indoor Climate** -- live indoor temp, humidity, and HVAC status (color
  coded: red while heating, blue while cooling) from a Google Nest
  thermostat, a history chart, and heating/cooling hours per day against
  the day's average outdoor temperature.
- **Aquarium Monitor** -- water and ambient temperature from Adafruit IO,
  with a rate-of-change indicator and an "Offline" state when the sensor
  reports its offline value.
- **Weather History** -- local station humidity/pressure and a separate
  wind chart (speed, gusts, and direction as rotated arrows) at native
  ~5-minute resolution, plus a 5-day/night forecast strip with icons and a
  wind-direction compass vane in the current-conditions widget.
- **Diagnostics** (collapsed by default, click to expand) -- connection
  status for both Particle devices, firmware-reported dropped/failed publish
  counters with 24h deltas, data-source freshness for every feed on the page,
  and the last error hit anywhere in the app. Also holds the PIN-protected
  controls: fridge heater enable, board resets, and a test-alert button.

All charts share one range selector in the top bar (1h / 2h / 4h / 12h /
24h / 48h / 1 week).

**Limits and the status dot.** `CARD_LIMITS` in `config.js` gives each
analog value a low/high limit. A card turns blue below its limit and red
above it, and the same limits are drawn as dashed lines on the charts. The
dot in the top bar is green when every card is in range and every source is
reporting, red otherwise; tap it for the list of what's wrong.

**Alerts.** Separately from the page, the Worker checks every 5 minutes
that the Nest data and the three Particle boards are alive and sends a phone
notification when one has been down for 10 minutes (see
`cloudflare-worker/README.md`).

**Install on a phone.** The page has a web manifest and icons, so "Add to
Home Screen" gives it its own icon and a full-screen window.

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
- **The sump pump can genuinely go a week or more between cycles** during
  dry stretches -- "Time Since Last Cycle" showing several days, or the
  Sump CSV Freshness diagnostic showing 100+ hours, isn't necessarily a
  broken logging pipeline. Cross-check against real-world knowledge of
  whether it's actually been dry before assuming something's wrong.
- **The sump SinceRun/Precip chart used to go blank whenever the pump
  hadn't logged anything within the selected range** (a real bug, now
  fixed) -- its bins were anchored to the sump CSV's own oldest/newest
  timestamps rather than the actual selected time window, so a long
  pump-inactive stretch blanked out the precip bars too, even though
  precip data is entirely independent of pump activity. Bins are now
  anchored to the real selected window (`now` back to `rangeHours` ago).

## Keeping the history sheets small

The page downloads each published sheet in full, so an ever-growing sheet
makes every visit slower (the fridge sheet had reached 17 MB). The page only
keeps the last 8 days of the fridge sheet and 100 days of the sump sheet in
memory, but the download itself is only as small as the sheet -- trim old
rows on a schedule with a small Apps Script time trigger.

## Roadmap / TODO

No open items right now.

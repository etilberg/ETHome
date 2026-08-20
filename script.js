// --- Configuration ---
// Loaded from config.js

// --- Get HTML Element References ---
// Temp Monitor Elements
const tempMonitorStatusElement = document.getElementById('temp-monitor-status');
const liveFridgeElement = document.getElementById('live-fridge');
const liveFreezerElement = document.getElementById('live-freezer');
const liveGarageElement = document.getElementById('live-garage');
const tempMonitorLastUpdatedElement = document.getElementById('temp-monitor-last-updated');
const liveHeaterValueElement = document.getElementById('live-heater-value');
const liveHeaterStatusElement = document.getElementById('live-heater-status');

// Sump Monitor Elements
const sumpMonitorStatusElement = document.getElementById('sump-monitor-status');
const sumpTempElement = document.getElementById('sump-temp');
const sumpPowerElement = document.getElementById('sump-power');
const sumpRuntimeElement = document.getElementById('sump-runtime');
const sumpSinceRunElement = document.getElementById('sump-since-run');
const sumpMonitorLastUpdatedElement = document.getElementById('sump-monitor-last-updated');

// Diagnostics Elements
const diagSumpConnElement = document.getElementById('diag-sump-conn');
const diagSumpDroppedElement = document.getElementById('diag-sump-dropped');
const diagSumpFailsElement = document.getElementById('diag-sump-fails');
const diagSumpCsvAgeElement = document.getElementById('diag-sump-csv-age');
const diagTempConnElement = document.getElementById('diag-temp-conn');
const diagTempCsvAgeElement = document.getElementById('diag-temp-csv-age');
const diagWeatherAgeElement = document.getElementById('diag-weather-age');
const diagSumpChartRefreshElement = document.getElementById('diag-sump-chart-refresh');
const diagLastErrorElement = document.getElementById('diag-last-error');

// KATY Weather Detail (Temp/Humidity/Wind/Pressure) Elements
const katyWeatherStatusElement = document.getElementById('katy-weather-status');
const katyWeatherLastUpdatedElement = document.getElementById('katy-weather-last-updated');

// --- Data Storage ---
let timeHistory = [];
let fridgeHistory = [];
let freezerHistory = [];
let garageHistory = [];
let heaterStatusHistory = [];
let outdoorTempHistory = [];

let sumpTimeHistory = [];
let sumpTempHistory = [];
let sumpRuntimeHistory = [];
let sumpSinceRunHistory = [];

// Tracks the currently-selected history-range dropdown value so the periodic
// sump chart refresh (see SUMP_CHART_REFRESH_INTERVAL_MS) re-fetches the same range.
let currentSumpRangeHours = 4;
// How often to rebuild the sump charts from source data instead of live-appending.
const SUMP_CHART_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// --- Chart Instance Variables ---
let fridgeChartInstance, freezerChartInstance, garageChartInstance;
let sumpTempChartInstance, sumpRuntimeChartInstance, sumpSinceRunChartInstance;
let sumpRunsPerDayChartInstance;
let katyWeatherChartInstance;
let katyWindChartInstance;

// A single, unified cache for all weather station data
let masterWeatherCache = {
    data: new Map(), // Holds all hourly data: ts -> {temp, precip}
    timestamp: 0     // Unix timestamp of the last successful fetch
};
const MASTER_CACHE_DURATION = 1 * 60 * 60 * 1000; // 1 hours in milliseconds
// Bumped whenever the underlying weather data source/schema changes (e.g.
// switching providers). A cached entry tagged with an older version is
// treated as invalid and re-fetched, instead of silently being reused just
// because it's still within MASTER_CACHE_DURATION.
const WEATHER_CACHE_VERSION = 'nws-v4-iemre-precip';

function calculateMinMax(array) {
  if (!array.length) return { min: null, max: null };
  return {
    min: Math.min(...array),
    max: Math.max(...array)
  };
}

// ================================
// Diagnostics Panel
// ================================
// Central place for troubleshooting info: connection status, firmware-reported
// dropped/failed publishes, how stale each data source is, and the last error
// hit anywhere in the app. Update diagState from wherever something relevant
// happens, then call renderDiagnostics() to reflect it in the DOM.
const diagState = {
    sumpConn: 'Initializing...',
    sumpDropped: null,
    sumpFails: null,
    sumpCsvLatest: null,       // timestamp (ms) of the newest row in the last sump CSV fetch
    tempConn: 'Initializing...',
    tempCsvLatest: null,       // timestamp (ms) of the newest row in the last temp CSV fetch
    weatherCacheTimestamp: 0,  // when masterWeatherCache was last populated
    sumpChartLastRefresh: null,
    lastError: null,
};

function formatAgo(timestampMs) {
    if (!timestampMs) return '--';
    const diffSec = Math.round((Date.now() - timestampMs) / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = (diffMin / 60).toFixed(1);
    return `${diffHr}h ago`;
}

function logDiagError(context, error) {
    console.error(`DEBUG: [${context}]`, error);
    diagState.lastError = `${new Date().toLocaleTimeString()} - ${context}: ${error.message || error}`;
    renderDiagnostics();
}

// --- Rolling 24h delta tracking for lifetime firmware counters ---
// publishFails/droppedEvents are cumulative since the device's last boot, so
// the raw total alone doesn't say much -- what matters is whether it's still
// climbing. Snapshots are throttled to ~once per 15 min and persisted to
// localStorage (pruned past 26h) so the 24h window survives page reloads
// instead of resetting every time the tab is refreshed.
const COUNTER_HISTORY_STORAGE_KEY = 'sumpCounterHistory';
const COUNTER_SNAPSHOT_MIN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const COUNTER_HISTORY_MAX_AGE_MS = 26 * 60 * 60 * 1000;  // 26 hours (small buffer past 24h)

function loadCounterHistory() {
    try {
        const raw = localStorage.getItem(COUNTER_HISTORY_STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch (error) {
        console.error("DEBUG: Could not read counter history from localStorage.", error);
    }
    return {};
}

function saveCounterHistory() {
    try {
        localStorage.setItem(COUNTER_HISTORY_STORAGE_KEY, JSON.stringify(counterHistory));
    } catch (error) {
        console.error("DEBUG: Could not save counter history to localStorage.", error);
    }
}

let counterHistory = loadCounterHistory();

// Records a new value for a named lifetime counter (throttled + pruned) and
// returns a display-ready delta string, e.g. "+120 in 24h". While less than
// 24h of history has been collected yet, returns a shorter-window delta and
// says so explicitly rather than showing a misleading "24h" figure.
function trackCounterDelta(name, currentValue) {
    if (currentValue === null || currentValue === undefined) return null;

    const now = Date.now();
    const snapshots = counterHistory[name] || [];

    const last = snapshots[snapshots.length - 1];
    if (!last || now - last.t >= COUNTER_SNAPSHOT_MIN_INTERVAL_MS) {
        snapshots.push({ t: now, v: currentValue });
        while (snapshots.length > 1 && now - snapshots[0].t > COUNTER_HISTORY_MAX_AGE_MS) {
            snapshots.shift();
        }
        counterHistory[name] = snapshots;
        saveCounterHistory();
    }

    if (snapshots.length === 0) return null;

    // Baseline = the most recent snapshot at/before 24h ago, if we have one.
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    let baseline = null;
    for (const snap of snapshots) {
        if (snap.t <= twentyFourHoursAgo) baseline = snap;
        else break;
    }
    if (baseline) {
        return `+${currentValue - baseline.v} in 24h`;
    }

    // Not tracking this long yet -- show what we've got and say so.
    const oldest = snapshots[0];
    const elapsedHours = (now - oldest.t) / (60 * 60 * 1000);
    if (elapsedHours < 0.1) return null; // just started tracking, nothing meaningful yet
    return `+${currentValue - oldest.v} in ${elapsedHours.toFixed(1)}h (still collecting 24h)`;
}

function renderDiagnostics() {
    if (diagSumpConnElement) diagSumpConnElement.textContent = diagState.sumpConn;
    if (diagSumpDroppedElement) {
        const val = diagState.sumpDropped;
        const delta = trackCounterDelta('droppedEvents', val);
        diagSumpDroppedElement.textContent = (val ?? '--') + (delta ? ` (${delta})` : '');
        diagSumpDroppedElement.style.color = val > 0 ? '#ff6b6b' : '';
    }
    if (diagSumpFailsElement) {
        const val = diagState.sumpFails;
        const delta = trackCounterDelta('publishFails', val);
        diagSumpFailsElement.textContent = (val ?? '--') + (delta ? ` (${delta})` : '');
        diagSumpFailsElement.style.color = val > 0 ? '#ff6b6b' : '';
    }
    if (diagSumpCsvAgeElement) diagSumpCsvAgeElement.textContent = formatAgo(diagState.sumpCsvLatest);
    if (diagTempConnElement) diagTempConnElement.textContent = diagState.tempConn;
    if (diagTempCsvAgeElement) diagTempCsvAgeElement.textContent = formatAgo(diagState.tempCsvLatest);
    if (diagWeatherAgeElement) diagWeatherAgeElement.textContent = formatAgo(diagState.weatherCacheTimestamp);
    if (diagSumpChartRefreshElement) diagSumpChartRefreshElement.textContent = formatAgo(diagState.sumpChartLastRefresh);
    if (diagLastErrorElement) diagLastErrorElement.textContent = diagState.lastError ?? 'None';
}

function createChart(canvasId, label, borderColor, yLabel = 'Temperature (°F)') {
    const canvasElement = document.getElementById(canvasId);
    if (!canvasElement) {
        console.error(`DEBUG: Canvas element with ID '${canvasId}' not found!`);
        return null;
    }
    const ctx = canvasElement.getContext('2d');
    if (!ctx) {
        console.error(`DEBUG: Failed to get 2D context for canvas ID '${canvasId}'!`);
        return null;
    }

    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: label,
                data: [],
                borderColor: borderColor,
                borderWidth: 2,
                pointRadius: 0,
                fill: false,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                     type: 'time',
                    title: {
                        display: false,
                        text: 'Date'
                    }
                },
                y: {
                    beginAtZero: false,
                    title: {
                        display: true,
                        text: yLabel
                    }
                }
            },
            plugins: {
                legend: {
                    display: true
                },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x'
                    },
                    zoom: {
                        wheel: {
                            enabled: true
                        },
                        pinch: {
                            enabled: true
                        },
                        mode: 'x'
                    }
                }
            }
        }
    });

    // Double-click a chart to reset pan/zoom back to the full range
    canvasElement.addEventListener('dblclick', () => chart.resetZoom());

    return chart;
}

// --- NWS/NOAA Weather Helpers ---
// Both the current-conditions widget and the historical precip/temp cache
// need to know which NWS observation station + forecast gridpoint cover our
// coordinates. Resolved once via /points and cached for the page's lifetime.
let nwsStationIdCache = null;
let nwsGridForecastUrlCache = null;
let nwsStationResolutionPromise = null;

async function resolveNwsStation() {
    // Guard against multiple simultaneous callers triggering duplicate /points lookups
    if (nwsStationResolutionPromise) return nwsStationResolutionPromise;

    nwsStationResolutionPromise = (async () => {
        const pointRes = await fetch(`https://api.weather.gov/points/${NWS_LATITUDE},${NWS_LONGITUDE}`, {
            headers: { 'Accept': 'application/geo+json' }
        });
        if (!pointRes.ok) throw new Error(`HTTP ${pointRes.status} on NWS /points lookup`);
        const pointJson = await pointRes.json();

        nwsGridForecastUrlCache = pointJson.properties.forecast;

        const stationsRes = await fetch(pointJson.properties.observationStations, {
            headers: { 'Accept': 'application/geo+json' }
        });
        if (!stationsRes.ok) throw new Error(`HTTP ${stationsRes.status} on NWS /stations lookup`);
        const stationsJson = await stationsRes.json();
        const firstStation = stationsJson.features && stationsJson.features[0];
        if (!firstStation) throw new Error("NWS returned no observation stations for this location");

        nwsStationIdCache = firstStation.properties.stationIdentifier || firstStation.id.split('/').pop();
        console.log(`DEBUG: NWS resolved nearest station to ${nwsStationIdCache}`);
        return nwsStationIdCache;
    })();

    return nwsStationResolutionPromise;
}

// --- KATY Weather Detail (Temp/Humidity/Wind/Pressure) ---
// Separate from the precip fix -- this stays on raw NWS/KATY station
// observations at their native ~5-minute cadence, since temp/humidity/wind/
// pressure there have never shown a problem (only KATY's precip sensor did).
// For the 1-week range, collapses to one point per hour (latest reading
// within each hour, i.e. a "top of the hour" value) to keep the chart
// readable and the point count small, per the chosen approach.
async function fetchKatyWeatherDetail(rangeHours) {
    console.log(`DEBUG: Fetching KATY weather detail (temp/humidity/wind/pressure) for last ${rangeHours} hours.`);
    try {
        const stationId = await resolveNwsStation();
        if (!stationId) throw new Error("No NWS station resolved");

        // Day-chunked requests, same reasoning as fetchMasterWeatherData: a
        // single wide request can silently cap out at however many records
        // the API returns per call. Only fetch as many days as the selected
        // range actually needs (plus one for safety margin).
        const daysNeeded = Math.min(8, Math.ceil(rangeHours / 24) + 1);
        const rawObs = [];

        for (let i = 0; i < daysNeeded; i++) {
            const dayEnd = new Date(Date.now() - i * 24 * 3600000);
            const dayStart = new Date(dayEnd.getTime() - 24 * 3600000);
            const url = `https://api.weather.gov/stations/${stationId}/observations?start=${dayStart.toISOString()}&end=${dayEnd.toISOString()}&limit=500`;

            try {
                const res = await fetch(url, { headers: { 'Accept': 'application/geo+json' } });
                if (!res.ok) throw new Error(`HTTP error ${res.status} for day offset ${i}`);
                const json = await res.json();
                const features = json.features || [];

                for (const feature of features) {
                    const p = feature.properties || {};
                    if (!p.timestamp) continue;
                    const t = new Date(p.timestamp).getTime();

                    const tempC = p.temperature && p.temperature.value;
                    const temp = (tempC === null || tempC === undefined) ? null : (tempC * 9 / 5 + 32);

                    const humidity = (p.relativeHumidity && p.relativeHumidity.value != null) ? p.relativeHumidity.value : null;

                    const windSpeedKmh = p.windSpeed && p.windSpeed.value;
                    const windSpeed = (windSpeedKmh === null || windSpeedKmh === undefined) ? null : (windSpeedKmh * 0.621371);

                    const windGustKmh = p.windGust && p.windGust.value;
                    const windGust = (windGustKmh === null || windGustKmh === undefined) ? null : (windGustKmh * 0.621371);

                    const windDir = (p.windDirection && p.windDirection.value != null) ? p.windDirection.value : null;

                    // Prefer station-level barometric pressure; fall back to
                    // sea-level pressure if that's all this observation has.
                    const pressurePa = (p.barometricPressure && p.barometricPressure.value != null)
                        ? p.barometricPressure.value
                        : (p.seaLevelPressure && p.seaLevelPressure.value);
                    const pressure = (pressurePa === null || pressurePa === undefined) ? null : (pressurePa / 3386.39);

                    rawObs.push({ t, temp, humidity, windSpeed, windGust, windDir, pressure });
                }
            } catch (dayError) {
                console.error(`DEBUG: KATY weather-detail fetch failed for day offset ${i}:`, dayError);
            }

            if (i < daysNeeded - 1) {
                await new Promise(resolve => setTimeout(resolve, 150));
            }
        }

        rawObs.sort((a, b) => a.t - b.t);

        const cutoff = Date.now() - rangeHours * 3600000;
        const inRange = rawObs.filter(o => o.t >= cutoff);

        if (rangeHours > 48) {
            // Wide ranges (1 week): collapse to one point per hour, keeping
            // the latest observation within each hour.
            const hourly = new Map();
            for (const o of inRange) {
                const hourTs = Math.floor(o.t / 3600000) * 3600000;
                const existing = hourly.get(hourTs);
                if (!existing || o.t > existing.t) hourly.set(hourTs, o);
            }
            const sortedKeys = Array.from(hourly.keys()).sort((a, b) => a - b);
            return sortedKeys.map(k => hourly.get(k));
        }

        // Native ~5-minute resolution for shorter ranges
        return inRange;
    } catch (error) {
        console.error("DEBUG: KATY weather detail fetch failed:", error);
        logDiagError("KATY weather detail fetch", error);
        return [];
    }
}

async function refreshKatyWeatherChart(rangeHours) {
    if (katyWeatherStatusElement) {
        katyWeatherStatusElement.textContent = "Fetching...";
    }

    const points = await fetchKatyWeatherDetail(rangeHours);

    if (katyWeatherChartInstance) {
        katyWeatherChartInstance.data.labels = points.map(p => new Date(p.t));
        katyWeatherChartInstance.data.datasets[0].data = points.map(p => p.temp);
        katyWeatherChartInstance.data.datasets[1].data = points.map(p => p.humidity);
        katyWeatherChartInstance.data.datasets[2].data = points.map(p => p.pressure);
        katyWeatherChartInstance.update();
    }

    if (katyWindChartInstance) {
        katyWindChartInstance.data.labels = points.map(p => new Date(p.t));
        katyWindChartInstance.data.datasets[0].data = points.map(p => p.windSpeed);
        katyWindChartInstance.data.datasets[1].data = points.map(p => p.windGust);

        // Direction markers: at most one per hour, regardless of the chart's
        // overall resolution, so the graph doesn't get cluttered with an
        // arrow at every 5-min point. Each marker sits at {x: time, y: that
        // hour's wind speed} so it visually rides the speed line, using the
        // existing mph axis rather than a separate 0-360 one.
        const hourlyDirPoints = sampleOnePerHour(points.filter(p => p.windDir !== null && p.windSpeed !== null));
        katyWindChartInstance.data.datasets[2].data = hourlyDirPoints.map(p => ({ x: p.t, y: p.windSpeed }));
        // windDir is the compass bearing the wind is blowing FROM (standard
        // meteorological convention), so rotating the icon by windDir+180
        // makes the arrow point in the direction the wind is actually
        // blowing TOWARD. Each icon is pre-rendered already rotated (see
        // createWindArrowIcon), rather than using Chart.js's pointRotation
        // on a built-in shape.
        katyWindChartInstance.data.datasets[2].pointStyle = hourlyDirPoints.map(p => createWindArrowIcon((p.windDir + 180) % 360));

        katyWindChartInstance.update();
    }

    if (katyWeatherStatusElement) {
        katyWeatherStatusElement.textContent = points.length > 0 ? `Loaded ${points.length} points` : "No data";
    }
    if (katyWeatherLastUpdatedElement) {
        katyWeatherLastUpdatedElement.textContent = new Date().toLocaleTimeString();
    }

    console.log(`DEBUG: KATY weather detail charts updated with ${points.length} points for ${rangeHours}h range.`);
}

// Collapses a time-sorted array of {t, ...} points down to at most one per
// hour (the latest reading within each hour), used to keep sparse overlays
// like the wind-direction markers from getting cluttered at fine resolutions.
function sampleOnePerHour(points) {
    const hourly = new Map();
    for (const p of points) {
        const hourTs = Math.floor(p.t / 3600000) * 3600000;
        const existing = hourly.get(hourTs);
        if (!existing || p.t > existing.t) hourly.set(hourTs, p);
    }
    return Array.from(hourly.keys()).sort((a, b) => a - b).map(k => hourly.get(k));
}

// Draws a small open-chevron arrow (shaft + "^" head, like the shapes
// requested: <, ^, > depending on rotation) on an offscreen canvas, rotated
// by rotationDeg, for use as a Chart.js point style. Chart.js's built-in
// point styles (triangle, etc.) are filled/symmetric and don't read clearly
// as "pointing" in a direction -- an explicit arrow shape does.
// rotationDeg: 0 = pointing straight up, clockwise from there.
function createWindArrowIcon(rotationDeg, color = 'rgb(153, 102, 255)') {
    const size = 20;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.translate(size / 2, size / 2);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Shaft
    ctx.beginPath();
    ctx.moveTo(0, 7);
    ctx.lineTo(0, -6);
    ctx.stroke();

    // Open chevron head at the tip (the shape reads as ^ / > / < depending
    // on rotation, rather than a filled, harder-to-read triangle)
    ctx.beginPath();
    ctx.moveTo(-5, -1);
    ctx.lineTo(0, -8);
    ctx.lineTo(5, -1);
    ctx.stroke();

    return canvas;
}

// Converts a compass bearing in degrees to a 16-point abbreviation (N, NNE,
// NE, ...). Used for the current-conditions wind readout.
function degToCompass(deg) {
    if (deg === null || deg === undefined) return null;
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(deg / 22.5) % 16;
    return directions[index];
}

// --- Function to Fetch and Display Current Weather ---
async function displayCurrentWeather() {
    if (typeof NWS_LATITUDE === 'undefined' || typeof NWS_LONGITUDE === 'undefined') {
        console.error("DEBUG: NWS_LATITUDE/NWS_LONGITUDE not set in config.js");
        return;
    }

    try {
        const stationId = await resolveNwsStation();
        if (!stationId || !nwsGridForecastUrlCache) {
            throw new Error("Could not resolve NWS station/gridpoint for these coordinates");
        }

        const [obsRes, forecastRes] = await Promise.all([
            fetch(`https://api.weather.gov/stations/${stationId}/observations/latest`, { headers: { 'Accept': 'application/geo+json' } }),
            fetch(nwsGridForecastUrlCache, { headers: { 'Accept': 'application/geo+json' } })
        ]);
        if (!obsRes.ok) throw new Error(`HTTP ${obsRes.status} fetching latest observation`);
        if (!forecastRes.ok) throw new Error(`HTTP ${forecastRes.status} fetching forecast`);

        const obs = (await obsRes.json()).properties;
        const periods = ((await forecastRes.json()).properties || {}).periods || [];

        // NWS observations are always SI units (°C, km/h); the /forecast
        // endpoint's periods, by contrast, come back already in °F.
        const cToF = c => (c === null || c === undefined) ? null : Math.round(c * 9 / 5 + 32);
        const kmhToMph = k => (k === null || k === undefined) ? null : Math.round(k * 0.621371);

        const currentTemp = cToF(obs.temperature && obs.temperature.value);
        const windSpeed = kmhToMph(obs.windSpeed && obs.windSpeed.value);
        const windDirCompass = degToCompass(obs.windDirection && obs.windDirection.value);
        const humidity = (obs.relativeHumidity && obs.relativeHumidity.value != null) ? Math.round(obs.relativeHumidity.value) : null;
        const feelsLikeC = (obs.heatIndex && obs.heatIndex.value) ?? (obs.windChill && obs.windChill.value) ?? (obs.temperature && obs.temperature.value);
        const feelsLike = cToF(feelsLikeC);
        const conditions = obs.textDescription || '--';

        // Forecast periods are always chronological but may start mid-day or
        // mid-night depending on what time it is, so pick by isDaytime rather
        // than by fixed index to reliably get "today" vs "tomorrow".
        const daytimePeriods = periods.filter(p => p.isDaytime);
        const nighttimePeriods = periods.filter(p => !p.isDaytime);
        const dailyHigh = daytimePeriods[0] ? daytimePeriods[0].temperature : null;
        const dailyLow = nighttimePeriods[0] ? nighttimePeriods[0].temperature : null;
        const synopsis = (daytimePeriods[0] || periods[0] || {}).detailedForecast || '--';

        document.getElementById('current-temp').textContent = currentTemp !== null ? `${currentTemp}°F` : '--°F';
        document.getElementById('current-condition').textContent = conditions;
        document.getElementById('high-low').innerHTML = `H: <span class="temp-high">${dailyHigh ?? '--'}°</span> / L: <span class="temp-low">${dailyLow ?? '--'}°</span>`;
        document.getElementById('wind-speed-value').textContent = windSpeed !== null ? windSpeed : '--';
        document.getElementById('wind-direction').textContent = windDirCompass ? `from ${windDirCompass}` : '';
        document.getElementById('forecast-synopsis').querySelector('p').textContent = synopsis;
        document.getElementById('humidity').textContent = `Humidity: ${humidity !== null ? humidity : '--'}%`;
        document.getElementById('feels-like').textContent = `Feels like: ${feelsLike !== null ? feelsLike : '--'}°`;

        // Current-conditions icon -- NWS hosts these directly, so no local
        // icon set/mapping to maintain.
        const currentIconEl = document.getElementById('current-icon');
        if (currentIconEl) {
            if (obs.icon) {
                currentIconEl.src = obs.icon;
                currentIconEl.alt = conditions;
                currentIconEl.style.display = '';
            } else {
                currentIconEl.style.display = 'none';
            }
        }

        // Wind vane: rotate the needle to the compass bearing the wind is
        // blowing FROM (standard wind-vane convention), drawn pointing at N
        // (0deg) at rest. Calm/variable wind (no direction value) just
        // leaves the needle at rest with no label.
        const windDirDeg = obs.windDirection && obs.windDirection.value;
        const needleEl = document.getElementById('wind-vane-needle');
        const vaneLabelEl = document.getElementById('wind-vane-label');
        if (needleEl) {
            // Set the CSS transform *property* (not the SVG transform
            // attribute) -- the transition: transform rule on this element
            // makes the browser prefer the CSS property, which defaults to
            // none if never set via CSS, silently overriding an
            // attribute-based rotation and leaving the needle stuck at rest.
            needleEl.style.transform = `rotate(${windDirDeg ?? 0}deg)`;
        }
        if (vaneLabelEl) {
            vaneLabelEl.textContent = windDirCompass ? `${windDirCompass} ${windSpeed ?? '--'} mph` : '';
        }

        // Forecast strip: 5 days/nights (10 periods) with icons, per period.
        const forecastStripEl = document.getElementById('forecast-strip');
        if (forecastStripEl) {
            forecastStripEl.innerHTML = periods.slice(0, 10).map(p => `
                <div class="forecast-card">
                    <div class="forecast-card-label">${p.name}</div>
                    ${p.icon ? `<img src="${p.icon}" alt="${p.shortForecast || ''}">` : ''}
                    <div class="forecast-card-temp">${p.temperature ?? '--'}°</div>
                    <div class="forecast-card-short">${p.shortForecast || ''}</div>
                </div>
            `).join('');
        }

    } catch (error) {
        console.error("Could not fetch current weather from NWS:", error);
        if (typeof logDiagError === 'function') logDiagError("NWS current weather", error);
        const locationEl = document.getElementById('weather-location');
        if (locationEl) {
            locationEl.textContent = "Weather data unavailable.";
        }
    }
}

// --- Initialize Charts and Load Initial Data ---
document.addEventListener('DOMContentLoaded', () => {
    displayCurrentWeather();
    //console.log("DEBUG: DOM loaded, initializing charts.");
    if (typeof TEMP_MONITOR_DEVICE_ID === 'undefined' || typeof TEMP_MONITOR_HISTORY_CSV_URL === 'undefined') {
        console.error("DEBUG: Configuration variables from config.js seem to be missing!");
        tempMonitorStatusElement.textContent = "Config Error!";
        tempMonitorStatusElement.style.color = 'red';
        sumpMonitorStatusElement.textContent = "Config Error!";
        sumpMonitorStatusElement.style.color = 'red';
        return;
    }

    // Initialize all charts
    fridgeChartInstance = createChart('fridgeChart', 'Fridge Temp (°F)', 'rgb(255, 99, 132)');
        // Add HeaterStatus dataset to fridge chart
        if (fridgeChartInstance) {
            fridgeChartInstance.data.datasets.push({
                label: 'Heater Status',
                data: heaterStatusHistory,
                borderColor: 'rgb(100, 50, 0.3)',
                backgroundColor: 'rgba(125, 75, 0, 0.1)',
                yAxisID: 'y2',
                stepped: true,
                pointRadius: 0,             // hide data points
                borderWidth: 2,
                fill: 'origin'
            });
        
            fridgeChartInstance.options.scales.y2 = {
                position: 'right',
                title: {
                    display: true,
                    text: 'Heater Status'
                },
                min: 0,
                max: 1,
                ticks: {
                    stepSize: 1
                },
                grid: {
                    drawOnChartArea: false
                }
            };
        
            fridgeChartInstance.update();
        }
    freezerChartInstance = createChart('freezerChart', 'Freezer Temp (°F)', 'rgb(54, 162, 235)');
    garageChartInstance = createChart('garageChart', 'Garage Temp (°F)', 'rgb(75, 192, 192)');

    // First, check if the garage chart was created successfully
    if (garageChartInstance) {
        // Then, push the new dataset to THAT specific chart instance
        garageChartInstance.data.datasets.push({
            label: 'Outdoor Temp (°F)',
            data: outdoorTempHistory,
            borderColor: 'rgb(255, 99, 132)', // A different color for the outdoor temp
            borderWidth: 2,
            fill: false,
            //borderDash: [5, 5],         // optional dashed line
            pointRadius: 0,             // hide data points
            tension: 0.4,
            yAxisID: 'y' // Ensure this matches the garage chart's y-axis ID
        });
        // Update the chart to show the newly added data
        garageChartInstance.update();
    }
    sumpTempChartInstance = createChart('sumpTempChart', 'Basement Temperature (°F)', 'rgb(255, 206, 86)');
    sumpRuntimeChartInstance = createChart('sumpRuntimeChart', 'Sump Runtime (sec)', 'rgb(255, 159, 64)', 'Runtime (seconds)');

    const sumpSinceRunCtx = document.getElementById('sumpSinceRunChart').getContext('2d');
    sumpSinceRunChartInstance = new Chart(sumpSinceRunCtx, {
        type: 'line', // The base type is line
        data: {
            labels: [], // Populated later
            datasets: [{
                label: 'Time Since Last Cycle (min)',
                data: [],
                borderColor: 'rgb(201, 203, 207)',
                yAxisID: 'y_minutes', // Assign to the left axis
                tension: 0.1,
                pointRadius: 0,
            }, {
                label: 'Precipitation (in)',
                data: [],
                backgroundColor: 'rgba(54, 162, 235, 0.5)', // Blue for rain
                borderColor: 'rgba(54, 162, 235, 1)',
                yAxisID: 'y_precip', // Assign to the new right axis
                type: 'bar', // Display precipitation as bars
                barPercentage: 0.9,  // ← Add this (0-1, higher = wider bars)
                categoryPercentage: 1.0  // ← Add this (0-1, higher = wider bars)
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                },
                y_minutes: { // Configuration for the left Y-axis (Minutes)
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Minutes'
                    }
                },
                y_precip: { // Configuration for the new right Y-axis (Precipitation)
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Precipitation (in)'
                    },
                    grid: {
                        drawOnChartArea: false, // Only draw grid for the left axis
                    },
                    ticks: {
                        beginAtZero: true
                    }
                }
            },
            plugins: {
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x'
                    },
                    zoom: {
                        wheel: {
                            enabled: true
                        },
                        pinch: {
                            enabled: true
                        },
                        mode: 'x'
                    }
                }
            }
        }
    });
    // Double-click to reset pan/zoom back to the full range
    document.getElementById('sumpSinceRunChart').addEventListener('dblclick', () => sumpSinceRunChartInstance.resetZoom());
  
    // ======================= INITIALIZE THE RunsPerDay CHART =======================
    sumpRunsPerDayChartInstance = createChart('sumpRunsPerDayChart', 'Total Cycles', 'rgb(129, 201, 149)', 'Number of Runs');
if (sumpRunsPerDayChartInstance) {
    sumpRunsPerDayChartInstance.config.type = 'bar'; // Set chart type to bar

    // --- Customize the tooltip to show the full date ---
    sumpRunsPerDayChartInstance.options.plugins.tooltip = {
        callbacks: {
            title: function(tooltipItems) {
                // The 'label' property of the first tooltip item contains our date string
                return tooltipItems[0].label;
            }
        }
    };

    sumpRunsPerDayChartInstance.update();
}

    // ======================= INITIALIZE THE KATY WEATHER DETAIL CHARTS =======================
    // Temp/humidity/pressure at KATY's native ~5-min resolution (hourly,
    // top-of-the-hour values, for the 1-week range -- see
    // fetchKatyWeatherDetail). Separate from the precip fix: this stays on
    // raw NWS/KATY observations since none of these fields have shown a
    // problem, unlike KATY's broken precip sensor.
    const katyWeatherCtx = document.getElementById('katyWeatherChart')?.getContext('2d');
    if (katyWeatherCtx) {
        katyWeatherChartInstance = new Chart(katyWeatherCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    { label: 'Temp (°F)', data: [], borderColor: 'rgb(255, 99, 132)', yAxisID: 'y_temp', pointRadius: 0, borderWidth: 2, tension: 0.1 },
                    { label: 'Humidity (%)', data: [], borderColor: 'rgb(54, 162, 235)', yAxisID: 'y_humidity', pointRadius: 0, borderWidth: 2, tension: 0.1 },
                    { label: 'Pressure (inHg)', data: [], borderColor: 'rgb(201, 203, 207)', yAxisID: 'y_pressure', pointRadius: 0, borderWidth: 2, tension: 0.1 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'nearest', axis: 'x', intersect: false },
                scales: {
                    x: { type: 'time' },
                    y_temp: {
                        type: 'linear', position: 'left',
                        title: { display: true, text: 'Temp (°F)' }
                    },
                    y_humidity: {
                        type: 'linear', position: 'right', min: 0, max: 100,
                        title: { display: true, text: 'Humidity (%)' },
                        grid: { drawOnChartArea: false }
                    },
                    y_pressure: {
                        type: 'linear', position: 'right', offset: true,
                        title: { display: true, text: 'Pressure (inHg)' },
                        grid: { drawOnChartArea: false }
                    }
                },
                plugins: {
                    legend: { display: true },
                    zoom: {
                        pan: { enabled: true, mode: 'x' },
                        zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
                    }
                }
            }
        });
        // Double-click to reset pan/zoom back to the full range
        document.getElementById('katyWeatherChart').addEventListener('dblclick', () => katyWeatherChartInstance.resetZoom());
    }

    // Wind: Speed + Gusts as lines, Direction as sparse rotated triangle
    // markers sitting directly on the speed line (one per hour, regardless
    // of the chart's overall resolution, so it doesn't get busy) -- no
    // separate 0-360 axis needed since the markers use the same mph scale.
    const katyWindCtx = document.getElementById('katyWindChart')?.getContext('2d');
    if (katyWindCtx) {
        katyWindChartInstance = new Chart(katyWindCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    { label: 'Wind Speed (mph)', data: [], borderColor: 'rgb(75, 192, 192)', yAxisID: 'y_wind', pointRadius: 0, borderWidth: 2, tension: 0.1 },
                    { label: 'Wind Gusts (mph)', data: [], borderColor: 'rgb(255, 159, 64)', yAxisID: 'y_wind', pointRadius: 0, borderWidth: 1, borderDash: [4, 4], tension: 0.1 },
                    {
                        label: 'Wind Direction', data: [], yAxisID: 'y_wind',
                        showLine: false, parsing: false,
                        // pointStyle is set per-point in refreshKatyWeatherChart
                        // to pre-rotated custom arrow icons (see
                        // createWindArrowIcon) -- Chart.js's built-in point
                        // styles (triangle, etc.) are filled/symmetric shapes
                        // that don't read clearly as "pointing" in a direction.
                        pointStyle: [], pointRadius: 9,
                        borderColor: 'rgb(153, 102, 255)', backgroundColor: 'rgb(153, 102, 255)'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'nearest', axis: 'x', intersect: false },
                scales: {
                    x: { type: 'time' },
                    y_wind: {
                        type: 'linear', position: 'left', min: 0,
                        title: { display: true, text: 'Wind (mph)' }
                    }
                },
                plugins: {
                    legend: { display: true },
                    zoom: {
                        pan: { enabled: true, mode: 'x' },
                        zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
                    }
                }
            }
        });
        document.getElementById('katyWindChart').addEventListener('dblclick', () => katyWindChartInstance.resetZoom());
    }

    // Start SSE connections
    connectTempMonitorSSE();
    connectSumpMonitorSSE();

    // Load initial historical data based on default dropdown selection
    const initialHours = parseInt(document.getElementById('history-range').value, 10);
    currentSumpRangeHours = initialHours;
    fetchTempMonitorHistoricalData(initialHours);
    fetchSumpHistoricalData(initialHours); 
    refreshKatyWeatherChart(initialHours);
    
    // ======================= CALL THE NEW ANALYTICS FETCH =======================
    fetchSumpAnalyticsData();

    // Periodically rebuild the sump charts from source data (CSV history) so
    // they pick up new readings without live-appending raw points on top of
    // aggregated bins. Runs on a timer independent of the SSE live feed.
    setInterval(() => {
        fetchSumpHistoricalData(currentSumpRangeHours);
    }, SUMP_CHART_REFRESH_INTERVAL_MS);

    // Diagnostics panel: render immediately, then keep the relative "X ago"
    // fields (weather cache age, sump chart refresh age, CSV freshness)
    // ticking even when no new event has come in.
    renderDiagnostics();
    setInterval(renderDiagnostics, 30 * 1000);
});

// ... (rest of your script.js: history-range listener, resetZoomOnAllCharts, fetch functions, SSE connection functions) ...

// --- Event Listener for History Range Dropdown ---
document.getElementById('history-range').addEventListener('change', function() {
    const selectedHours = parseInt(this.value, 10);
    currentSumpRangeHours = selectedHours;
    fetchTempMonitorHistoricalData(selectedHours); // Renamed function
    fetchSumpHistoricalData(selectedHours);      // New function
    refreshKatyWeatherChart(selectedHours);
});

function fetchTempMonitorHistoricalData(rangeHours = 1) {
    console.log(`DEBUG: Fetching Temp Monitor historical data for last ${rangeHours} hours.`);

    if (!TEMP_MONITOR_HISTORY_CSV_URL || TEMP_MONITOR_HISTORY_CSV_URL.includes("YOUR_")) {
        console.error("DEBUG: TEMP_MONITOR_HISTORY_CSV_URL is not set or still a placeholder.");
        return;
    }

    fetch(TEMP_MONITOR_HISTORY_CSV_URL)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.text();
        })
        .then(csvText => {
            const lines = csvText.trim().split('\n');
            if (lines.length <= 1) {
                console.warn("DEBUG: Temp CSV has no data rows.");
                return;
            }

            // Diagnostics: how fresh is the underlying Google Sheet, regardless
            // of the currently-selected range (captured from the raw last row,
            // not the range-filtered data, so it stays meaningful even if the
            // sheet is stale relative to a short selected range).
            const lastRawCols = lines[lines.length - 1].split(',');
            const lastRawTs = new Date(lastRawCols[0]);
            if (!isNaN(lastRawTs.getTime())) {
                diagState.tempCsvLatest = lastRawTs.getTime();
                renderDiagnostics();
            }

            // Clear existing history arrays
            timeHistory.length = 0;
            fridgeHistory.length = 0;
            freezerHistory.length = 0;
            garageHistory.length = 0;
            heaterStatusHistory.length = 0;
            
            // --- NEW LOGIC FOR RUNTIME CALCULATION ---
            let totalHeaterRunTimeMs = 0; // Total runtime in milliseconds
            let runStartTime = null;      // Timestamp when a run cycle starts
            const now = new Date();

            // First, filter all relevant data points from the CSV into an array
            // This assumes the CSV is sorted chronologically
            const dataInRange = lines.slice(1).map(line => {
                const cols = line.split(',');
                const ts = new Date(cols[0]);
                if (isNaN(ts.getTime())) return null;

                const diffHours = (now - ts) / (1000 * 60 * 60);
                if (diffHours > rangeHours) return null;

                return {
                    ts: ts,
                    garage: parseFloat(cols[1]),
                    freezer: parseFloat(cols[2]),
                    fridge: parseFloat(cols[3]),
                    heaterStatus: parseInt(cols[5].trim().replace('\r', ''))
                };
            }).filter(p => p !== null); // Remove any null (invalid or out-of-range) entries

            // Now, iterate through the filtered data to calculate runtime and populate charts
            for (const point of dataInRange) {
                const { ts, heaterStatus } = point;

                // If heater turns ON and a run cycle wasn't already started
                if (heaterStatus === 1 && !runStartTime) {
                    runStartTime = ts;
                } 
                // If heater turns OFF and a run cycle WAS in progress
                else if (heaterStatus === 0 && runStartTime) {
                    const duration = ts.getTime() - runStartTime.getTime();
                    totalHeaterRunTimeMs += duration;
                    runStartTime = null; // Reset for the next cycle
                }

                // Push data to chart history arrays
                timeHistory.push(point.ts);
                fridgeHistory.push(point.fridge);
                freezerHistory.push(point.freezer);
                garageHistory.push(point.garage);
                heaterStatusHistory.push(point.heaterStatus);
            }

            // Edge Case: Handle a run cycle that is still active at the end of the time range
            if (runStartTime && timeHistory.length > 0) {
                const lastTimestamp = timeHistory[timeHistory.length - 1];
                const duration = lastTimestamp.getTime() - runStartTime.getTime();
                totalHeaterRunTimeMs += duration;
            }
            // --- END OF NEW LOGIC ---

            console.log(`DEBUG: Loaded ${timeHistory.length} points of fridge/freezer/garage history.`);

            // Update charts with the new data
            if (fridgeChartInstance) {
                fridgeChartInstance.data.labels = timeHistory;
                fridgeChartInstance.data.datasets[0].data = fridgeHistory;
                fridgeChartInstance.data.datasets[1].data = heaterStatusHistory;
                fridgeChartInstance.update();
            }
            if (freezerChartInstance) {
                freezerChartInstance.data.labels = timeHistory;
                freezerChartInstance.data.datasets[0].data = freezerHistory;
                freezerChartInstance.update();
            }
            if (garageChartInstance) {
                garageChartInstance.data.labels = timeHistory;
                garageChartInstance.data.datasets[0].data = garageHistory;
                garageChartInstance.update();
            }

            const fridgeMinMax = calculateMinMax(fridgeHistory);
            const freezerMinMax = calculateMinMax(freezerHistory);
            const garageMinMax = calculateMinMax(garageHistory);

            document.getElementById('fridge-stats').innerHTML = `H: <span class="temp-high">${fridgeMinMax.max?.toFixed(0)}°</span> / L: <span class="temp-low">${fridgeMinMax.min?.toFixed(0)}°</span>`;
            document.getElementById('freezer-stats').innerHTML = `H: <span class="temp-high">${freezerMinMax.max?.toFixed(0)}°</span> / L: <span class="temp-low">${freezerMinMax.min?.toFixed(0)}°</span>`;
            document.getElementById('garage-stats').innerHTML = `H: <span class="temp-high">${garageMinMax.max?.toFixed(0)}°</span> / L: <span class="temp-low">${garageMinMax.min?.toFixed(0)}°</span>`;

            // Update heater display with the calculated total run time
            if (liveHeaterValueElement) {
                const totalHeaterRunTimeSeconds = totalHeaterRunTimeMs / 1000;
            
                if (totalHeaterRunTimeSeconds >= 5400) {
                    // 5400 seconds = 90 minutes
                    const hours = Math.floor(totalHeaterRunTimeSeconds / 3600);
                    const minutes = Math.floor((totalHeaterRunTimeSeconds % 3600) / 60);
                    liveHeaterValueElement.textContent = minutes > 0 
                        ? `${hours}h ${minutes}m`
                        : `${hours}h`;
                } else if (totalHeaterRunTimeSeconds > 60) {
                    // Between 1 minute and 90 minutes
                    liveHeaterValueElement.textContent = `${(totalHeaterRunTimeSeconds / 60).toFixed(1)} min`;
                } else {
                    // Under 1 minute
                    liveHeaterValueElement.textContent = `${Math.round(totalHeaterRunTimeSeconds)} s`;
                }
            }

            if (heaterStatusHistory.length > 0 && liveHeaterStatusElement) {
                const lastHeaterStatus = heaterStatusHistory[heaterStatusHistory.length - 1];
                liveHeaterStatusElement.textContent = lastHeaterStatus === 1 ? "On" : "Off";
            }
            
           if (timeHistory.length > 0) {
                  getOrFetchMasterWeatherData().then(weatherData => {
                      const mappedTemps = timeHistory.map(t => {
                          const hourTs = Math.floor(new Date(t).getTime() / 3600000) * 3600000;
                          // Get the temp property from the master data
                          return weatherData.get(hourTs)?.temp ?? null;
                      });

                      // Rebuild outdoorTempHistory IN PLACE (rather than swapping in a
                      // brand-new array) so it stays the same array reference the live
                      // SSE handler pushes into below -- otherwise live points would
                      // silently stop showing up on the Outdoor Temp overlay.
                      outdoorTempHistory.length = 0;
                      outdoorTempHistory.push(...mappedTemps);

                      if (garageChartInstance) {
                          const outdoorDataset = garageChartInstance.data.datasets.find(d => d.label === "Outdoor Temp (°F)");
                          if (outdoorDataset) {
                              outdoorDataset.data = outdoorTempHistory;
                              garageChartInstance.update();
                          }
                      }
                  });
              }
        })
        .catch(err => {
            logDiagError("Temp Monitor history fetch", err);
        });
}

// --- Fetch Historical Data for Sump Pump ---
// Picks a precip/SinceRun bar interval based on the selected history range,
// so bars don't become too thin to read at wider ranges.
function getSumpPrecipBinSizeMs(rangeHours) {
    const HOUR_MS = 3600000;
    if (rangeHours <= 24) return HOUR_MS;        // hourly bars: 1, 2, 4, 12, 24hr ranges
    if (rangeHours <= 48) return 3 * HOUR_MS;    // 3-hour bars: 48hr range
    return 12 * HOUR_MS;                          // 12-hour bars: 1 week range
}

function fetchSumpHistoricalData(rangeHours) {
    console.log(`DEBUG: Fetching Sump Pump historical data for last ${rangeHours} hours.`);

    if (!SUMP_HISTORY_CSV_URL || SUMP_HISTORY_CSV_URL.includes("YOUR_")) {
        console.error("DEBUG: SUMP_HISTORY_CSV_URL not set or still using placeholder.");
        return;
    }

    fetch(SUMP_HISTORY_CSV_URL)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.text();
        })
        .then(csvText => {
            const lines = csvText.trim().split('\n');
            if (lines.length <= 1) {
                console.warn("DEBUG: Sump CSV has no data rows.");
                return;
            }

            const header = lines.shift().split(',');
            const tsIdx = header.findIndex(h => h.toLowerCase().includes('timestamp'));
            const runtimeIdx = header.findIndex(h => h.toLowerCase().includes('sumpruntime'));
            const sinceRunIdx = header.findIndex(h => h.toLowerCase().includes('timesince'));
            const tempIdx = header.findIndex(h => h.toLowerCase().includes('temp'));

            if ([tsIdx, runtimeIdx, sinceRunIdx, tempIdx].some(i => i === -1)) {
              console.error("DEBUG: Could not find one or more required Sump columns in header:", header);
              return;
            }

            // Diagnostics: freshness of the underlying Google Sheet, from the
            // raw last row (unfiltered by the selected range).
            if (lines.length > 0) {
                const lastRawCols = lines[lines.length - 1].split(',');
                const lastRawTs = new Date(lastRawCols[tsIdx]);
                if (!isNaN(lastRawTs.getTime())) {
                    diagState.sumpCsvLatest = lastRawTs.getTime();
                }
            }
            diagState.sumpChartLastRefresh = Date.now();
            renderDiagnostics();

            // Clear old data
            sumpTimeHistory.length = 0;
            sumpTempHistory.length = 0;
            sumpRuntimeHistory.length = 0;
            sumpSinceRunHistory.length = 0;

            const now = new Date();
            lines.forEach(line => {
                const cols = line.split(',');
                const ts = new Date(cols[tsIdx]);
                if (isNaN(ts.getTime())) return;

                const diffHours = (now - ts) / (1000 * 60 * 60);
                if (diffHours > rangeHours) return;

                sumpTimeHistory.push(ts);
                sumpTempHistory.push(parseFloat(cols[tempIdx]));
                sumpRuntimeHistory.push(parseFloat(cols[runtimeIdx]));
                sumpSinceRunHistory.push(parseFloat(cols[sinceRunIdx]));
            });

            console.log(`DEBUG: Loaded ${sumpTimeHistory.length} sump points.`);

            // First, update the charts that DON'T need weather data.
            if (sumpTempChartInstance) {
                sumpTempChartInstance.data.labels = sumpTimeHistory;
                sumpTempChartInstance.data.datasets[0].data = sumpTempHistory;
                sumpTempChartInstance.update();
            }
            if (sumpRuntimeChartInstance) {
                sumpRuntimeChartInstance.data.labels = sumpTimeHistory;
                sumpRuntimeChartInstance.data.datasets[0].data = sumpRuntimeHistory;
                sumpRuntimeChartInstance.update();
            }
            // --- BIN-SIZE-AWARE AGGREGATION LOGIC ---
            // Bar width scales with the selected range so precip bars stay readable:
            //   <=24hr -> hourly bins, 48hr -> 3-hour bins, 1 week -> daily bins
            getOrFetchMasterWeatherData().then(weatherData => {
                if (sumpTimeHistory.length === 0) return;

                const binSizeMs = getSumpPrecipBinSizeMs(rangeHours);
                const getBinStart = (ts) => Math.floor(new Date(ts).getTime() / binSizeMs) * binSizeMs;

                const bins = new Map();

                // 1. Create bins for the ENTIRE time range first
                const startTime = getBinStart(sumpTimeHistory[0]);
                const endTime = getBinStart(sumpTimeHistory[sumpTimeHistory.length - 1]);

                for (let binStart = startTime; binStart <= endTime; binStart += binSizeMs) {
                    // Sum every hourly precip reading that falls inside this bin
                    // (for hourly bins this is just the single hour's value, same as before)
                    let precipSum = 0;
                    for (let hourTs = binStart; hourTs < binStart + binSizeMs; hourTs += 3600000) {
                        precipSum += weatherData.get(hourTs)?.precip ?? 0;
                    }
                    bins.set(binStart, { sinceRunValues: [], precip: precipSum });
                }

                // 2. Now, add the sump data into the appropriate, existing bins
                for (let i = 0; i < sumpTimeHistory.length; i++) {
                    const binKey = getBinStart(sumpTimeHistory[i]);
                    if (bins.has(binKey)) {
                        bins.get(binKey).sinceRunValues.push(sumpSinceRunHistory[i]);
                    }
                }
                
                // 3. Sort the bins and create final chart arrays
                const sortedKeys = Array.from(bins.keys()).sort((a, b) => a - b);
                
                const binnedLabels = sortedKeys.map(key => new Date(key));
                const binnedSumpData = sortedKeys.map(key => {
                    const values = bins.get(key).sinceRunValues;
                    return values.length > 0 ? values[values.length - 1] : null;
                });
                const binnedPrecipData = sortedKeys.map(key => bins.get(key).precip);

                // 4. Update the chart with the correctly aggregated data
                if (sumpSinceRunChartInstance) {
                    sumpSinceRunChartInstance.data.labels = binnedLabels;
                    sumpSinceRunChartInstance.data.datasets[0].data = binnedSumpData;
                    sumpSinceRunChartInstance.data.datasets[1].data = binnedPrecipData;
                    sumpSinceRunChartInstance.update();
                }
            });
        })
        .catch(error => {
            logDiagError("Sump history fetch", error);
        });
}

// --- Function to Connect to Temp Monitor SSE ---
function connectTempMonitorSSE() {
    //console.log("DEBUG: Initializing Temp Monitor connection.");
    if (!TEMP_MONITOR_DEVICE_ID || TEMP_MONITOR_DEVICE_ID === "YOUR_FRIDGE_FREEZER_DEVICE_ID_HERE" || !TEMP_MONITOR_ACCESS_TOKEN || TEMP_MONITOR_ACCESS_TOKEN === "YOUR_FRIDGE_FREEZER_ACCESS_TOKEN_HERE") {
         console.error("DEBUG: Temp Monitor Device ID or Access Token not set (checked in connect function).");
         tempMonitorStatusElement.textContent = "Config Error!";
         tempMonitorStatusElement.style.color = 'red';
        return;
    }

    const sseUrl = `https://api.particle.io/v1/devices/${TEMP_MONITOR_DEVICE_ID}/events/${TEMP_MONITOR_EVENT_NAME}?access_token=${TEMP_MONITOR_ACCESS_TOKEN}`;
    //console.log(`DEBUG: Attempting Temp Monitor SSE connection (Token Hidden)`);
    tempMonitorStatusElement.textContent = "Connecting...";
    tempMonitorStatusElement.style.color = '#555';

    const eventSource = new EventSource(sseUrl);

    eventSource.onopen = function() {
        console.log("DEBUG: Temp Monitor SSE Connected!");
        tempMonitorStatusElement.textContent = "Connected";
        tempMonitorStatusElement.style.color = 'green';
        diagState.tempConn = "Connected";
        renderDiagnostics();
    };

    eventSource.addEventListener(TEMP_MONITOR_EVENT_NAME, function(event) {
        try {
            const particleEventData = JSON.parse(event.data);
            const jsonData = JSON.parse(particleEventData.data); // This is your {"garage":..., "freezer":..., etc}
            const timestamp = new Date(particleEventData.published_at);

            console.log("DEBUG: Temp Monitor data received:", jsonData); // Log the received data

            // --- Update Live Text Display ---
            if (jsonData.fridge !== undefined) liveFridgeElement.textContent = jsonData.fridge.toFixed(1);
            if (jsonData.freezer !== undefined) liveFreezerElement.textContent = jsonData.freezer.toFixed(1);
            if (jsonData.garage !== undefined) liveGarageElement.textContent = jsonData.garage.toFixed(1);
            
            // --- Update New Heater Display Elements ---
           /* if (jsonData.heater !== undefined && liveHeaterValueElement) {
                liveHeaterValueElement.textContent = jsonData.heater.toFixed(2); // Assuming it's a numeric value
            }*/
            if (jsonData.heateron !== undefined && liveHeaterStatusElement) {
                liveHeaterStatusElement.textContent = (jsonData.heateron === 1 || jsonData.heateron === "1") ? "On" : "Off";
            }
            // --- End New Heater Display ---

            tempMonitorLastUpdatedElement.textContent = timestamp.toLocaleTimeString();
            tempMonitorStatusElement.textContent = "Receiving data";
            tempMonitorStatusElement.style.color = 'green';

            // --- Update Data History & Charts (existing fridge/freezer/garage charts) ---
            timeHistory.push(timestamp);
            fridgeHistory.push(jsonData.fridge);
            freezerHistory.push(jsonData.freezer);
            garageHistory.push(jsonData.garage);

            // Keep the fridge chart's Heater Status overlay in step with the
            // primary arrays -- it used to only get rebuilt on a full history
            // fetch, so it would drift out of alignment as live points came in.
            const heaterStatusValue = (jsonData.heateron === 1 || jsonData.heateron === "1") ? 1 : 0;
            heaterStatusHistory.push(heaterStatusValue);

            // Same for the garage chart's Outdoor Temp overlay. This is a plain
            // read against the already-cached weather Map (no new fetch), so it
            // won't trigger extra Visual Crossing API calls on every live event.
            const hourTs = Math.floor(timestamp.getTime() / 3600000) * 3600000;
            const outdoorTempValue = masterWeatherCache.data.get(hourTs)?.temp ?? null;
            outdoorTempHistory.push(outdoorTempValue);

            if (timeHistory.length > MAX_HISTORY_POINTS) {
                timeHistory.shift(); fridgeHistory.shift(); freezerHistory.shift(); garageHistory.shift();
                heaterStatusHistory.shift(); outdoorTempHistory.shift();
            }

            if (fridgeChartInstance) { fridgeChartInstance.data.labels = timeHistory; fridgeChartInstance.data.datasets[0].data = fridgeHistory; fridgeChartInstance.data.datasets[1].data = heaterStatusHistory; fridgeChartInstance.update(); }
            if (freezerChartInstance) { freezerChartInstance.data.labels = timeHistory; freezerChartInstance.data.datasets[0].data = freezerHistory; freezerChartInstance.update(); }
            if (garageChartInstance) { garageChartInstance.data.labels = timeHistory; garageChartInstance.data.datasets[0].data = garageHistory; garageChartInstance.data.datasets[1].data = outdoorTempHistory; garageChartInstance.update(); }

            diagState.tempConn = "Receiving data";
            renderDiagnostics();

        } catch (error) {
            console.error("DEBUG: Error processing Temp Monitor event data:", error, "Raw data:", event.data);
            tempMonitorStatusElement.textContent = "Data Error";
            tempMonitorStatusElement.style.color = 'orange';
            logDiagError("Temp Monitor SSE parse", error);
        }
    }, false);

    eventSource.onerror = function(err) {
        console.error("DEBUG: Temp Monitor EventSource failed:", err);
        const statusText = (err.target && err.target.readyState === EventSource.CLOSED) ? 'Conn. Closed' : "Conn. Error";
        tempMonitorStatusElement.textContent = statusText;
        tempMonitorStatusElement.style.color = 'red';
        diagState.tempConn = statusText;
        renderDiagnostics();
    };
}

// --- Function to Connect to Sump Monitor SSE ---
function connectSumpMonitorSSE() {
    // console.log("DEBUG: Initializing Sump Monitor connection.");
     if (!SUMP_MONITOR_DEVICE_ID || SUMP_MONITOR_DEVICE_ID === "YOUR_SUMP_PUMP_DEVICE_ID_HERE" || !SUMP_MONITOR_ACCESS_TOKEN || SUMP_MONITOR_ACCESS_TOKEN === "YOUR_SUMP_PUMP_ACCESS_TOKEN_HERE") {
        console.error("DEBUG: Sump Monitor Device ID or Access Token not set (checked in connect function).");
        sumpMonitorStatusElement.textContent = "Config Error!";
        sumpMonitorStatusElement.style.color = 'red';
        return;
    }

    const sseUrl = `https://api.particle.io/v1/devices/${SUMP_MONITOR_DEVICE_ID}/events/${SUMP_MONITOR_EVENT_NAME}?access_token=${SUMP_MONITOR_ACCESS_TOKEN}`;
    //console.log(`DEBUG: Attempting Sump Monitor SSE connection (Token Hidden)`);
    sumpMonitorStatusElement.textContent = "Connecting...";
     sumpMonitorStatusElement.style.color = '#555';

    const eventSource = new EventSource(sseUrl);

    eventSource.onopen = function() {
        //console.log("DEBUG: Sump Monitor SSE Connected!");
        sumpMonitorStatusElement.textContent = "Connected";
        sumpMonitorStatusElement.style.color = 'green';
        diagState.sumpConn = "Connected";
        renderDiagnostics();
    };

    eventSource.addEventListener(SUMP_MONITOR_EVENT_NAME, function(event) {
        try {
            const particleEventData = JSON.parse(event.data);
            const jsonData = JSON.parse(particleEventData.data);
            const timestamp = new Date(particleEventData.published_at);

            console.log("DEBUG: Parsed sump data:", jsonData);

            // --- Update Live Text Display (Sump) ---
            if (jsonData.temp !== undefined) sumpTempElement.textContent = jsonData.temp.toFixed(1);
            if (jsonData.extPower !== undefined) sumpPowerElement.textContent = jsonData.extPower.toFixed(2);
            if (jsonData.sumpRunTime !== undefined) sumpRuntimeElement.textContent = jsonData.sumpRunTime.toFixed(1);
            if (jsonData.timeSinceRun !== undefined) sumpSinceRunElement.textContent = jsonData.timeSinceRun.toFixed(1);

            sumpMonitorLastUpdatedElement.textContent = timestamp.toLocaleTimeString();
            sumpMonitorStatusElement.textContent = "Receiving data";
            sumpMonitorStatusElement.style.color = 'green';

            // NOTE: Sump charts are intentionally NOT updated here on every live
            // sumpData event. Raw live points used to get appended directly on
            // top of history that (for the SinceRun/Precip chart) is aggregated
            // into bins, which is what caused the "weird" chart glitches. Charts
            // now refresh by periodically re-fetching and re-aggregating the
            // full history instead (see SUMP_CHART_REFRESH_INTERVAL_MS below).

            // --- Diagnostics: surface the firmware's own health counters ---
            diagState.sumpConn = "Receiving data";
            if (jsonData.droppedEvents !== undefined) diagState.sumpDropped = jsonData.droppedEvents;
            if (jsonData.publishFails !== undefined) diagState.sumpFails = jsonData.publishFails;
            renderDiagnostics();

        } catch (error) {
            console.error("DEBUG: Error processing Sump Monitor event data:", error, "Raw data:", event.data);
            sumpMonitorStatusElement.textContent = "Data Error";
            sumpMonitorStatusElement.style.color = 'orange';
            logDiagError("Sump SSE parse", error);
        }
    }, false);

     eventSource.onerror = function(err) {
        console.error("DEBUG: Sump Monitor EventSource failed:", err);
        const statusText = (err.target && err.target.readyState === EventSource.CLOSED) ? 'Conn. Closed' : "Conn. Error";
        sumpMonitorStatusElement.textContent = statusText;
        sumpMonitorStatusElement.style.color = 'red';
        diagState.sumpConn = statusText;
        renderDiagnostics();
    };
}
/**
 * The single function responsible for fetching 7 days of weather data from the API.
 * This should only be called by the controller function below.
 */
// Fetches ~8 days of gridded hourly precip estimates from IEM Reanalysis
// (mesonet.agron.iastate.edu) -- radar-based Stage IV, bias-corrected against
// gauge networks -- for our coordinates, and returns Map<hourEpochMs,
// precipInches>. This is the precip source specifically, replacing KATY's own
// gauge: that sensor is confirmed out of service (PNO flag in its METARs), so
// a single broken point instrument isn't usable, but a gridded radar-based
// estimate isn't dependent on any one station's hardware. Free, no API key.
async function fetchIemrePrecipData() {
    console.log("DEBUG: Fetching precip data from IEM Reanalysis (IEMRE).");
    const precipMap = new Map();

    // IEMRE's hourly endpoint takes one *local* (Central time) calendar day
    // per request, not a UTC window, so requesting 8 UTC-calendar days back
    // (instead of exactly 7) gives a small safety margin against day-boundary
    // mismatches between UTC and Central time -- any overlap is harmless
    // since entries end up keyed by their actual UTC hour timestamp anyway.
    for (let i = 0; i < 8; i++) {
        const day = new Date(Date.now() - i * 24 * 3600000);
        const dayStr = day.toISOString().split('T')[0];
        const url = `https://mesonet.agron.iastate.edu/iemre/hourly/${dayStr}/${NWS_LATITUDE}/${NWS_LONGITUDE}/json`;

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP error ${res.status} for day ${dayStr}`);
            const json = await res.json();
            const rows = json.data || [];

            for (const row of rows) {
                if (!row.valid_utc || row.hourly_precip_in === undefined || row.hourly_precip_in === null) continue;
                const hourTs = Math.floor(new Date(row.valid_utc).getTime() / 3600000) * 3600000;
                // hourly_precip_in is already in inches -- no unit conversion
                // needed, which sidesteps the exact class of bug the NWS
                // mm-vs-meters mixup caused.
                precipMap.set(hourTs, row.hourly_precip_in);
            }
        } catch (dayError) {
            console.error(`DEBUG: IEMRE precip fetch failed for day ${dayStr}:`, dayError);
        }

        if (i < 7) {
            await new Promise(resolve => setTimeout(resolve, 150));
        }
    }

    console.log(`DEBUG: IEMRE returned ${precipMap.size} hourly precip buckets.`);
    return precipMap;
}

// Fetches ~7 days of hourly station observations from NWS/NOAA and returns
// them in the exact same shape the rest of the dashboard already expects:
// Map<hourEpochMs, {temp: °F, precip: inches}>. Keeping that output contract
// means nothing downstream (precip binning, outdoor-temp overlay, caching)
// needed to change -- only the data source did.
async function fetchMasterWeatherData() {
    console.log("DEBUG: Fetching 7-day master weather data from NWS/NOAA.");
    const weatherDataMap = new Map();
    // Tracks the observation timestamp actually used for each hour bucket, so
    // that if two reports (e.g. a routine + a special METAR) land in the same
    // hour, we keep the more recent one rather than double-counting/overwriting
    // with an older report.
    const bucketObsTime = new Map();

    try {
        const stationId = await resolveNwsStation();
        if (!stationId) throw new Error("No NWS station resolved");

        // Fetch one day at a time rather than one wide 7-day request. A single
        // wide request can silently cap out at however many records the API
        // returns per call -- we hit exactly this with a combined request,
        // which only came back with ~3 days for a station reporting more often
        // than hourly. Day-sized windows stay comfortably under any such cap
        // regardless of reporting frequency, at the cost of 7 small requests
        // instead of 1 (still trivial for an unauthenticated, keyless API).
        for (let i = 0; i < 7; i++) {
            const dayEnd = new Date(Date.now() - i * 24 * 3600000);
            const dayStart = new Date(dayEnd.getTime() - 24 * 3600000);
            const url = `https://api.weather.gov/stations/${stationId}/observations?start=${dayStart.toISOString()}&end=${dayEnd.toISOString()}&limit=500`;

            try {
                const res = await fetch(url, { headers: { 'Accept': 'application/geo+json' } });
                if (!res.ok) throw new Error(`HTTP error ${res.status} for day offset ${i}`);
                const json = await res.json();
                const features = json.features || [];

                for (const feature of features) {
                    const p = feature.properties || {};
                    if (!p.timestamp) continue;
                    const obsTime = new Date(p.timestamp).getTime();
                    const hourTs = Math.floor(obsTime / 3600000) * 3600000;

                    // Only overwrite a bucket if this observation is newer than
                    // whatever's already in it (station data isn't always exactly
                    // hourly -- special reports can land mid-hour).
                    if (bucketObsTime.has(hourTs) && bucketObsTime.get(hourTs) >= obsTime) continue;
                    bucketObsTime.set(hourTs, obsTime);

                    const tempC = p.temperature && p.temperature.value;
                    const tempF = (tempC === null || tempC === undefined) ? null : (tempC * 9 / 5 + 32);

                    // Precip itself is filled in separately below from IEMRE
                    // (KATY's own gauge is confirmed out of service), so it's
                    // just a placeholder here -- not read from this station.
                    weatherDataMap.set(hourTs, { temp: tempF, precip: 0 });
                }
            } catch (dayError) {
                console.error(`DEBUG: NWS observation fetch failed for day offset ${i}:`, dayError);
            }

            // Small stagger between requests -- not required by NWS (no API key,
            // no published hard rate limit), just being a polite client.
            if (i < 6) {
                await new Promise(resolve => setTimeout(resolve, 150));
            }
        }

        console.log(`DEBUG: NWS station ${stationId} returned ${weatherDataMap.size} hourly buckets across 7 daily requests.`);

        // Merge in precip from IEMRE (radar-based, not dependent on KATY's
        // broken gauge), overwriting just the precip field per hour bucket
        // while leaving KATY's temp readings untouched. If an hour has an
        // IEMRE precip value but no KATY temp entry (a gap in KATY's own
        // reporting), still record it so precip isn't silently dropped.
        const precipMap = await fetchIemrePrecipData();
        for (const [hourTs, precipIn] of precipMap.entries()) {
            const existing = weatherDataMap.get(hourTs);
            if (existing) {
                existing.precip = precipIn;
            } else {
                weatherDataMap.set(hourTs, { temp: null, precip: precipIn });
            }
        }
    } catch (error) {
        console.error("DEBUG: NWS master weather fetch failed:", error);
        diagState.lastError = `${new Date().toLocaleTimeString()} - NWS weather fetch: ${error.message}`;
        renderDiagnostics();
    }

    return weatherDataMap;
}

/**
 * Controller function that decides whether to return cached data or fetch new data.
 * All chart functions should call this to get weather data.
 */
/**
 * Controller function that decides whether to return cached data or fetch new data.
 * It now checks three levels: localStorage, in-memory cache, and then fetches from the API.
 */
// Guards against concurrent callers (temp monitor + sump monitor both load
// around the same time on page load) each seeing a stale cache and firing
// their own redundant fetch. Cleared once the in-flight fetch settles.
let masterWeatherFetchPromise = null;

async function getOrFetchMasterWeatherData() {
    const now = Date.now();

    // --- NEW: Step 1 - Check for a valid cache in localStorage ---
    try {
        const cachedItem = localStorage.getItem('masterWeatherCache');
        if (cachedItem) {
            const parsedCache = JSON.parse(cachedItem);
            const isCurrentVersion = parsedCache.version === WEATHER_CACHE_VERSION;
            // Check if the localStorage cache is still valid (less than 30 mins old)
            if (isCurrentVersion && now - parsedCache.timestamp < MASTER_CACHE_DURATION) {
                console.log("DEBUG: Using master weather cache from localStorage.");
                // Restore the Map data structure from the stored array
                masterWeatherCache.data = new Map(parsedCache.data);
                masterWeatherCache.timestamp = parsedCache.timestamp;
                diagState.weatherCacheTimestamp = masterWeatherCache.timestamp;
                renderDiagnostics();
                return masterWeatherCache.data;
            }
            if (!isCurrentVersion) {
                console.log("DEBUG: Cached weather data is from an old data source version, discarding.");
                localStorage.removeItem('masterWeatherCache');
            }
        }
    } catch (error) {
        console.error("DEBUG: Could not read weather cache from localStorage.", error);
    }

    // --- Step 2 - Check the in-memory cache (for the current session) ---
    if (now - masterWeatherCache.timestamp < MASTER_CACHE_DURATION && masterWeatherCache.data.size > 0) {
        console.log("DEBUG: Using master weather cache (in-memory).");
        diagState.weatherCacheTimestamp = masterWeatherCache.timestamp;
        renderDiagnostics();
        return masterWeatherCache.data;
    }

    // --- Step 3 - Fetch new data if all caches are stale or empty ---
    // If a fetch is already in flight (e.g. triggered by another chart a
    // moment ago), piggyback on it instead of starting a second one.
    if (masterWeatherFetchPromise) {
        console.log("DEBUG: Weather fetch already in flight, reusing it.");
        return masterWeatherFetchPromise;
    }

    console.log("DEBUG: Master weather cache is stale or empty. Triggering new fetch.");
    masterWeatherFetchPromise = fetchMasterWeatherData();
    let newWeatherData;
    try {
        newWeatherData = await masterWeatherFetchPromise;
    } finally {
        masterWeatherFetchPromise = null;
    }
    
    if (newWeatherData.size > 0) {
        // Update the in-memory cache
        masterWeatherCache.data = newWeatherData;
        masterWeatherCache.timestamp = Date.now();
        diagState.weatherCacheTimestamp = masterWeatherCache.timestamp;
        renderDiagnostics();

        // --- NEW: Step 4 - Save the newly fetched data to localStorage ---
        try {
            // Convert the Map to an array to make it compatible with JSON.stringify
            const dataToStore = Array.from(masterWeatherCache.data.entries());
            const cacheToSave = {
                data: dataToStore,
                timestamp: masterWeatherCache.timestamp,
                version: WEATHER_CACHE_VERSION
            };
            localStorage.setItem('masterWeatherCache', JSON.stringify(cacheToSave));
            console.log("DEBUG: Saved new weather data to localStorage for future sessions.");
        } catch (error) {
            console.error("DEBUG: Could not save weather cache to localStorage.", error);
        }
    } else {
        console.error("DEBUG: Master weather fetch returned no data. Cache not updated.");
        diagState.lastError = `${new Date().toLocaleTimeString()} - Weather fetch: returned no data`;
        renderDiagnostics();
    }
    
    return masterWeatherCache.data;
}

// ======================= SUMP PUMP ANALYTICS FUNCTIONS =======================

/**
 * Processes raw sump data to calculate runs per day and updates the bar chart.
 * @param {Array} sumpData - An array of objects with { ts, sinceRun, runTime } properties.
 */
function processSumpAnalytics(sumpData) {
    if (sumpData.length === 0) {
        console.warn("DEBUG: No sump data to process for analytics.");
        return;
    }

    const runsByDay = new Map();
    let totalRuns = 0;

    // --- FIX: New, more reliable counting logic ---
    // Iterate over all data points
    for (const current of sumpData) {
        // A "run" is now detected if the runTime for that event is greater than 0.
        if (current.runTime > 0) {
            // Get the date based on the local timezone
            const ts = current.ts;
            const year = ts.getFullYear();
            const month = (ts.getMonth() + 1).toString().padStart(2, '0');
            const dayOfMonth = ts.getDate().toString().padStart(2, '0');
            const day = `${year}-${month}-${dayOfMonth}`;

            const count = (runsByDay.get(day) || 0) + 1;
            runsByDay.set(day, count);
            totalRuns++;
        }
    }
    // --- END OF FIX ---

    console.log(`DEBUG: Processed ${totalRuns} total sump runs across ${runsByDay.size} days.`);
    
    // Sort the labels chronologically before displaying
    const labels = [...runsByDay.keys()].sort();
    const data = labels.map(day => runsByDay.get(day));

    // Calculate the overall average
    const avgRunsPerDay = runsByDay.size > 0 ? (totalRuns / runsByDay.size).toFixed(1) : 0;

    if (sumpRunsPerDayChartInstance) {
        sumpRunsPerDayChartInstance.data.labels = labels;
        sumpRunsPerDayChartInstance.data.datasets[0].data = data;
        sumpRunsPerDayChartInstance.options.plugins.title = {
            display: true,
            text: `Daily Sump Pump Cycle Count (Last 90 Days) Avg: ${avgRunsPerDay} per day`
        };
        sumpRunsPerDayChartInstance.update();
    }
}
/**
 * Fetches the full sump history CSV for the last 90 days and processes it.
 * This runs independently of the dropdown-controlled history fetches.
 */
function fetchSumpAnalyticsData() {
    console.log("DEBUG: Fetching full sump pump history for analytics.");

    if (!SUMP_HISTORY_CSV_URL || SUMP_HISTORY_CSV_URL.includes("YOUR_")) {
        console.error("DEBUG: SUMP_HISTORY_CSV_URL not set.");
        return;
    }

    fetch(SUMP_HISTORY_CSV_URL)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.text();
        })
        .then(csvText => {
            const lines = csvText.trim().split('\n');
            if (lines.length <= 1) return;

            const header = lines.shift().split(',');
            const tsIdx = header.findIndex(h => h.toLowerCase().includes('timestamp'));
            const sinceRunIdx = header.findIndex(h => h.toLowerCase().includes('timesince'));
            // --- FIX: Also find the sumpRunTime column ---
            const runtimeIdx = header.findIndex(h => h.toLowerCase().includes('sumpruntime'));

            if (tsIdx === -1 || sinceRunIdx === -1 || runtimeIdx === -1) {
                console.error("DEBUG: Analytics requires 'timestamp', 'timeSinceRun', and 'sumpRunTime' columns in sump CSV.");
                return;
            }

            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

            const sumpData = lines.map(line => {
                const cols = line.split(',');
                const ts = new Date(cols[tsIdx]);
                // Filter out invalid dates and data older than 90 days
                if (isNaN(ts.getTime()) || ts < ninetyDaysAgo) {
                    return null;
                }
                return {
                    ts: ts,
                    sinceRun: parseFloat(cols[sinceRunIdx]),
                    // --- FIX: Add runTime to the data object ---
                    runTime: parseFloat(cols[runtimeIdx])
                };
            }).filter(item => item !== null); // Remove null entries

            processSumpAnalytics(sumpData);
        })
        .catch(error => {
            console.error("DEBUG: Failed to fetch sump history for analytics:", error);
        });
}

// ================================
// Fridge Heater Control Logic
// ================================

const FRIDGE_DEVICE_ID = TEMP_MONITOR_DEVICE_ID;
const FRIDGE_ACCESS_TOKEN = TEMP_MONITOR_ACCESS_TOKEN;

const FRIDGE_HEATER_VARIABLE_NAME = "FridgeHeaterEnabled"; // Your variable name
const FRIDGE_HEATER_FUNCTION_NAME = "setFridgeHeater";    // Your function name

// Get Elements ONCE (global scope)
const fridgeButton = document.getElementById("fridge-toggle-button");
const fridgeStatus = document.getElementById("fridge-toggle-status");

window.addEventListener("load", () => {
  // Add click listener after load
  fridgeButton?.addEventListener("click", toggleFridgeHeater);

  // Initialize state
  fetchFridgeHeaterState();
});

async function fetchFridgeHeaterState() {
  try {
    const resp = await fetch(`https://api.particle.io/v1/devices/${FRIDGE_DEVICE_ID}/${FRIDGE_HEATER_VARIABLE_NAME}?access_token=${FRIDGE_ACCESS_TOKEN}`);
    if (!resp.ok) {
      const errorText = await resp.text();
      console.error("Error response:", errorText);
      fridgeButton.textContent = "Error Loading State";
      return;
    }
    const data = await resp.json();
    console.log("Fridge Heater State:", data);
    if (data && "result" in data) {
      const isEnabled = data.result;
      updateFridgeButton(isEnabled);
    } else {
      console.error("Invalid response:", data);
      fridgeButton.textContent = "Error Loading State";
    }
  } catch (error) {
    console.error("Error fetching Fridge Heater state:", error);
    fridgeButton.textContent = "Error Loading State";
  }
}

function updateFridgeButton(isEnabled) {
  fridgeButton.textContent = isEnabled ? "Disable Fridge Heater" : "Enable Fridge Heater";
  fridgeStatus.textContent = `Fridge Heater is ${isEnabled ? "Enabled" : "Disabled"}`;
}

async function toggleFridgeHeater() {
  // --- THIS LINE IS THE FIX ---
  // If the button text includes "Enable", the action is "on". Otherwise, it's "off".
  const action = fridgeButton.textContent.includes("Enable") ? "on" : "off";

  try {
    const resp = await fetch(`https://api.particle.io/v1/devices/${FRIDGE_DEVICE_ID}/${FRIDGE_HEATER_FUNCTION_NAME}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `access_token=${FRIDGE_ACCESS_TOKEN}&args=${action}`
    });
    const data = await resp.json();
    if (data && data.return_value !== undefined) {
      // After a successful command, re-fetch the state to update the button.
      fetchFridgeHeaterState();
    } else {
      console.error("Error or invalid response from function call:", data);
      alert("Error sending command to device.");
    }
  } catch (error) {
    console.error("Error toggling Fridge Heater:", error);
    alert("Error toggling Fridge Heater.");
  }
}
// Init
fetchFridgeHeaterState();

// ===== DEVICE RESET FUNCTIONALITY (Options 1 & 3) =====
const resetButton = document.getElementById("device-reset-button");
const resetStatus = document.getElementById("device-reset-status");

if (resetButton) {
  console.log("✅ Reset button found and listener attached");
  resetButton.addEventListener("click", async function() {
    console.log("🔘 Reset button clicked!");
    
    if (!confirm("Are you sure you want to reset the Photon device?\n\nThis will:\n• Restart the device (~30 seconds)\n• Interrupt data collection briefly\n• Trigger automatic sensor reconnection if needed\n\nContinue?")) {
      return;
    }
    
    resetButton.disabled = true;
    resetButton.textContent = "🔄 Resetting...";
    resetStatus.textContent = "Reset in progress...";
    resetStatus.style.color = "orange";
    
    try {
      console.log("Sending reset function call to Photon...");
      
      // Call the reset FUNCTION on the device
      const resp = await fetch(`https://api.particle.io/v1/devices/${TEMP_MONITOR_DEVICE_ID}/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `access_token=${TEMP_MONITOR_ACCESS_TOKEN}&args=reset`
      });
      
      const data = await resp.json();
      console.log("Response from Particle:", data);
      
      // Check if it's a timeout error (which is actually expected during reset)
      if ((resp.ok && data.return_value !== undefined) || data.error === 'Timed out.') {
        resetStatus.textContent = "✅ Reset command sent! Device will restart in ~10-15 seconds...";
        resetStatus.style.color = "green";
        console.log("Reset initiated successfully!");
        
        // Re-enable button after 30 seconds
        setTimeout(() => {
          resetButton.disabled = false;
          resetButton.textContent = "🔄 Reset Photon Device";
          resetStatus.textContent = "";
        }, 30000);
      } else {
        throw new Error(data.error || "Unknown error from Particle Cloud: " + resp.status);
      }
    } catch (error) {
      console.error("Error resetting device:", error);
      resetStatus.textContent = "❌ Error: " + error.message;
      resetStatus.style.color = "red";
      resetButton.disabled = false;
      resetButton.textContent = "🔄 Reset Photon Device";
    }
  });
}
// ===== END DEVICE RESET FUNCTIONALITY =====

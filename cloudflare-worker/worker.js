// worker.js -- ET Home dashboard's backend Worker.
//
// The dashboard used to embed a raw Particle access token directly in
// client-side JS, which gave anyone viewing page source full account access
// to both devices (read everything, rename devices, call `reset`, toggle the
// fridge heater). Particle doesn't offer scoped/read-only tokens outside its
// paid Product/organization tier, so the only real fix is to stop shipping
// the token to the browser at all.
//
// This Worker holds the real token as a hidden secret (PARTICLE_TOKEN, set
// via the Cloudflare dashboard or `wrangler secret put`, never committed to
// the repo) and exposes ONLY the fixed operations the dashboard actually
// needs. There's no generic "call any function on any device" passthrough --
// device IDs and function names are hardcoded below, not accepted from the
// caller, so even someone who finds this Worker's URL can't pivot into
// acting on a different device or a different function.
//
// This narrows a leak from "full account control" down to "can watch the
// event streams, and (with the PIN) toggle the fridge heater or reset a
// board" -- smaller, but not a full auth system. The Worker's own URL is
// still public (it has to be, the browser calls it directly), so this is
// about reducing blast radius, not achieving a login-gated dashboard.
//
// Besides proxying Particle, the Worker runs on a 5-minute Cron Trigger to:
//   - poll the Nest thermostat and keep its history (Nest has no history API),
//   - keep a per-day total of heating/cooling run time, and
//   - check that every data source is still alive, sending a phone
//     notification when one has been down for a while (see "Alerts" below).

const SUMP_DEVICE_ID     = "3b0055000851353531343431";
const TEMP_DEVICE_ID     = "240039000e47353136383631";
const AQUARIUM_DEVICE_ID = "230043001347353136383631"; // particle.io → Devices

// -- Nest thermostat (indoor temp/humidity/HVAC status) --
// Non-secret identifiers -- safe to hardcode here just like the Particle
// device IDs above. Only the OAuth client secret and refresh token (used
// below via env.NEST_CLIENT_SECRET / env.NEST_REFRESH_TOKEN) are sensitive.
const NEST_PROJECT_ID = "c8083249-ed39-477e-8922-a2ee4a1eccdd";
const NEST_CLIENT_ID = "406796196865-vbbfrmegqiec5lq9q8ldqn2lj1ipr7v8.apps.googleusercontent.com";
const NEST_DEVICE_NAME = "enterprises/c8083249-ed39-477e-8922-a2ee4a1eccdd/devices/AVPHwEuzGOZULzgQujC6_8Q_YuRvsHLts6ccrX1kxcCwxRAH02vkoADSnNEQDd2kaGzctxC_zQ6s80JWV4vEsMNRDszVnw";
// Nest's API only exposes *current* state, not history, so this Worker
// builds its own history by polling on a Cron Trigger (see `scheduled`
// below) and storing readings in KV -- a single JSON array under one key,
// trimmed to a retention window, rather than one KV entry per reading (KV's
// free tier is generous on reads but tight on writes/lists).
const NEST_HISTORY_KV_KEY = "nest:history";
const NEST_HISTORY_RETENTION_MS = 7 * 24 * 3600 * 1000; // 7 days
const NEST_POLL_MINUTES = 5; // must match the cron schedule in wrangler.toml

// Per-day HVAC run time, kept much longer than the raw history: one small
// object per day ({ heatMin, coolMin, ... }) under a single key.
const NEST_DAILY_KV_KEY = "nest:daily";
const NEST_DAILY_RETENTION_DAYS = 90;
// Days are split at local midnight, not UTC midnight.
const LOCAL_TIME_ZONE = "America/Chicago";
// NWS observation station used for the outdoor temperature stored with each
// reading (the same station the dashboard's weather charts use).
const NWS_STATION_ID = "KATY";

// -- Alerts --
// A problem must persist this long before a notification goes out, so a
// board that drops off for one poll doesn't buzz a phone.
const ALERT_AFTER_MS = 10 * 60 * 1000;
// While a problem stays unresolved, repeat the notification this often.
const ALERT_REMIND_AFTER_MS = 12 * 3600 * 1000;
const ALERT_STATE_KV_KEY = "alerts:state";
// Notifications are sent by publishing this Particle event, which the
// account's existing "pushbullet" webhook (the one the firmware already
// uses) forwards to Pushbullet -- so no extra credentials are needed here.
const ALERT_EVENT_NAME = "pushbullet";
const NEST_STALE_ALERT_MS = 20 * 60 * 1000;
const DEVICE_OFFLINE_ALERT_MS = 15 * 60 * 1000;
const MONITORED_DEVICES = [
    { key: "temp",     id: TEMP_DEVICE_ID,     label: "Fridge/freezer monitor board" },
    { key: "sump",     id: SUMP_DEVICE_ID,     label: "Sump pump monitor board" },
    { key: "aquarium", id: AQUARIUM_DEVICE_ID, label: "Aquarium monitor board" },
];

// -- PIN lockout --
// After this many wrong PINs from one address, PIN-protected routes refuse
// every attempt (even a correct one) from that address for the lockout time.
const PIN_MAX_FAILS = 5;
const PIN_LOCKOUT_SECONDS = 15 * 60;

// Restrict CORS to known dashboard origins. Note: this stops casual
// browser-based abuse (another site embedding/calling this), but it is NOT
// a real access-control boundary -- a non-browser client (curl, a script)
// can ignore CORS entirely. The actual protection here is the narrow,
// hardcoded route set above, not this header.
//
// A CORS response can only ever name ONE origin, so supporting multiple
// valid ones (custom domain + the original github.io URL, which may still
// get used for testing) means checking the actual request's Origin header
// against an allowlist and echoing back whichever one matches, rather than
// a single hardcoded value -- a mismatch here doesn't error server-side,
// it just makes the browser silently refuse to let the page's JS read an
// otherwise-successful response.
const ALLOWED_ORIGINS = [
    "https://theethome.com",
    "https://www.theethome.com",
    "https://etilberg.github.io",
];

function corsHeadersFor(request) {
    const origin = request.headers.get("Origin");
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Action-Pin",
        "Vary": "Origin",
    };
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const corsHeaders = corsHeadersFor(request);

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            if (url.pathname === "/events/sump" && request.method === "GET") {
                return proxySse(`https://api.particle.io/v1/devices/${SUMP_DEVICE_ID}/events/sumpData`, env, corsHeaders);
            }

            if (url.pathname === "/events/temp" && request.method === "GET") {
                return proxySse(`https://api.particle.io/v1/devices/${TEMP_DEVICE_ID}/events/GarageWebHook`, env, corsHeaders);
            }

            if (url.pathname === "/fridge-heater-state" && request.method === "GET") {
                const resp = await fetch(
                    `https://api.particle.io/v1/devices/${TEMP_DEVICE_ID}/FridgeHeaterEnabled?access_token=${env.PARTICLE_TOKEN}`
                );
                return jsonResponse(await resp.text(), resp.status, corsHeaders);
            }

            if (url.pathname === "/fridge-heater-toggle" && request.method === "POST") {
                const denied = await pinGate(request, env, corsHeaders);
                if (denied) return denied;
                const body = await request.json().catch(() => ({}));
                // Strict allowlist -- never pass the caller's value straight
                // through to Particle's `args` field.
                const action = body.action === "on" ? "on" : "off";
                const resp = await fetch(`https://api.particle.io/v1/devices/${TEMP_DEVICE_ID}/setFridgeHeater`, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: `access_token=${env.PARTICLE_TOKEN}&args=${action}`,
                });
                return jsonResponse(await resp.text(), resp.status, corsHeaders);
            }

            if (url.pathname === "/reset-device" && request.method === "POST") {
                const denied = await pinGate(request, env, corsHeaders);
                if (denied) return denied;
                const resp = await fetch(`https://api.particle.io/v1/devices/${TEMP_DEVICE_ID}/reset`, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: `access_token=${env.PARTICLE_TOKEN}&args=reset`,
                });
                return jsonResponse(await resp.text(), resp.status, corsHeaders);
            }

            if (url.pathname === "/reset-aquarium" && request.method === "POST") {
                const denied = await pinGate(request, env, corsHeaders);
                if (denied) return denied;
                const resp = await fetch(`https://api.particle.io/v1/devices/${AQUARIUM_DEVICE_ID}/reset`, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: `access_token=${env.PARTICLE_TOKEN}&args=reset`,
                });
                return jsonResponse(await resp.text(), resp.status, corsHeaders);
            }

            // Sends one test notification through the alert channel, so the
            // Worker -> Particle -> Pushbullet path can be confirmed on
            // demand. PIN-gated because it buzzes a real phone.
            if (url.pathname === "/alert-test" && request.method === "POST") {
                const denied = await pinGate(request, env, corsHeaders);
                if (denied) return denied;
                const result = await sendAlert(env, "ET Home: test alert from the dashboard. Alerts are working.");
                return jsonResponse(
                    JSON.stringify(result.ok ? { sent: true } : { sent: false, error: result.error }),
                    result.ok ? 200 : 502,
                    corsHeaders
                );
            }

            // Both Nest routes serve from KV rather than calling Google live on
            // every request -- readings only actually change as often as the
            // Cron Trigger polls (see `scheduled` below), so there's no benefit
            // to a live call here, and it keeps Google API usage bounded and
            // predictable regardless of how often the dashboard is loaded.
            if (url.pathname === "/nest/current" && request.method === "GET") {
                const history = await readNestHistory(env);
                const latest = history.length > 0 ? history[history.length - 1] : null;
                return jsonResponse(JSON.stringify({ latest }), 200, corsHeaders);
            }

            if (url.pathname === "/nest/history" && request.method === "GET") {
                const history = await readNestHistory(env);
                return jsonResponse(JSON.stringify({ history }), 200, corsHeaders);
            }

            if (url.pathname === "/nest/daily" && request.method === "GET") {
                const daily = (await readNestDaily(env)) || {};
                return jsonResponse(JSON.stringify({ daily: formatNestDaily(daily) }), 200, corsHeaders);
            }

            // What the alert check currently sees. Read-only and free of
            // secrets; mainly here so alerting can be verified without
            // waiting for a real failure.
            if (url.pathname === "/health" && request.method === "GET") {
                return jsonResponse(JSON.stringify(await getHealthSnapshot(env)), 200, corsHeaders);
            }

            return new Response("Not found", { status: 404, headers: corsHeaders });
        } catch (err) {
            return jsonResponse(JSON.stringify({ error: err.message }), 500, corsHeaders);
        }
    },

    // Cron Trigger entry point (declared in wrangler.toml) -- polls the Nest
    // device and stores the reading, then runs the alert check. Not tied to
    // any dashboard page load.
    async scheduled(event, env, ctx) {
        ctx.waitUntil(runScheduled(env));
    },
};

async function runScheduled(env) {
    const poll = await pollNestAndStore(env);
    try {
        await checkHealthAndAlert(env, poll);
    } catch (err) {
        console.error(`DEBUG: Alert check failed: ${err.message}`);
    }
}

// Streams a Particle SSE event feed straight through, attaching the real
// token server-side. EventSource in the browser can't send custom headers,
// so the token has to be added here rather than passed in by the client.
async function proxySse(upstreamUrl, env, corsHeaders) {
    const resp = await fetch(`${upstreamUrl}?access_token=${env.PARTICLE_TOKEN}`);
    return new Response(resp.body, {
        status: resp.status,
        headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    });
}

function jsonResponse(bodyText, status, corsHeaders) {
    return new Response(bodyText, {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

// Gate for the state-changing routes (heater toggle, board resets, test
// alert). Returns null when the PIN is correct, otherwise the Response to
// send back: 403 for a wrong/missing PIN, 429 once the caller's address has
// used up its wrong guesses.
//
// Still a deterrent rather than a strong security boundary: the lockout is
// per address, and KV counters can lag by a few seconds, so it slows a
// guesser down enormously rather than stopping one outright.
//
// If ACTION_PIN isn't set as a Cloudflare secret, this fails closed (blocks
// every action) rather than fails open.
async function pinGate(request, env, corsHeaders) {
    const address = request.headers.get("CF-Connecting-IP") || "unknown";
    const failKey = `pinfail:${address}`;

    let fails = 0;
    try {
        fails = parseInt(await env.NEST_KV.get(failKey), 10) || 0;
    } catch (err) {
        // If the counter can't be read, fall through to the plain PIN check.
    }
    if (fails >= PIN_MAX_FAILS) {
        return jsonResponse(
            JSON.stringify({ error: "Too many wrong PIN attempts. Try again in 15 minutes." }),
            429,
            corsHeaders
        );
    }

    const providedPin = request.headers.get("X-Action-Pin");
    if (providedPin !== null && env.ACTION_PIN && providedPin === env.ACTION_PIN) {
        return null;
    }

    try {
        await env.NEST_KV.put(failKey, String(fails + 1), { expirationTtl: PIN_LOCKOUT_SECONDS });
    } catch (err) {
        // Counting the failure is best-effort; the attempt is refused either way.
    }
    return jsonResponse(JSON.stringify({ error: "Invalid or missing PIN" }), 403, corsHeaders);
}

// --- Nest helpers ---

async function readNestHistory(env) {
    const raw = await env.NEST_KV.get(NEST_HISTORY_KV_KEY);
    return raw ? JSON.parse(raw) : [];
}

async function readNestDaily(env) {
    const raw = await env.NEST_KV.get(NEST_DAILY_KV_KEY);
    return raw ? JSON.parse(raw) : null;
}

// Google access tokens last 1 hour; the refresh token is long-lived (unless
// revoked, or left completely unused for 6+ months -- our own polling cadence
// naturally keeps it active). Refreshing once per poll is simple and, at a
// few-times-per-hour polling rate, comfortably cheap.
async function getNestAccessToken(env) {
    const resp = await fetch(
        `https://www.googleapis.com/oauth2/v4/token?client_id=${NEST_CLIENT_ID}&client_secret=${env.NEST_CLIENT_SECRET}&refresh_token=${env.NEST_REFRESH_TOKEN}&grant_type=refresh_token`,
        { method: "POST" }
    );
    if (!resp.ok) {
        // Google's OAuth error responses (e.g. {"error":"invalid_grant",
        // "error_description":"Token has been expired or revoked."}) don't
        // contain the secret or refresh token itself, just a description of
        // what's wrong -- safe to include in the thrown error for debugging.
        const errorBody = await resp.text().catch(() => '(could not read response body)');
        throw new Error(`Nest token refresh failed: HTTP ${resp.status} - ${errorBody}`);
    }
    const data = await resp.json();
    if (!data.access_token) throw new Error("Nest token refresh returned no access_token");
    return data.access_token;
}

async function fetchNestDeviceState(env) {
    const accessToken = await getNestAccessToken(env);
    const resp = await fetch(`https://smartdevicemanagement.googleapis.com/v1/${NEST_DEVICE_NAME}`, {
        headers: { "Authorization": `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error(`Nest device fetch failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const traits = data.traits || {};

    const tempC = traits["sdm.devices.traits.Temperature"]?.ambientTemperatureCelsius;
    const humidity = traits["sdm.devices.traits.Humidity"]?.ambientHumidityPercent;
    // "HEATING" | "COOLING" | "OFF" per Google's ThermostatHvac trait
    const hvacStatus = traits["sdm.devices.traits.ThermostatHvac"]?.status ?? null;

    const indoorTemp = (tempC === undefined || tempC === null) ? null : (tempC * 9 / 5 + 32);

    return {
        t: Date.now(),
        indoorTemp,
        humidity: humidity ?? null,
        hvacStatus,
    };
}

// Current outdoor temperature (°F) from the NWS station, or null if it
// can't be had right now -- it is a nice-to-have alongside each Nest
// reading, never a reason to lose the reading itself.
async function fetchOutdoorTempF() {
    try {
        const resp = await fetch(`https://api.weather.gov/stations/${NWS_STATION_ID}/observations/latest`, {
            headers: {
                "Accept": "application/geo+json",
                // api.weather.gov asks every client to identify itself.
                "User-Agent": "ethome-dashboard (https://theethome.com)",
            },
            signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) return null;
        const tempC = (await resp.json())?.properties?.temperature?.value;
        return (typeof tempC === "number") ? Math.round((tempC * 9 / 5 + 32) * 10) / 10 : null;
    } catch (err) {
        return null;
    }
}

// "YYYY-MM-DD" for the local calendar day containing this instant.
function localDayKey(ms) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: LOCAL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(ms));
}

// Adds one reading to the per-day totals. The time since the previous
// reading is credited to this reading's HVAC state -- capped, so a gap in
// polling (an outage) can't credit hours of run time to a single reading.
function addReadingToDaily(daily, reading, previousT) {
    const key = localDayKey(reading.t);
    const day = daily[key] || (daily[key] = { heatMin: 0, coolMin: 0, n: 0, outSum: 0, outN: 0, inSum: 0, inN: 0 });

    let minutes = NEST_POLL_MINUTES;
    if (typeof previousT === "number") {
        minutes = Math.min(Math.max((reading.t - previousT) / 60000, 0), 3 * NEST_POLL_MINUTES);
    }
    if (reading.hvacStatus === "HEATING") day.heatMin += minutes;
    else if (reading.hvacStatus === "COOLING") day.coolMin += minutes;

    day.n += 1;
    if (typeof reading.outdoorTemp === "number") { day.outSum += reading.outdoorTemp; day.outN += 1; }
    if (typeof reading.indoorTemp === "number") { day.inSum += reading.indoorTemp; day.inN += 1; }
}

function pruneNestDaily(daily, now) {
    const oldestKept = localDayKey(now - NEST_DAILY_RETENTION_DAYS * 24 * 3600 * 1000);
    for (const key of Object.keys(daily)) {
        if (key < oldestKept) delete daily[key];
    }
}

// Shape served to the dashboard: one row per day, oldest first.
function formatNestDaily(daily) {
    const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
    return Object.keys(daily).sort().map(key => {
        const day = daily[key];
        return {
            d: key,
            heatHours: round(day.heatMin / 60, 2),
            coolHours: round(day.coolMin / 60, 2),
            outdoorAvg: day.outN > 0 ? round(day.outSum / day.outN, 1) : null,
            indoorAvg: day.inN > 0 ? round(day.inSum / day.inN, 1) : null,
            samples: day.n,
        };
    });
}

// Returns { ok, latestT } so the alert check that follows doesn't need to
// read the history back out of KV just to learn how fresh it is.
async function pollNestAndStore(env) {
    try {
        const reading = await fetchNestDeviceState(env);
        reading.outdoorTemp = await fetchOutdoorTempF();

        const history = await readNestHistory(env);
        const previousT = history.length > 0 ? history[history.length - 1].t : null;
        history.push(reading);

        const cutoff = Date.now() - NEST_HISTORY_RETENTION_MS;
        const trimmed = history.filter(r => r.t >= cutoff);

        await env.NEST_KV.put(NEST_HISTORY_KV_KEY, JSON.stringify(trimmed));
        console.log(`DEBUG: Nest poll OK, history now ${trimmed.length} points.`);

        // Per-day totals. A failure here must not undo the reading above.
        try {
            let daily = await readNestDaily(env);
            if (daily === null) {
                // First run: rebuild what we can from the raw history
                // (which already includes the reading just taken).
                daily = {};
                let prev = null;
                for (const r of trimmed) {
                    addReadingToDaily(daily, r, prev);
                    prev = r.t;
                }
            } else {
                addReadingToDaily(daily, reading, previousT);
            }
            pruneNestDaily(daily, reading.t);
            await env.NEST_KV.put(NEST_DAILY_KV_KEY, JSON.stringify(daily));
        } catch (err) {
            console.error(`DEBUG: Nest daily totals update failed: ${err.message}`);
        }

        return { ok: true, latestT: reading.t };
    } catch (err) {
        console.error(`DEBUG: Nest poll failed: ${err.message}`);
        return { ok: false, latestT: null };
    }
}

// --- Health check and alerts ---

function describeAge(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "an unknown time";
    const minutes = Math.round(ms / 60000);
    if (minutes < 90) return `${minutes} min`;
    const hours = ms / 3600000;
    if (hours < 48) return `${hours.toFixed(1)} hours`;
    return `${(hours / 24).toFixed(1)} days`;
}

// Looks at each source the Worker can see for itself and returns
// { problems: [{ key, label, message }], notes: [string] }. `problems` are
// things worth a notification; `notes` are checks that couldn't be made
// (which is not, by itself, evidence that anything is wrong).
async function computeHealth(env, poll) {
    const now = Date.now();
    const problems = [];
    const notes = [];

    // Nest: is the stored history still being added to?
    let nestLatestT = poll && poll.ok ? poll.latestT : null;
    if (nestLatestT === null) {
        try {
            const history = await readNestHistory(env);
            nestLatestT = history.length > 0 ? history[history.length - 1].t : null;
        } catch (err) {
            notes.push(`Nest history unreadable: ${err.message}`);
        }
    }
    if (nestLatestT === null) {
        notes.push("No Nest readings stored yet");
    } else if (now - nestLatestT > NEST_STALE_ALERT_MS) {
        problems.push({
            key: "nest",
            label: "Nest thermostat data",
            message: `Nest thermostat data has stopped updating (last reading ${describeAge(now - nestLatestT)} ago)`,
        });
    }

    // Particle boards: one device-list call covers all three.
    try {
        const resp = await fetch(`https://api.particle.io/v1/devices?access_token=${env.PARTICLE_TOKEN}`, {
            signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) {
            notes.push(`Particle device list unavailable (HTTP ${resp.status})`);
        } else {
            const devices = await resp.json();
            for (const monitored of MONITORED_DEVICES) {
                const device = Array.isArray(devices) ? devices.find(d => d.id === monitored.id) : null;
                if (!device) {
                    notes.push(`${monitored.label} not found in the Particle device list`);
                    continue;
                }
                const online = device.online ?? device.connected;
                const lastHeardMs = Date.parse(device.last_heard);
                const silentMs = now - lastHeardMs;
                // Both conditions, to stay conservative: Particle says the
                // board is offline AND it hasn't been heard from in a while.
                if (online === false && (!Number.isFinite(silentMs) || silentMs > DEVICE_OFFLINE_ALERT_MS)) {
                    problems.push({
                        key: `device:${monitored.key}`,
                        label: monitored.label,
                        message: `${monitored.label} is offline (last heard ${describeAge(silentMs)} ago)`,
                    });
                }
            }
        }
    } catch (err) {
        notes.push(`Particle device list unavailable (${err.message})`);
    }

    return { problems, notes };
}

// Publishes the alert as a Particle event; the account's webhook for that
// event name delivers it. Returns { ok, error } and never throws.
async function sendAlert(env, message) {
    try {
        const resp = await fetch("https://api.particle.io/v1/devices/events", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                access_token: env.PARTICLE_TOKEN,
                name: ALERT_EVENT_NAME,
                data: message,
                private: "true",
                ttl: "60",
            }).toString(),
        });
        if (resp.ok) return { ok: true, error: null };
        let detail = "";
        try {
            const body = await resp.json();
            detail = body.error_description || body.error || "";
        } catch (err) { /* non-JSON error body */ }
        return { ok: false, error: `Particle refused the event (HTTP ${resp.status}${detail ? `: ${detail}` : ""})` };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

// Runs after every poll. Tracks how long each problem has been present (in
// KV, written only when something changes) and sends:
//   - an alert once a problem has lasted ALERT_AFTER_MS,
//   - a reminder every ALERT_REMIND_AFTER_MS while it stays unresolved,
//   - a "recovered" note when a problem that was alerted goes away.
// With ALERTS_ENABLED != "true" (see wrangler.toml) it still tracks problem
// start times but sends nothing and records nothing as sent, so switching
// alerts on later immediately reports anything that is already down.
async function checkHealthAndAlert(env, poll) {
    const health = await computeHealth(env, poll);
    const enabled = env.ALERTS_ENABLED === "true";
    const now = Date.now();

    let state = {};
    try {
        state = JSON.parse((await env.NEST_KV.get(ALERT_STATE_KV_KEY)) || "{}") || {};
    } catch (err) {
        state = {};
    }
    const before = JSON.stringify(state);

    const activeKeys = new Set(health.problems.map(p => p.key));

    for (const problem of health.problems) {
        const entry = state[problem.key] || (state[problem.key] = { since: now, alertedAt: null, label: problem.label });
        if (!enabled) continue;

        const due = entry.alertedAt === null
            ? now - entry.since >= ALERT_AFTER_MS
            : now - entry.alertedAt >= ALERT_REMIND_AFTER_MS;
        if (!due) continue;

        const prefix = entry.alertedAt === null ? "ET Home alert" : "ET Home reminder";
        const result = await sendAlert(env, `${prefix}: ${problem.message}`);
        if (result.ok) entry.alertedAt = now;
        else console.error(`DEBUG: Alert send failed: ${result.error}`);
    }

    for (const key of Object.keys(state)) {
        if (activeKeys.has(key)) continue;
        if (enabled && state[key].alertedAt !== null) {
            const result = await sendAlert(env, `ET Home: ${state[key].label} is back to normal.`);
            if (!result.ok) console.error(`DEBUG: Recovery notice send failed: ${result.error}`);
        }
        delete state[key];
    }

    const after = JSON.stringify(state);
    if (after !== before) {
        await env.NEST_KV.put(ALERT_STATE_KV_KEY, after);
    }
    return health;
}

// /health answers from a short-lived in-memory copy, so repeated requests
// can't be used to hammer the Particle API through this Worker.
let healthMemo = { at: 0, value: null };

async function getHealthSnapshot(env) {
    const now = Date.now();
    if (healthMemo.value && now - healthMemo.at < 60 * 1000) return healthMemo.value;

    const health = await computeHealth(env, null);
    const value = {
        ok: health.problems.length === 0,
        problems: health.problems.map(p => p.message),
        notes: health.notes,
        alertsEnabled: env.ALERTS_ENABLED === "true",
        checkedAt: new Date(now).toISOString(),
    };
    healthMemo = { at: now, value };
    return value;
}

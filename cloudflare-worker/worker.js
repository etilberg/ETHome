// worker.js -- ET Home dashboard's Particle Cloud proxy.
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
// the repo) and exposes ONLY the five fixed operations the dashboard
// actually needs. There's no generic "call any function on any device"
// passthrough -- device IDs and function names are hardcoded below, not
// accepted from the caller, so even someone who finds this Worker's URL
// can't pivot into acting on a different device or a different function.
//
// This narrows a leak from "full account control" down to "can watch the
// event streams, toggle the fridge heater, or reset the temp monitor" --
// smaller, but not a full auth system. The Worker's own URL is still public
// (it has to be, the browser calls it directly), so this is about reducing
// blast radius, not achieving a login-gated dashboard.

const SUMP_DEVICE_ID = "3b0055000851353531343431";
const TEMP_DEVICE_ID = "240039000e47353136383631";

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

// Restrict CORS to the dashboard's own origin. Note: this stops casual
// browser-based abuse (another site embedding/calling this), but it is NOT
// a real access-control boundary -- a non-browser client (curl, a script)
// can ignore CORS entirely. The actual protection here is the narrow,
// hardcoded route set above, not this header.
const DASHBOARD_ORIGIN = "https://etilberg.github.io";
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": DASHBOARD_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

export default {
    async fetch(request, env) {
        // TEMPORARY DIAGNOSTIC -- remove once the token issue is confirmed
        // fixed. Logs only length + first/last 2 chars, never the full
        // secret, so this is safe to leave in Cloudflare's own private logs
        // briefly but should still be removed once we're done debugging.
        const t = env.PARTICLE_TOKEN || '';
        console.log(`DIAG: PARTICLE_TOKEN length=${t.length} first2=${t.slice(0, 2)} last2=${t.slice(-2)}`);

        const url = new URL(request.url);

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: CORS_HEADERS });
        }

        try {
            if (url.pathname === "/events/sump" && request.method === "GET") {
                return proxySse(`https://api.particle.io/v1/devices/${SUMP_DEVICE_ID}/events/sumpData`, env);
            }

            if (url.pathname === "/events/temp" && request.method === "GET") {
                return proxySse(`https://api.particle.io/v1/devices/${TEMP_DEVICE_ID}/events/GarageWebHook`, env);
            }

            if (url.pathname === "/fridge-heater-state" && request.method === "GET") {
                const resp = await fetch(
                    `https://api.particle.io/v1/devices/${TEMP_DEVICE_ID}/FridgeHeaterEnabled?access_token=${env.PARTICLE_TOKEN}`
                );
                return jsonResponse(await resp.text(), resp.status);
            }

            if (url.pathname === "/fridge-heater-toggle" && request.method === "POST") {
                const body = await request.json().catch(() => ({}));
                // Strict allowlist -- never pass the caller's value straight
                // through to Particle's `args` field.
                const action = body.action === "on" ? "on" : "off";
                const resp = await fetch(`https://api.particle.io/v1/devices/${TEMP_DEVICE_ID}/setFridgeHeater`, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: `access_token=${env.PARTICLE_TOKEN}&args=${action}`,
                });
                return jsonResponse(await resp.text(), resp.status);
            }

            if (url.pathname === "/reset-device" && request.method === "POST") {
                const resp = await fetch(`https://api.particle.io/v1/devices/${TEMP_DEVICE_ID}/reset`, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: `access_token=${env.PARTICLE_TOKEN}&args=reset`,
                });
                return jsonResponse(await resp.text(), resp.status);
            }

            // Both Nest routes serve from KV rather than calling Google live on
            // every request -- readings only actually change as often as the
            // Cron Trigger polls (see `scheduled` below), so there's no benefit
            // to a live call here, and it keeps Google API usage bounded and
            // predictable regardless of how often the dashboard is loaded.
            if (url.pathname === "/nest/current" && request.method === "GET") {
                const history = await readNestHistory(env);
                const latest = history.length > 0 ? history[history.length - 1] : null;
                return jsonResponse(JSON.stringify({ latest }), 200);
            }

            if (url.pathname === "/nest/history" && request.method === "GET") {
                const history = await readNestHistory(env);
                return jsonResponse(JSON.stringify({ history }), 200);
            }

            return new Response("Not found", { status: 404, headers: CORS_HEADERS });
        } catch (err) {
            return jsonResponse(JSON.stringify({ error: err.message }), 500);
        }
    },

    // Cron Trigger entry point (configured in the Cloudflare dashboard, see
    // cloudflare-worker/README.md) -- polls the Nest device on a schedule and
    // appends the reading to KV. Not tied to any dashboard page load.
    async scheduled(event, env, ctx) {
        ctx.waitUntil(pollNestAndStore(env));
    },
};

// Streams a Particle SSE event feed straight through, attaching the real
// token server-side. EventSource in the browser can't send custom headers,
// so the token has to be added here rather than passed in by the client.
async function proxySse(upstreamUrl, env) {
    const resp = await fetch(`${upstreamUrl}?access_token=${env.PARTICLE_TOKEN}`);
    return new Response(resp.body, {
        status: resp.status,
        headers: {
            ...CORS_HEADERS,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    });
}

function jsonResponse(bodyText, status) {
    return new Response(bodyText, {
        status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
}

// --- Nest helpers ---

async function readNestHistory(env) {
    const raw = await env.NEST_KV.get(NEST_HISTORY_KV_KEY);
    return raw ? JSON.parse(raw) : [];
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

async function pollNestAndStore(env) {
    try {
        const reading = await fetchNestDeviceState(env);
        const history = await readNestHistory(env);
        history.push(reading);

        const cutoff = Date.now() - NEST_HISTORY_RETENTION_MS;
        const trimmed = history.filter(r => r.t >= cutoff);

        await env.NEST_KV.put(NEST_HISTORY_KV_KEY, JSON.stringify(trimmed));
        console.log(`DEBUG: Nest poll OK, history now ${trimmed.length} points.`);
    } catch (err) {
        console.error(`DEBUG: Nest poll failed: ${err.message}`);
    }
}

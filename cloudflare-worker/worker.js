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
        "Access-Control-Allow-Headers": "Content-Type",
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
                const resp = await fetch(`https://api.particle.io/v1/devices/${TEMP_DEVICE_ID}/reset`, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: `access_token=${env.PARTICLE_TOKEN}&args=reset`,
                });
                return jsonResponse(await resp.text(), resp.status, corsHeaders);
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

            return new Response("Not found", { status: 404, headers: corsHeaders });
        } catch (err) {
            return jsonResponse(JSON.stringify({ error: err.message }), 500, corsHeaders);
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

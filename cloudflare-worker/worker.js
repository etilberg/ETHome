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

            return new Response("Not found", { status: 404, headers: CORS_HEADERS });
        } catch (err) {
            return jsonResponse(JSON.stringify({ error: err.message }), 500);
        }
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

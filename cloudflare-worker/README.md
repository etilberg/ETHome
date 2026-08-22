# ET Home backend Worker

A small Cloudflare Worker that stands between the dashboard and two external
services -- the Particle Cloud API and Google's Nest Smart Device Management
(SDM) API -- so real credentials never ship to the browser.

## Why this exists

The dashboard used to call `api.particle.io` directly with the token
embedded in client-side JS -- fully visible to anyone viewing page source.
Particle only offers scoped/read-only tokens on its paid Product tier, so for
a personal account there was no way to shrink what that token could do. This
Worker holds the real token as a hidden secret and exposes only the five
fixed operations the dashboard needs (two event streams, read heater state,
toggle heater, reset device) -- nothing generic, no arbitrary
device/function passthrough.

The Nest integration (added later) follows the same principle: Google OAuth
credentials and the long-lived refresh token stay server-side as Cloudflare
secrets, never in the repo or the browser.

## One-time setup: Particle proxy

1. Create a free Cloudflare account if you don't have one.
2. In the Cloudflare dashboard: **Workers & Pages -> Create -> Connect to
   Git**, select the `ETHome` repo, and set the **root directory** to
   `cloudflare-worker` so Cloudflare only builds this subfolder.
3. Once the Worker exists: **Settings -> Variables and Secrets -> Add
   secret** -- name `PARTICLE_TOKEN`, value your real Particle access token.
   Never put this in a file that gets committed.
4. Note the deployed Worker's URL (e.g. `https://ethome.<your-subdomain>.workers.dev`)
   and put it in `config.js` as `PARTICLE_PROXY_BASE_URL`.

## One-time setup: Nest thermostat

Nest's API only exposes *current* device state, not history, so this Worker
polls on a schedule (Cron Trigger) and builds its own history in KV storage.

1. **Register for Device Access** at console.nest.google.com/device-access
   (personal Google/gmail account only, not Workspace) -- one-time $5 fee.
2. **Create a Google Cloud project + OAuth Client ID** via the Get Started
   flow at developers.google.com/nest/device-access/get-started. Choose
   **Web Server**, and use `https://www.google.com` as the redirect URI
   (Google's own fixed value for the manual/personal-use flow).
3. **Create a Device Access project** in the Device Access Console using
   that Client ID -- this gives you a Project ID (a UUID).
4. **Authorize your account** by visiting (with your real Project ID and
   Client ID substituted in):
   ```
   https://nestservices.google.com/partnerconnections/PROJECT-ID/auth?redirect_uri=https://www.google.com&access_type=offline&prompt=consent&client_id=CLIENT-ID&response_type=code&scope=https://www.googleapis.com/auth/sdm.service
   ```
   Grant access, then copy the `code` param from the `google.com` redirect.
5. **Exchange the code for tokens** (in a terminal, not in a browser):
   ```
   curl.exe -L -X POST "https://www.googleapis.com/oauth2/v4/token?client_id=CLIENT-ID&client_secret=CLIENT-SECRET&code=CODE&grant_type=authorization_code&redirect_uri=https://www.google.com"
   ```
   This returns an `access_token` (short-lived, used once below) and a
   `refresh_token` (long-lived -- this is what the Worker actually uses).
6. **Complete authorization** with the required `devices.list` call, which
   also reveals your thermostat's device ID:
   ```
   curl.exe -X GET "https://smartdevicemanagement.googleapis.com/v1/enterprises/PROJECT-ID/devices" -H "Authorization: Bearer ACCESS-TOKEN"
   ```
7. In `worker.js`, `NEST_PROJECT_ID`, `NEST_CLIENT_ID`, and `NEST_DEVICE_NAME`
   are hardcoded (non-secret identifiers, same pattern as the Particle
   device IDs). Update them if you ever re-authorize with a different
   project/device.
8. Add two secrets in the Cloudflare dashboard (Settings -> Variables and
   Secrets): `NEST_CLIENT_SECRET` and `NEST_REFRESH_TOKEN`. Secrets stay
   dashboard-only by design and survive every deploy correctly -- only
   bindings and observability needed the fix below.
9. Create a KV namespace (Storage & Databases -> KV -> Create) named
   `NEST_KV`, if one doesn't already exist. The binding itself is declared
   in `wrangler.toml` (`[[kv_namespaces]]`, pointing at this namespace's
   ID) -- **not** something to add by hand in Settings -> Bindings. We
   originally documented it as a manual dashboard step and it kept getting
   silently wiped every time a code push triggered a fresh deploy, because
   anything not declared in `wrangler.toml` doesn't survive `wrangler
   deploy`. If you ever recreate the namespace, update the `id` in
   `wrangler.toml` to match.
10. The Cron Trigger (`*/5 * * * *`) and Logs (`[observability]`) are also
    declared in `wrangler.toml` for the same reason -- they should just
    work after deploying, no separate dashboard step needed. If you ever
    see Nest data stop updating, check Settings -> Trigger Events and
    Settings -> Observability to confirm both are still showing enabled;
    if either got manually toggled in the dashboard without a matching
    `wrangler.toml` change, the next code deploy will reset it.

**Note on refresh token handling:** if a refresh token is ever accidentally
exposed (e.g. pasted somewhere it shouldn't be), revoke it immediately at
https://nestservices.google.com/partnerconnections and redo steps 4-6 to get
a clean one -- Google doesn't let you invalidate just the exposure, only the
whole authorization.

## Ongoing changes

Because this folder is connected via Cloudflare's Git integration, pushing a
change to `cloudflare-worker/worker.js` (e.g. through the same GitHub
upload flow used for the rest of the dashboard) automatically redeploys the
Worker -- no separate manual deploy step. Secrets, bindings, and the Cron
Trigger are untouched by code deploys and only need to be set once, or
re-set if you ever rotate a credential.

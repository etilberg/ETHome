# ET Home Particle proxy

A small Cloudflare Worker that stands between the dashboard and the Particle
Cloud API, so the real Particle access token never ships to the browser.

## Why this exists

The dashboard used to call `api.particle.io` directly with the token
embedded in client-side JS -- fully visible to anyone viewing page source.
Particle only offers scoped/read-only tokens on its paid Product tier, so for
a personal account there was no way to shrink what that token could do. This
Worker holds the real token as a hidden secret and exposes only the five
fixed operations the dashboard needs (two event streams, read heater state,
toggle heater, reset device) -- nothing generic, no arbitrary
device/function passthrough.

## One-time setup

1. Create a free Cloudflare account if you don't have one.
2. In the Cloudflare dashboard: **Workers & Pages -> Create -> Connect to
   Git**, select the `ETHome` repo, and set the **root directory** to
   `cloudflare-worker` so Cloudflare only builds this subfolder.
3. Once the Worker exists: **Settings -> Variables and Secrets -> Add
   secret** -- name `PARTICLE_TOKEN`, value your real Particle access token.
   Never put this in a file that gets committed.
4. Note the deployed Worker's URL (looks like
   `https://ethome-particle-proxy.<your-subdomain>.workers.dev`) and put it
   in `config.js` as `PARTICLE_PROXY_BASE_URL`.

## Ongoing changes

Because this folder is connected via Cloudflare's Git integration, pushing a
change to `cloudflare-worker/worker.js` (e.g. through the same GitHub
upload flow used for the rest of the dashboard) automatically redeploys the
Worker -- no separate manual deploy step. The secret itself is untouched by
deploys and only needs to be set once, or re-set if you ever rotate the
Particle token.

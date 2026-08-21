// config.js - Configuration for Particle Dashboard
// config.js

// -- Weather (National Weather Service / NOAA, api.weather.gov) --
// Coordinates of the monitored property. Used once on load to resolve the
// nearest NWS observation station (for current conditions + historical
// precip) and forecast gridpoint (for the daily high/low + synopsis text).
// No API key needed -- api.weather.gov is free, public, and unauthenticated.
const NWS_LATITUDE = 44.925639;
const NWS_LONGITUDE = -97.101472;

// -- Particle Cloud proxy --
// All Particle API calls (event streams, heater control, device reset) go
// through a small Cloudflare Worker instead of api.particle.io directly, so
// the real access token stays server-side instead of sitting in this public
// file. See cloudflare-worker/README.md for setup. Replace this with your
// deployed Worker's URL (no trailing slash).
const PARTICLE_PROXY_BASE_URL = "https://ethome.etilberg.workers.dev";

// -- Device 1: Fridge/Freezer Monitor --
const TEMP_MONITOR_DEVICE_ID = "240039000e47353136383631";

// -- Device 2: Sump Pump Monitor --
const SUMP_MONITOR_DEVICE_ID = "3b0055000851353531343431";

// --- Other Shared Configuration ---
const TEMP_MONITOR_EVENT_NAME = "GarageWebHook"; // As per your config (1).js
const SUMP_MONITOR_EVENT_NAME = "sumpData";
const MAX_HISTORY_POINTS = 1440; // Max points for LIVE data appending to charts

// --- Historical Data URLs (CSV from Google Sheets "Publish to web") ---
// This was GOOGLE_APPS_SCRIPT_URL, assuming it's the CSV link for Temp Monitor
//const GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyInmR24-KePk5B61OqiCAEbm6ZkMKqDdK3Hb8EPxvjaj8AWS1OOxoLaHlXHMjbFF0AIQ/exec';
const TEMP_MONITOR_HISTORY_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRph0sdeOMbpa_5nOIC36yVgte5zWbxEXCVy6GMzB6ehhkV49_M_KMJAMx2HHM8XAi9hN2KvO83aR9b/pub?gid=0&single=true&output=csv'; // <<< VERIFY/REPLACE THIS with your actual Temp Monitor CSV publish URL
const SUMP_HISTORY_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ0LM82FFJEkD7h0B5FFjA34S-WS7CKgr3zaOLBAA7n8ybLrZ60NbBoDQl-pukkckuesAmlQOfnbbyI/pub?output=csv'; // <<< REPLACE THIS with the URL from "Publish to web" for Sump Pump data
 /* the CSV_URL is from:
  Publish your Google Sheet to the web
  Open the sheet
  Click File > Share > Publish to Web
  Select the correct sheet and CSV format*/

// --- End of Configuration ---
console.log("DEBUG: config.js loaded.");
if (typeof GOOGLE_APPS_SCRIPT_URL !== 'undefined') { // Cleanup if old variable exists
    console.warn("DEBUG: Old GOOGLE_APPS_SCRIPT_URL found in config.js, consider removing it if TEMP_MONITOR_HISTORY_CSV_URL is used for CSV fetching.");
}

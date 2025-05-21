// config.js - Configuration for Particle Dashboard

// !! IMPORTANT: Replace these placeholders with your actual Device IDs and Access Tokens !!
// !! SECURITY WARNING: These values are still visible in browser source code.
// !! Avoid committing actual tokens to public repositories if security is critical.

// -- Device 1: Fridge/Freezer Monitor --
const TEMP_MONITOR_DEVICE_ID = "240039000e47353136383631"; // <--- REPLACE
const TEMP_MONITOR_ACCESS_TOKEN = "28f3c69720f69b2ffbdcdd0534b67f49e4f1030e"; // <--- REPLACE

// -- Device 2: Sump Pump Monitor --
const SUMP_MONITOR_DEVICE_ID = "3b0055000851353531343431"; // <--- REPLACE
const SUMP_MONITOR_ACCESS_TOKEN = "28f3c69720f69b2ffbdcdd0534b67f49e4f1030e"; // <--- REPLACE

// --- Other Shared Configuration (Optional) ---
// You could also move constants like these here if you prefer:
const TEMP_MONITOR_EVENT_NAME = "GarageWebHook";
const SUMP_MONITOR_EVENT_NAME = "sumpData";
const MAX_HISTORY_POINTS = 60; // History for Fridge/Freezer charts
// config.js (Add this line)
const GOOGLE_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwXVbrsQMkhaC_-J03nCy55ZzlueUfrVfZf6MRI4JHbYVxvBwyupZ2V16GacntwE_UF/exec"; // <--- REPLACE


// --- End of Configuration ---
console.log("DEBUG: config.js loaded.");

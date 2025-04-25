// Get references to the elements we'll update
const liveStatusElement = document.getElementById('live-status');
const liveFridgeElement = document.getElementById('live-fridge'); // Updated ID
const liveFreezerElement = document.getElementById('live-freezer'); // Updated ID
const liveGarageElement = document.getElementById('live-garage');   // New element
const lastUpdatedElement = document.getElementById('last-updated');
const historicalContainer = document.getElementById('historical-chart-container');

console.log("Dashboard script loaded.");
liveStatusElement.textContent = "Script loaded, preparing connection...";

// --- Live Data Logic ---

// --- Configuration ---
// !! IMPORTANT: Replace these placeholders with your actual Device ID and Access Token !!
// !! SECURITY WARNING: Putting your access token directly in client-side JavaScript
// !!               is a security risk if your code repository is public.
// !!               Consider using a backend proxy for better security in production.
const PARTICLE_DEVICE_ID = "240039000e47353136383631"; // <--- REPLACE THIS
const PARTICLE_ACCESS_TOKEN = "28f3c69720f69b2ffbdcdd0534b67f49e4f1030e"; // <--- REPLACE THIS
const PARTICLE_EVENT_NAME = "currentTemps"; // The event name published by your device
// -------------------

if (!PARTICLE_DEVICE_ID || PARTICLE_DEVICE_ID === "YOUR_DEVICE_ID_HERE" || !PARTICLE_ACCESS_TOKEN || PARTICLE_ACCESS_TOKEN === "YOUR_PARTICLE_ACCESS_TOKEN_HERE") {
    liveStatusElement.textContent = "Error 1: Device ID or Access Token not set in script.js!";
    liveStatusElement.style.color = 'red';
    console.error("Please set your PARTICLE_DEVICE_ID and PARTICLE_ACCESS_TOKEN in script.js");
} else {
    const sseUrl = `https://api.particle.io/v1/devices/${PARTICLE_DEVICE_ID}/events/${PARTICLE_EVENT_NAME}?access_token=${PARTICLE_ACCESS_TOKEN}`;

    console.log(`Attempting to connect to Particle Stream at: ${sseUrl.replace(PARTICLE_ACCESS_TOKEN, 'ACCESS_TOKEN_HIDDEN')}`); // Don't log token
    liveStatusElement.textContent = "Connecting to Particle...";
    liveStatusElement.style.color = '#555'; // Reset color

    const eventSource = new EventSource(sseUrl);

    eventSource.onopen = function() {
        console.log("Connected to Particle Event Stream!");
        liveStatusElement.textContent = "Connected";
        liveStatusElement.style.color = 'green';
    };

    eventSource.addEventListener(PARTICLE_EVENT_NAME, function(event) {
        // console.log("Raw event received:", event); // For debugging if needed
        try {
            // Particle event data is nested: { "data": "YOUR_JSON_STRING", "ttl": 60, "published_at": "ISO_DATE", "coreid": "DEVICE_ID", "name": "EVENT_NAME" }
            const particleEventData = JSON.parse(event.data);
            const jsonData = JSON.parse(particleEventData.data); // Parse the nested JSON string

            console.log("Parsed temperature data:", jsonData);

            // Update the HTML elements (using .toFixed(1) for one decimal place)
            if (jsonData.fridge !== undefined) {
                 liveFridgeElement.textContent = jsonData.fridge.toFixed(1);
            }
            if (jsonData.freezer !== undefined) {
                liveFreezerElement.textContent = jsonData.freezer.toFixed(1);
            }
            if (jsonData.garage !== undefined) {
                liveGarageElement.textContent = jsonData.garage.toFixed(1);
            }

            // Update the timestamp
            lastUpdatedElement.textContent = new Date(particleEventData.published_at).toLocaleTimeString();
            liveStatusElement.textContent = "Receiving data"; // Update status
            liveStatusElement.style.color = 'green'; // Keep it green while receiving

        } catch (error) {
            console.error("Error parsing event data:", error, "Raw data:", event.data);
            liveStatusElement.textContent = "Data parsing error";
            liveStatusElement.style.color = 'orange';
        }
    }, false);

    eventSource.onerror = function(err) {
        console.error("EventSource failed:", err);
        if (err.target.readyState === EventSource.CLOSED) {
            liveStatusElement.textContent = 'Connection Closed';
            console.log('Connection was closed.');
        } else {
             liveStatusElement.textContent = "Connection error";
        }
        liveStatusElement.style.color = 'red';
        // Optionally, you could attempt to reconnect here after a delay
        // eventSource.close(); // Close the connection if you don't want auto-reconnect attempts
    };
}

// --- TODO: Add Historical Data Logic ---
// (Keep the placeholder comment from the previous version for fetching Google Sheets data)
/*
const GOOGLE_APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_WEB_APP_URL'; // Replace!

fetch(GOOGLE_APPS_SCRIPT_URL)
  .then(response => response.json())
  .then(data => {
      console.log("Received historical data:", data);
      // Process data and render chart using a library
      // e.g., using Chart.js:
      // const ctx = historicalContainer.getContext('2d'); // If using a canvas for Chart.js
      // new Chart(ctx, { type: 'line', data: ..., options: ... });
      historicalContainer.textContent = "Historical data loaded (chart rendering logic needed)."; // Placeholder success
  })
  .catch(error => {
      console.error('Error fetching historical data:', error);
      historicalContainer.textContent = "Error loading historical data.";
  });
*/

// Get references to the elements we'll update
const liveStatusElement = document.getElementById('live-status');
const liveTempElement = document.getElementById('live-temp');
const liveHumidityElement = document.getElementById('live-humidity');
const lastUpdatedElement = document.getElementById('last-updated');
const historicalContainer = document.getElementById('historical-chart-container');

console.log("Dashboard script loaded. Placeholders obtained.");
liveStatusElement.textContent = "Script loaded, awaiting data...";

// --- TODO: Add Live Data Logic ---
// This is where you'll use JavaScript's EventSource API
// to connect to your Particle device's Server-Sent Events (SSE) stream.
// Example structure (replace with your actual details):
/*
const PARTICLE_DEVICE_ID = 'YOUR_DEVICE_ID'; // Replace!
const PARTICLE_ACCESS_TOKEN = 'YOUR_ACCESS_TOKEN'; // Replace! Handle securely!
const PARTICLE_EVENT_NAME = 'sensorData'; // The event name you used in Particle.publish()

const sseUrl = `https://api.particle.io/v1/devices/${PARTICLE_DEVICE_ID}/events/${PARTICLE_EVENT_NAME}?access_token=${PARTICLE_ACCESS_TOKEN}`;

console.log("Attempting to connect to Particle Stream...");
liveStatusElement.textContent = "Connecting to Particle...";

const eventSource = new EventSource(sseUrl);

eventSource.onopen = function() {
    console.log("Connected to Particle Event Stream!");
    liveStatusElement.textContent = "Connected";
};

eventSource.addEventListener(PARTICLE_EVENT_NAME, function(event) {
    console.log("Event received:", event);
    try {
        const data = JSON.parse(event.data); // Particle sends event payload in 'data' field
        const parsedData = JSON.parse(data.data); // The actual JSON string is nested here

        console.log("Parsed data:", parsedData);

        // Update the HTML elements (adjust keys based on your JSON)
        if (parsedData.temp !== undefined) {
             liveTempElement.textContent = parsedData.temp.toFixed(2);
        }
        if (parsedData.hum !== undefined) {
            liveHumidityElement.textContent = parsedData.hum.toFixed(2);
        }
        lastUpdatedElement.textContent = new Date(data.published_at).toLocaleTimeString();
        liveStatusElement.textContent = "Receiving data"; // Update status

    } catch (error) {
        console.error("Error parsing event data:", error, event.data);
        liveStatusElement.textContent = "Data parsing error";
    }
}, false);

eventSource.onerror = function(err) {
    console.error("EventSource failed:", err);
    liveStatusElement.textContent = "Connection error";
    eventSource.close(); // Optional: close on error
};
*/

// --- TODO: Add Historical Data Logic ---
// This is where you'll fetch data from your Google Sheet.
// Common methods:
// 1. Google Apps Script: Create a script attached to your sheet, deploy it as a web app
//    that returns data (usually as JSON). Fetch data from that web app URL using JavaScript's `Workspace`.
// 2. Google Sheets API: Use the official API client library (more complex setup).
//
// After fetching data, you would use a charting library (like Chart.js, Plotly.js)
// to render the data in the 'historical-chart-container' div.
// Example using fetch with a hypothetical Apps Script URL:
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
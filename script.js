// --- Configuration ---
// Configuration constants (like TEMP_MONITOR_DEVICE_ID, TEMP_MONITOR_ACCESS_TOKEN,
// SUMP_MONITOR_DEVICE_ID, SUMP_MONITOR_ACCESS_TOKEN, TEMP_MONITOR_EVENT_NAME,
// SUMP_MONITOR_EVENT_NAME, MAX_HISTORY_POINTS) are now defined in config.js
// and expected to be available globally when this script runs.
// Make sure config.js is loaded BEFORE script.js in your index.html!

// --- Get HTML Element References ---
// Temp Monitor Elements
const tempMonitorStatusElement = document.getElementById('temp-monitor-status');
const liveFridgeElement = document.getElementById('live-fridge');
const liveFreezerElement = document.getElementById('live-freezer');
const liveGarageElement = document.getElementById('live-garage');
const tempMonitorLastUpdatedElement = document.getElementById('temp-monitor-last-updated');
// New Temp Monitor Heater Elements
const liveHeaterValueElement = document.getElementById('live-heater-value');
const liveHeaterStatusElement = document.getElementById('live-heater-status');

// Sump Monitor Elements
const sumpMonitorStatusElement = document.getElementById('sump-monitor-status');
const sumpTempElement = document.getElementById('sump-temp');
const sumpPowerElement = document.getElementById('sump-power');
const sumpRuntimeElement = document.getElementById('sump-runtime');
const sumpSinceRunElement = document.getElementById('sump-since-run');
const sumpMonitorLastUpdatedElement = document.getElementById('sump-monitor-last-updated');

// --- Data Storage ---
let timeHistory = [];
let fridgeHistory = [];
let freezerHistory = [];
let garageHistory = [];
// Note: No history/charting for heater values added yet, just display.

let sumpTimeHistory = [];
let sumpTempHistory = [];
let sumpPowerHistory = [];
let sumpRuntimeHistory = [];
let sumpSinceRunHistory = [];

// --- Chart Initialization ---
let fridgeChartInstance, freezerChartInstance, garageChartInstance;
let sumpTempChartInstance, sumpPowerChartInstance, sumpRuntimeChartInstance, sumpSinceRunChartInstance;

function createChart(canvasId, label, borderColor, yLabel = 'Temperature (°F)') {
    const canvasElement = document.getElementById(canvasId);
    if (!canvasElement) {
        console.error(`DEBUG: Canvas element with ID '${canvasId}' not found!`);
        return null;
    }
    const ctx = canvasElement.getContext('2d');
     if (!ctx) {
        console.error(`DEBUG: Failed to get 2D context for canvas ID '${canvasId}'!`);
        return null;
    }
    console.log(`DEBUG: Creating chart for canvas ID '${canvasId}'`);
return new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: label,
            data: [],
            borderColor: borderColor,
            borderWidth: 2,
            fill: false,
            tension: 0.1
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: {
                type: 'time',
                time: {
                    tooltipFormat: 'h:mm a',
                    displayFormats: {
                        minute: 'h:mm a',
                        hour: 'h a',
                        day: 'MMM d'
                    }
                },
                title: {
                    display: true,
                    text: 'Time'
                }
            },
            y: {
                beginAtZero: false,
                title: {
                    display: true,
                    text: yLabel
                }
            }
        },
        plugins: {
            legend: {
                display: true
            }
        }
    }
});

}

// Initialize charts once the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
     console.log("DEBUG: DOM loaded, initializing charts.");
     if (typeof TEMP_MONITOR_DEVICE_ID === 'undefined') {
         console.error("DEBUG: Configuration variables from config.js seem to be missing!");
         tempMonitorStatusElement.textContent = "Config Error!";
         tempMonitorStatusElement.style.color = 'red';
         sumpMonitorStatusElement.textContent = "Config Error!";
         sumpMonitorStatusElement.style.color = 'red';
         return;
     }

     fridgeChartInstance = createChart('fridgeChart', 'Fridge Temp (°F)', 'rgb(255, 99, 132)');
     freezerChartInstance = createChart('freezerChart', 'Freezer Temp (°F)', 'rgb(54, 162, 235)');
     garageChartInstance = createChart('garageChart', 'Garage Temp (°F)', 'rgb(75, 192, 192)');
     sumpTempChartInstance = createChart('sumpTempChart', 'Sump Temperature (°F)', 'rgb(255, 206, 86)');
     sumpPowerChartInstance = createChart('sumpPowerChart', 'External Power (V)', 'rgb(153, 102, 255)', 'Voltage (V)');
     sumpRuntimeChartInstance = createChart('sumpRuntimeChart', 'Sump Runtime (sec)', 'rgb(255, 159, 64)', 'Runtime (seconds)');
     sumpSinceRunChartInstance = createChart('sumpSinceRunChart', 'Time Since Last Run (min)', 'rgb(201, 203, 207)', 'Minutes');

     console.log("DEBUG: Charts initialization attempted.");

     connectTempMonitorSSE();
     connectSumpMonitorSSE();
});


// --- Function to Connect to Temp Monitor SSE ---
function connectTempMonitorSSE() {
    console.log("DEBUG: Initializing Temp Monitor connection.");
    if (!TEMP_MONITOR_DEVICE_ID || TEMP_MONITOR_DEVICE_ID === "YOUR_FRIDGE_FREEZER_DEVICE_ID_HERE" || !TEMP_MONITOR_ACCESS_TOKEN || TEMP_MONITOR_ACCESS_TOKEN === "YOUR_FRIDGE_FREEZER_ACCESS_TOKEN_HERE") {
         console.error("DEBUG: Temp Monitor Device ID or Access Token not set (checked in connect function).");
         tempMonitorStatusElement.textContent = "Config Error!";
         tempMonitorStatusElement.style.color = 'red';
        return;
    }

    const sseUrl = `https://api.particle.io/v1/devices/${TEMP_MONITOR_DEVICE_ID}/events/${TEMP_MONITOR_EVENT_NAME}?access_token=${TEMP_MONITOR_ACCESS_TOKEN}`;
    console.log(`DEBUG: Attempting Temp Monitor SSE connection (Token Hidden)`);
    tempMonitorStatusElement.textContent = "Connecting...";
    tempMonitorStatusElement.style.color = '#555';

    const eventSource = new EventSource(sseUrl);

    eventSource.onopen = function() {
        console.log("DEBUG: Temp Monitor SSE Connected!");
        tempMonitorStatusElement.textContent = "Connected";
        tempMonitorStatusElement.style.color = 'green';
    };

    eventSource.addEventListener(TEMP_MONITOR_EVENT_NAME, function(event) {
        try {
            const particleEventData = JSON.parse(event.data);
            const jsonData = JSON.parse(particleEventData.data); // This should be your new JSON
            const timestamp = new Date(particleEventData.published_at);

            console.log("DEBUG: Temp Monitor data received:", jsonData);

            // --- Update Live Text Display (using confirmed keys) ---
            if (jsonData.fridge !== undefined) {
                liveFridgeElement.textContent = jsonData.fridge.toFixed(1);
            } else { liveFridgeElement.textContent = "--"; }

            if (jsonData.freezer !== undefined) {
                liveFreezerElement.textContent = jsonData.freezer.toFixed(1);
            } else { liveFreezerElement.textContent = "--"; }

            if (jsonData.garage !== undefined) {
                liveGarageElement.textContent = jsonData.garage.toFixed(1);
            } else { liveGarageElement.textContent = "--"; }
            
            // --- Update Heater Display Elements (using confirmed keys) ---
            if (jsonData.heater !== undefined && liveHeaterValueElement) {
                liveHeaterValueElement.textContent = jsonData.heater.toFixed(2);
            } else if (liveHeaterValueElement) { liveHeaterValueElement.textContent = "--"; }

            if (jsonData.heateron !== undefined && liveHeaterStatusElement) {
                liveHeaterStatusElement.textContent = (jsonData.heateron === 1 || jsonData.heateron === "1") ? "On" : "Off";
            } else if (liveHeaterStatusElement) { liveHeaterStatusElement.textContent = "--"; }
            // --- End Heater Display ---

            tempMonitorLastUpdatedElement.textContent = timestamp.toLocaleTimeString();
            tempMonitorStatusElement.textContent = "Receiving data";
            tempMonitorStatusElement.style.color = 'green';

            // --- Update Data History & Charts (using confirmed keys) ---
            timeHistory.push(timestamp);
            fridgeHistory.push(jsonData.fridge !== undefined ? jsonData.fridge : null);
            freezerHistory.push(jsonData.freezer !== undefined ? jsonData.freezer : null);
            garageHistory.push(jsonData.garage !== undefined ? jsonData.garage : null);

            if (timeHistory.length > MAX_HISTORY_POINTS) {
                timeHistory.shift(); fridgeHistory.shift(); freezerHistory.shift(); garageHistory.shift();
            }

            if (fridgeChartInstance) { fridgeChartInstance.data.labels = timeHistory; fridgeChartInstance.data.datasets[0].data = fridgeHistory; fridgeChartInstance.update(); }
            if (freezerChartInstance) { freezerChartInstance.data.labels = timeHistory; freezerChartInstance.data.datasets[0].data = freezerHistory; freezerChartInstance.update(); }
            if (garageChartInstance) { garageChartInstance.data.labels = timeHistory; garageChartInstance.data.datasets[0].data = garageHistory; garageChartInstance.update(); }

        } catch (error) {
            console.error("DEBUG: Error processing Temp Monitor event data:", error, "Raw data:", event.data);
            tempMonitorStatusElement.textContent = "Data Error";
            tempMonitorStatusElement.style.color = 'orange';
        }
    }, false);

    eventSource.onerror = function(err) {
        console.error("DEBUG: Temp Monitor EventSource failed:", err);
        tempMonitorStatusElement.textContent = (err.target && err.target.readyState === EventSource.CLOSED) ? 'Conn. Closed' : "Conn. Error";
        tempMonitorStatusElement.style.color = 'red';
    };
}

// --- Placeholder for Historical Data (Google Sheets) Logic ---
/*
const GOOGLE_APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_WEB_APP_URL'; // From config.js
function fetchHistoricalData() { ... }
*/

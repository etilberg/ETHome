// --- Configuration ---
// !! IMPORTANT: Replace these placeholders with your actual Device ID and Access Token !!
// !! SECURITY WARNING: Remember the risk of embedding tokens in public client-side code !!
const PARTICLE_DEVICE_ID = "240039000e47353136383631"; // <--- REPLACE THIS
const PARTICLE_ACCESS_TOKEN = "28f3c69720f69b2ffbdcdd0534b67f49e4f1030e"; // <--- REPLACE THIS
const PARTICLE_EVENT_NAME = "currentTemps"; // The event name published by your device

const MAX_HISTORY_POINTS = 30; // Number of data points to store and display in graphs

// --- Get HTML Element References ---
const liveStatusElement = document.getElementById('live-status');
const liveFridgeElement = document.getElementById('live-fridge');
const liveFreezerElement = document.getElementById('live-freezer');
const liveGarageElement = document.getElementById('live-garage');
const lastUpdatedElement = document.getElementById('last-updated');

// --- Data Storage ---
let timeHistory = [];
let fridgeHistory = [];
let freezerHistory = [];
let garageHistory = [];

// --- Chart Initialization ---
let fridgeChartInstance, freezerChartInstance, garageChartInstance;

function createChart(canvasId, label, borderColor) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: [], // Initialize with empty labels (timestamps)
            datasets: [{
                label: label,
                data: [], // Initialize with empty data
                borderColor: borderColor,
                borderWidth: 2,
                fill: false,
                tension: 0.1 // Makes the line slightly curved
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time', // Use time adapter
                    time: {
                        unit: 'second', // Adjust time unit as needed (minute, hour)
                        tooltipFormat: 'h:mm:ss a', // Format for tooltips
                         displayFormats: {
                           second: 'h:mm:ss a' // Format for axis labels
                         }
                    },
                    title: {
                        display: true,
                        text: 'Time'
                    }
                },
                y: {
                    beginAtZero: false, // Auto-scale based on data
                    title: {
                        display: true,
                        text: 'Temperature (°F)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true // Show legend (dataset label)
                }
            }
        }
    });
}

// Initialize charts once the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
     console.log("DOM loaded, initializing charts.");
     fridgeChartInstance = createChart('fridgeChart', 'Fridge Temp (°F)', 'rgb(255, 99, 132)');
     freezerChartInstance = createChart('freezerChart', 'Freezer Temp (°F)', 'rgb(54, 162, 235)');
     garageChartInstance = createChart('garageChart', 'Garage Temp (°F)', 'rgb(75, 192, 192)');
     console.log("Charts initialized.");
     liveStatusElement.textContent = "Charts ready, preparing connection...";
});


// --- Live Data Logic (SSE Connection) ---
console.log("Dashboard script loaded.");

if (!PARTICLE_DEVICE_ID || PARTICLE_DEVICE_ID === "YOUR_DEVICE_ID_HERE" || !PARTICLE_ACCESS_TOKEN || PARTICLE_ACCESS_TOKEN === "YOUR_PARTICLE_ACCESS_TOKEN_HERE") {
    liveStatusElement.textContent = "Error: Device ID or Access Token not set in script.js!";
    liveStatusElement.style.color = 'red';
    console.error("Please set your PARTICLE_DEVICE_ID and PARTICLE_ACCESS_TOKEN in script.js");
} else {
    const sseUrl = `https://api.particle.io/v1/devices/${PARTICLE_DEVICE_ID}/events/${PARTICLE_EVENT_NAME}?access_token=${PARTICLE_ACCESS_TOKEN}`;

    console.log(`Attempting to connect to Particle Stream at: ${sseUrl.replace(PARTICLE_ACCESS_TOKEN, 'ACCESS_TOKEN_HIDDEN')}`);
    // Status set during chart initialization now

    const eventSource = new EventSource(sseUrl);

    eventSource.onopen = function() {
        console.log("Connected to Particle Event Stream!");
        liveStatusElement.textContent = "Connected";
        liveStatusElement.style.color = 'green';
    };

    eventSource.addEventListener(PARTICLE_EVENT_NAME, function(event) {
        try {
            const particleEventData = JSON.parse(event.data);
            const jsonData = JSON.parse(particleEventData.data);
            const timestamp = new Date(particleEventData.published_at); // Use the timestamp from the event

            console.log("Parsed temperature data:", jsonData, "at", timestamp);

            // --- Update Live Text Display ---
            if (jsonData.fridge !== undefined) liveFridgeElement.textContent = jsonData.fridge.toFixed(1);
            if (jsonData.freezer !== undefined) liveFreezerElement.textContent = jsonData.freezer.toFixed(1);
            if (jsonData.garage !== undefined) liveGarageElement.textContent = jsonData.garage.toFixed(1);
            lastUpdatedElement.textContent = timestamp.toLocaleTimeString();
            liveStatusElement.textContent = "Receiving data";
            liveStatusElement.style.color = 'green';

            // --- Update Data History Arrays ---
            timeHistory.push(timestamp);
            fridgeHistory.push(jsonData.fridge);
            freezerHistory.push(jsonData.freezer);
            garageHistory.push(jsonData.garage);

            // --- Limit History Size ---
            if (timeHistory.length > MAX_HISTORY_POINTS) {
                timeHistory.shift(); // Remove oldest timestamp
                fridgeHistory.shift(); // Remove oldest fridge temp
                freezerHistory.shift(); // Remove oldest freezer temp
                garageHistory.shift(); // Remove oldest garage temp
            }

            // --- Update Charts ---
            if (fridgeChartInstance) { // Check if chart is initialized
                 fridgeChartInstance.data.labels = timeHistory;
                 fridgeChartInstance.data.datasets[0].data = fridgeHistory;
                 fridgeChartInstance.update();
            }
             if (freezerChartInstance) {
                 freezerChartInstance.data.labels = timeHistory;
                 freezerChartInstance.data.datasets[0].data = freezerHistory;
                 freezerChartInstance.update();
            }
             if (garageChartInstance) {
                 garageChartInstance.data.labels = timeHistory;
                 garageChartInstance.data.datasets[0].data = garageHistory;
                 garageChartInstance.update();
            }

        } catch (error) {
            console.error("Error processing event data:", error, "Raw data:", event.data);
            liveStatusElement.textContent = "Data processing error";
            liveStatusElement.style.color = 'orange';
        }
    }, false);

    eventSource.onerror = function(err) {
        console.error("EventSource failed:", err);
        if (err.target && err.target.readyState === EventSource.CLOSED) {
            liveStatusElement.textContent = 'Connection Closed';
            console.log('Connection was closed.');
        } else {
             liveStatusElement.textContent = "Connection error";
        }
        liveStatusElement.style.color = 'red';
    };
}

// --- Placeholder for Historical Data (Google Sheets) Logic ---
// (Keep the placeholder comment for fetching long-term Google Sheets data)
/*
const GOOGLE_APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_WEB_APP_URL'; // Replace!
fetch(GOOGLE_APPS_SCRIPT_URL) ...
*/

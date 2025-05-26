// --- Configuration ---
// Loaded from config.js

// --- Get HTML Element References ---
// Temp Monitor Elements
const tempMonitorStatusElement = document.getElementById('temp-monitor-status');
const liveFridgeElement = document.getElementById('live-fridge');
const liveFreezerElement = document.getElementById('live-freezer');
const liveGarageElement = document.getElementById('live-garage');
const tempMonitorLastUpdatedElement = document.getElementById('temp-monitor-last-updated');
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

let sumpTimeHistory = [];
let sumpTempHistory = [];
let sumpPowerHistory = [];
let sumpRuntimeHistory = [];
let sumpSinceRunHistory = [];

// --- Chart Instance Variables ---
let fridgeChartInstance, freezerChartInstance, garageChartInstance;
let sumpTempChartInstance, sumpPowerChartInstance, sumpRuntimeChartInstance, sumpSinceRunChartInstance;

// *******************************************************************
// *** MOVE createChart FUNCTION DEFINITION HERE (BEFORE DOMContentLoaded) ***
// *******************************************************************
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
                        tooltipFormat: 'h:mm a', // Simplified tooltip
                        displayFormats: {
                            millisecond: 'h:mm:ss.SSS a',
                            second: 'h:mm:ss a',
                            minute: 'h:mm a',
                            hour: 'h a',
                            day: 'MMM d',
                            week: 'll',
                            month: 'MMM yyyy',
                            quarter: 'qqq - yyyy',
                            year: 'yyyy'
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
                },
                zoom: { // Ensure zoom options are here if you are using the zoom plugin
                    pan: {
                        enabled: true,
                        mode: 'x'
                    },
                    zoom: {
                        wheel: {
                            enabled: true,
                        },
                        pinch: {
                            enabled: true
                        },
                        mode: 'x',
                    }
                }
            }
        }
    });
}

// --- Initialize Charts and Load Initial Data ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DEBUG: DOM loaded, initializing charts.");
    if (typeof TEMP_MONITOR_DEVICE_ID === 'undefined' || typeof GOOGLE_APPS_SCRIPT_URL === 'undefined') {
        console.error("DEBUG: Configuration variables from config.js seem to be missing!");
        tempMonitorStatusElement.textContent = "Config Error!";
        tempMonitorStatusElement.style.color = 'red';
        sumpMonitorStatusElement.textContent = "Config Error!";
        sumpMonitorStatusElement.style.color = 'red';
        return;
    }

    // Initialize all charts
    fridgeChartInstance = createChart('fridgeChart', 'Fridge Temp (°F)', 'rgb(255, 99, 132)');
    freezerChartInstance = createChart('freezerChart', 'Freezer Temp (°F)', 'rgb(54, 162, 235)');
    garageChartInstance = createChart('garageChart', 'Garage Temp (°F)', 'rgb(75, 192, 192)');
    sumpTempChartInstance = createChart('sumpTempChart', 'Sump Temperature (°F)', 'rgb(255, 206, 86)');
    sumpPowerChartInstance = createChart('sumpPowerChart', 'External Power (V)', 'rgb(153, 102, 255)', 'Voltage (V)');
    sumpRuntimeChartInstance = createChart('sumpRuntimeChart', 'Sump Runtime (sec)', 'rgb(255, 159, 64)', 'Runtime (seconds)');
    sumpSinceRunChartInstance = createChart('sumpSinceRunChart', 'Time Since Last Run (min)', 'rgb(201, 203, 207)', 'Minutes');
    console.log("DEBUG: Charts initialization attempted.");

    // Start SSE connections
    connectTempMonitorSSE();
    connectSumpMonitorSSE();

    // Load initial historical data based on default dropdown selection
    const initialHours = parseInt(document.getElementById('history-range').value, 10);
    fetchTempMonitorHistoricalData(initialHours);
    fetchSumpHistoricalData(initialHours);
});

// ... (rest of your script.js: history-range listener, resetZoomOnAllCharts, fetch functions, SSE connection functions) ...

// --- Event Listener for History Range Dropdown ---
document.getElementById('history-range').addEventListener('change', function() {
    const selectedHours = parseInt(this.value, 10);
    fetchTempMonitorHistoricalData(selectedHours); // Renamed function
    fetchSumpHistoricalData(selectedHours);      // New function
});

// --- Event Listener for Reset Zoom Button ---
document.getElementById('reset-zoom').addEventListener('click', resetZoomOnAllCharts);

function resetZoomOnAllCharts() {
    console.log("DEBUG: Resetting zoom on all charts");
    if (fridgeChartInstance) fridgeChartInstance.resetZoom();
    if (freezerChartInstance) freezerChartInstance.resetZoom();
    if (garageChartInstance) garageChartInstance.resetZoom();
    if (sumpTempChartInstance) sumpTempChartInstance.resetZoom();
    // sumpPowerChartInstance does not load historical data per request, so skip
    if (sumpRuntimeChartInstance) sumpRuntimeChartInstance.resetZoom();
    if (sumpSinceRunChartInstance) sumpSinceRunChartInstance.resetZoom();
}


// --- Fetch Historical Data for Temp Monitor ---
function fetchTempMonitorHistoricalData(rangeHours) {
    console.log(`DEBUG: Fetching Temp Monitor historical data for last ${rangeHours} hours.`);
    const historicalStatusDiv = document.getElementById('historical-chart-container-gsheets'); // Use a more general status div or create specific ones

    if (!TEMP_MONITOR_HISTORY_CSV_URL || TEMP_MONITOR_HISTORY_CSV_URL.includes("YOUR_") ) {
        console.error("DEBUG: TEMP_MONITOR_HISTORY_CSV_URL is not defined or is a placeholder in config.js!");
        historicalStatusDiv.textContent = "Error: Temp Monitor History URL not configured.";
        return;
    }
    historicalStatusDiv.textContent = `Loading Temp Monitor history (${rangeHours}h)...`;

    fetch(TEMP_MONITOR_HISTORY_CSV_URL)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status} for Temp Monitor History`);
            return response.text();
        })
        .then(csvText => {
            const lines = csvText.trim().split('\\n');
            if (lines.length <= 1) { // Only header or empty
                historicalStatusDiv.textContent = `No historical Temp Monitor data found.`;
                return;
            }
            const header = lines.shift().split(','); // Assuming first line is header

            // Find column indices - more robust than fixed indices
            const tsIdx = header.findIndex(h => h.trim().toLowerCase().includes('timestamp')); // Or your exact timestamp column name
            const fridgeIdx = header.findIndex(h => h.trim().toLowerCase().includes('fridge')); // Or your exact fridge column name
            const freezerIdx = header.findIndex(h => h.trim().toLowerCase().includes('freezer'));
            const garageIdx = header.findIndex(h => h.trim().toLowerCase().includes('garage'));

            if (tsIdx === -1 || fridgeIdx === -1 || freezerIdx === -1 || garageIdx === -1) {
                console.error("DEBUG: Could not find required columns in Temp Monitor CSV header:", header);
                historicalStatusDiv.textContent = "Error: Temp Monitor CSV header mismatch.";
                return;
            }

            const now = new Date();
            const startTime = new Date(now.getTime() - rangeHours * 60 * 60 * 1000);

            let newTimeHistory = [];
            let newFridgeHistory = [];
            let newFreezerHistory = [];
            let newGarageHistory = [];

            lines.forEach(line => {
                const values = line.split(',');
                if (values.length > Math.max(tsIdx, fridgeIdx, freezerIdx, garageIdx)) {
                    const timestamp = new Date(values[tsIdx].trim());
                    if (timestamp >= startTime && timestamp <= now) {
                        newTimeHistory.push(timestamp);
                        newFridgeHistory.push(parseFloat(values[fridgeIdx]));
                        newFreezerHistory.push(parseFloat(values[freezerIdx]));
                        newGarageHistory.push(parseFloat(values[garageIdx]));
                    }
                }
            });
            
            // Update live history arrays (which are used by live updates)
            // This will replace current live history with fetched historical
            timeHistory = newTimeHistory;
            fridgeHistory = newFridgeHistory;
            freezerHistory = newFreezerHistory;
            garageHistory = newGarageHistory;

            if (fridgeChartInstance) {
                fridgeChartInstance.data.labels = timeHistory;
                fridgeChartInstance.data.datasets[0].data = fridgeHistory;
                // No need to set min/max here as Chart.js will auto-scale initially for historical data
                fridgeChartInstance.update();
            }
            // ... (update freezerChartInstance and garageChartInstance similarly) ...
            if (freezerChartInstance) { freezerChartInstance.data.labels = timeHistory; freezerChartInstance.data.datasets[0].data = freezerHistory; freezerChartInstance.update(); }
            if (garageChartInstance) { garageChartInstance.data.labels = timeHistory; garageChartInstance.data.datasets[0].data = garageHistory; garageChartInstance.update(); }


            historicalStatusDiv.textContent = `Loaded Temp Monitor history for last ${rangeHours} hours.`;
            if (newTimeHistory.length === 0) {
                historicalStatusDiv.textContent += " (No data in range)";
            }
        })
        .catch(error => {
            console.error("DEBUG: Failed to load Temp Monitor CSV data:", error);
            historicalStatusDiv.textContent = "Failed to load Temp Monitor historical data.";
        });
}

// --- Fetch Historical Data for Sump Pump ---
function fetchSumpHistoricalData(rangeHours) {
    console.log(`DEBUG: Fetching Sump Pump historical data for last ${rangeHours} hours.`);
    const historicalStatusDiv = document.getElementById('historical-chart-container-gsheets'); // Or a dedicated status div for sump

    if (!SUMP_HISTORY_CSV_URL || SUMP_HISTORY_CSV_URL.includes("YOUR_") ) {
        console.error("DEBUG: SUMP_HISTORY_CSV_URL is not defined or is a placeholder in config.js!");
        historicalStatusDiv.textContent += " Error: Sump History URL not configured."; // Append error
        return;
    }
    historicalStatusDiv.textContent += ` Loading Sump history (${rangeHours}h)...`; // Append status

    fetch(SUMP_HISTORY_CSV_URL)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status} for Sump History`);
            return response.text();
        })
        .then(csvText => {
            const lines = csvText.trim().split('\\n');
            if (lines.length <= 1) {
                historicalStatusDiv.textContent += " No historical Sump data found.";
                return;
            }
            const header = lines.shift().split(',');

            // Based on your SumpPump - SumpRunData.csv
            // Find column indices - more robust than fixed indices
            const tsIdx = header.findIndex(h => h.trim().toLowerCase().includes('timestamp')); // Column A
            const runtimeIdx = header.findIndex(h => h.trim().toLowerCase().includes('sump run time (sec)')); // Column C
            const sinceRunIdx = header.findIndex(h => h.trim().toLowerCase().includes('time since last run (min)')); // Column D
            const tempIdx = header.findIndex(h => h.trim().toLowerCase().includes('temperature (f)')); // Column F

            if (tsIdx === -1 || runtimeIdx === -1 || sinceRunIdx === -1 || tempIdx === -1) {
                console.error("DEBUG: Could not find required columns in Sump Pump CSV header:", header);
                historicalStatusDiv.textContent += " Error: Sump CSV header mismatch.";
                return;
            }

            const now = new Date();
            const startTime = new Date(now.getTime() - rangeHours * 60 * 60 * 1000);

            let newSumpTimeHistory = [];
            let newSumpTempHistory = [];
            let newSumpRuntimeHistory = [];
            let newSumpSinceRunHistory = [];

            lines.forEach(line => {
                const values = line.split(',');
                if (values.length > Math.max(tsIdx, runtimeIdx, sinceRunIdx, tempIdx)) {
                    const timestamp = new Date(values[tsIdx].trim());
                    if (timestamp >= startTime && timestamp <= now) {
                        newSumpTimeHistory.push(timestamp);
                        newSumpTempHistory.push(parseFloat(values[tempIdx]));
                        newSumpRuntimeHistory.push(parseFloat(values[runtimeIdx]));
                        newSumpSinceRunHistory.push(parseFloat(values[sinceRunIdx]));
                    }
                }
            });

            // Update live history arrays for Sump charts
            sumpTimeHistory = newSumpTimeHistory;
            sumpTempHistory = newSumpTempHistory;
            sumpRuntimeHistory = newSumpRuntimeHistory;
            sumpSinceRunHistory = newSumpSinceRunHistory;

            if (sumpTempChartInstance) { sumpTempChartInstance.data.labels = sumpTimeHistory; sumpTempChartInstance.data.datasets[0].data = sumpTempHistory; sumpTempChartInstance.update(); }
            if (sumpRuntimeChartInstance) { sumpRuntimeChartInstance.data.labels = sumpTimeHistory; sumpRuntimeChartInstance.data.datasets[0].data = sumpRuntimeHistory; sumpRuntimeChartInstance.update(); }
            if (sumpSinceRunChartInstance) { sumpSinceRunChartInstance.data.labels = sumpTimeHistory; sumpSinceRunChartInstance.data.datasets[0].data = sumpSinceRunHistory; sumpSinceRunChartInstance.update(); }
            // sumpPowerChartInstance is not updated with historical data per request.

            historicalStatusDiv.textContent += ` Loaded Sump history for last ${rangeHours} hours.`;
            if (newSumpTimeHistory.length === 0) {
                historicalStatusDiv.textContent += " (No Sump data in range)";
            }

        })
        .catch(error => {
            console.error("DEBUG: Failed to load Sump Pump CSV data:", error);
            historicalStatusDiv.textContent += " Failed to load Sump historical data.";
        });
}


// ... (Keep connectTempMonitorSSE and connectSumpMonitorSSE functions as they are) ...
// Make sure the live data update logic in connectSumpMonitorSSE appends to the
// correct history arrays (sumpTimeHistory, sumpTempHistory, etc.) if you want live
// data to continue updating the charts after historical load.
// The current connectSumpMonitorSSE in your script (4).js already updates these.

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
let heaterStatusHistory = [];

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
    if (typeof TEMP_MONITOR_DEVICE_ID === 'undefined' || typeof TEMP_MONITOR_HISTORY_CSV_URL === 'undefined') {
        console.error("DEBUG: Configuration variables from config.js seem to be missing!");
        tempMonitorStatusElement.textContent = "Config Error!";
        tempMonitorStatusElement.style.color = 'red';
        sumpMonitorStatusElement.textContent = "Config Error!";
        sumpMonitorStatusElement.style.color = 'red';
        return;
    }

    // Initialize all charts
    fridgeChartInstance = createChart('fridgeChart', 'Fridge Temp (°F)', 'rgb(255, 99, 132)');
        // Add HeaterStatus dataset to fridge chart
        if (fridgeChartInstance) {
            fridgeChartInstance.data.datasets.push({
                label: 'Heater Status',
                data: heaterStatusHistory,
                borderColor: 'rgb(100, 50, 0.3)',
                backgroundColor: 'rgba(125, 75, 0, 0.1)',
                yAxisID: 'y2',
                stepped: true,
                borderWidth: 2,
                fill: 'origin'
            });
        
            fridgeChartInstance.options.scales.y2 = {
                position: 'right',
                title: {
                    display: true,
                    text: 'Heater Status'
                },
                min: 0,
                max: 1,
                ticks: {
                    stepSize: 1
                },
                grid: {
                    drawOnChartArea: false
                }
            };
        
            fridgeChartInstance.update();
        }
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
function fetchTempMonitorHistoricalData(rangeHours = 1) {
    console.log(`DEBUG: Fetching Temp Monitor historical data for last ${rangeHours} hours.`);

    if (!TEMP_MONITOR_HISTORY_CSV_URL || TEMP_MONITOR_HISTORY_CSV_URL.includes("YOUR_")) {
        console.error("DEBUG: TEMP_MONITOR_HISTORY_CSV_URL is not set or still a placeholder.");
        return;
    }

    fetch(TEMP_MONITOR_HISTORY_CSV_URL)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.text();
        })
        .then(csvText => {
            const lines = csvText.trim().split('\n');
            if (lines.length <= 1) {
                console.warn("DEBUG: Temp CSV has no data rows.");
                return;
            }

            const now = new Date();

            // Clear existing history arrays
            timeHistory.length = 0;
            fridgeHistory.length = 0;
            freezerHistory.length = 0;
            garageHistory.length = 0;
            heaterStatusHistory.length = 0;


            let lastHeaterRunTime = null;
            let lastHeaterStatus = null;

            // Parse CSV rows
            lines.slice(1).forEach(line => {
                const cols = line.split(',');
                const ts = new Date(cols[0]);

                if (isNaN(ts.getTime())) return;

                const diffHours = (now - ts) / (1000 * 60 * 60);
                if (diffHours > rangeHours) return;

                timeHistory.push(ts);
                garageHistory.push(parseFloat(cols[1]));   // GarageTemp
                freezerHistory.push(parseFloat(cols[2]));  // FreezerTemp
                fridgeHistory.push(parseFloat(cols[3]));   // FridgeTemp
                lastHeaterRunTime = parseFloat(cols[4]);
                heaterStatusHistory.push(parseInt(cols[5].trim().replace('\r', ''))); // HeaterStatus (0 or 1)lastHeaterStatus = parseInt(cols[5]);
            });

            console.log(`DEBUG: Loaded ${timeHistory.length} points of fridge/freezer/garage history.`);

            if (fridgeChartInstance) {
                fridgeChartInstance.data.labels = timeHistory;
                fridgeChartInstance.data.datasets[0].data = fridgeHistory;        //fridge temperature
                fridgeChartInstance.data.datasets[1].data = heaterStatusHistory;    // Heater On/Off
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



            // Update heater live display with last values in range
            if (lastHeaterRunTime !== null && liveHeaterValueElement) {
                liveHeaterValueElement.textContent = lastHeaterRunTime.toFixed(2);
            }
            if (lastHeaterStatus !== null && liveHeaterStatusElement) {
                liveHeaterStatusElement.textContent = lastHeaterStatus === 1 ? "On" : "Off";
            }
        })
        .catch(err => {
            console.error("DEBUG: Failed to fetch historical temp data:", err);
        });
}

// --- Fetch Historical Data for Sump Pump ---
function fetchSumpHistoricalData(rangeHours) {
    console.log(`DEBUG: Fetching Sump Pump historical data for last ${rangeHours} hours.`);

    if (!SUMP_HISTORY_CSV_URL || SUMP_HISTORY_CSV_URL.includes("YOUR_")) {
        console.error("DEBUG: SUMP_HISTORY_CSV_URL not set or still using placeholder.");
        return;
    }

    fetch(SUMP_HISTORY_CSV_URL)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.text();
        })
        .then(csvText => {
            const lines = csvText.trim().split('\n');
            if (lines.length <= 1) {
                console.warn("DEBUG: Sump CSV has no data rows.");
                return;
            }

            const header = lines.shift().split(',');
           // console.log("DEBUG: Sump CSV Header:", header);

            // Flexible column detection
            const tsIdx       = header.findIndex(h => h.toLowerCase().includes('timestamp'));
            const runtimeIdx  = header.findIndex(h => h.toLowerCase().includes('sumpruntime'));
            const sinceRunIdx = header.findIndex(h => h.toLowerCase().includes('timesince'));
            const tempIdx     = header.findIndex(h => h.toLowerCase().includes('temp'));
            const powerIdx    = -1; // Not present in this CSV

            if ([tsIdx, runtimeIdx, sinceRunIdx, tempIdx].some(i => i === -1)) {
              console.error("DEBUG: Could not find one or more required Sump columns in header:", header);
              return;
            }

            // Clear old data
            sumpTimeHistory.length = 0;
            sumpTempHistory.length = 0;
            sumpPowerHistory.length = 0;
            sumpRuntimeHistory.length = 0;
            sumpSinceRunHistory.length = 0;

            const now = new Date();

            lines.forEach(line => {
                const cols = line.split(',');
                const ts = new Date(cols[tsIdx]);

                if (isNaN(ts.getTime())) return;

                const diffHours = (now - ts) / (1000 * 60 * 60);
                if (diffHours > rangeHours) return;

                sumpTimeHistory.push(ts);
                sumpTempHistory.push(parseFloat(cols[tempIdx]));
                sumpRuntimeHistory.push(parseFloat(cols[runtimeIdx]));
                sumpSinceRunHistory.push(parseFloat(cols[sinceRunIdx]));
            });

            console.log(`DEBUG: Loaded ${sumpTimeHistory.length} sump points.`);

            // Update charts
            if (sumpTempChartInstance) {
                sumpTempChartInstance.data.labels = sumpTimeHistory;
                sumpTempChartInstance.data.datasets[0].data = sumpTempHistory;
                sumpTempChartInstance.update();
            }
            if (sumpPowerChartInstance) {
                sumpPowerChartInstance.data.labels = sumpTimeHistory;
                sumpPowerChartInstance.data.datasets[0].data = sumpPowerHistory;
                sumpPowerChartInstance.update();
            }
            if (sumpRuntimeChartInstance) {
                sumpRuntimeChartInstance.data.labels = sumpTimeHistory;
                sumpRuntimeChartInstance.data.datasets[0].data = sumpRuntimeHistory;
                sumpRuntimeChartInstance.update();
            }
            if (sumpSinceRunChartInstance) {
                sumpSinceRunChartInstance.data.labels = sumpTimeHistory;
                sumpSinceRunChartInstance.data.datasets[0].data = sumpSinceRunHistory;
                sumpSinceRunChartInstance.update();
            }
        })
        .catch(error => {
            console.error("DEBUG: Failed to fetch sump history:", error);
        });
}


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
            const jsonData = JSON.parse(particleEventData.data); // This is your {"garage":..., "freezer":..., etc}
            const timestamp = new Date(particleEventData.published_at);

            console.log("DEBUG: Temp Monitor data received:", jsonData); // Log the received data

            // --- Update Live Text Display ---
            if (jsonData.fridge !== undefined) liveFridgeElement.textContent = jsonData.fridge.toFixed(1);
            if (jsonData.freezer !== undefined) liveFreezerElement.textContent = jsonData.freezer.toFixed(1);
            if (jsonData.garage !== undefined) liveGarageElement.textContent = jsonData.garage.toFixed(1);
            
            // --- Update New Heater Display Elements ---
            if (jsonData.heater !== undefined && liveHeaterValueElement) {
                liveHeaterValueElement.textContent = jsonData.heater.toFixed(2); // Assuming it's a numeric value
            }
            if (jsonData.heateron !== undefined && liveHeaterStatusElement) {
                liveHeaterStatusElement.textContent = (jsonData.heateron === 1 || jsonData.heateron === "1") ? "On" : "Off";
            }
            // --- End New Heater Display ---

            tempMonitorLastUpdatedElement.textContent = timestamp.toLocaleTimeString();
            tempMonitorStatusElement.textContent = "Receiving data";
            tempMonitorStatusElement.style.color = 'green';

            // --- Update Data History & Charts (existing fridge/freezer/garage charts) ---
            timeHistory.push(timestamp);
            fridgeHistory.push(jsonData.fridge);
            freezerHistory.push(jsonData.freezer);
            garageHistory.push(jsonData.garage);

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


// --- Function to Connect to Sump Monitor SSE ---
function connectSumpMonitorSSE() {
     console.log("DEBUG: Initializing Sump Monitor connection.");
     if (!SUMP_MONITOR_DEVICE_ID || SUMP_MONITOR_DEVICE_ID === "YOUR_SUMP_PUMP_DEVICE_ID_HERE" || !SUMP_MONITOR_ACCESS_TOKEN || SUMP_MONITOR_ACCESS_TOKEN === "YOUR_SUMP_PUMP_ACCESS_TOKEN_HERE") {
        console.error("DEBUG: Sump Monitor Device ID or Access Token not set (checked in connect function).");
        sumpMonitorStatusElement.textContent = "Config Error!";
        sumpMonitorStatusElement.style.color = 'red';
        return;
    }

    const sseUrl = `https://api.particle.io/v1/devices/${SUMP_MONITOR_DEVICE_ID}/events/${SUMP_MONITOR_EVENT_NAME}?access_token=${SUMP_MONITOR_ACCESS_TOKEN}`;
    console.log(`DEBUG: Attempting Sump Monitor SSE connection (Token Hidden)`);
    sumpMonitorStatusElement.textContent = "Connecting...";
     sumpMonitorStatusElement.style.color = '#555';

    const eventSource = new EventSource(sseUrl);

    eventSource.onopen = function() {
        console.log("DEBUG: Sump Monitor SSE Connected!");
        sumpMonitorStatusElement.textContent = "Connected";
        sumpMonitorStatusElement.style.color = 'green';
    };

    eventSource.addEventListener(SUMP_MONITOR_EVENT_NAME, function(event) {
        try {
            const particleEventData = JSON.parse(event.data);
            const jsonData = JSON.parse(particleEventData.data);
            const timestamp = new Date(particleEventData.published_at);

            console.log("DEBUG: Parsed sump data:", jsonData);

            // --- Update Live Text Display (Sump) ---
            if (jsonData.temp !== undefined) sumpTempElement.textContent = jsonData.temp.toFixed(1);
            if (jsonData.extPower !== undefined) sumpPowerElement.textContent = jsonData.extPower.toFixed(2);
            if (jsonData.sumpRunTime !== undefined) sumpRuntimeElement.textContent = jsonData.sumpRunTime.toFixed(1);
            if (jsonData.timeSinceRun !== undefined) sumpSinceRunElement.textContent = jsonData.timeSinceRun.toFixed(1);

            sumpMonitorLastUpdatedElement.textContent = timestamp.toLocaleTimeString();
            sumpMonitorStatusElement.textContent = "Receiving data";
            sumpMonitorStatusElement.style.color = 'green';

            // --- Update Data History & Charts for Sump ---
            sumpTimeHistory.push(timestamp);
            sumpTempHistory.push(jsonData.temp);
            sumpPowerHistory.push(jsonData.extPower);
            sumpRuntimeHistory.push(jsonData.sumpRunTime);
            sumpSinceRunHistory.push(jsonData.timeSinceRun);
            
            if (sumpTimeHistory.length > MAX_HISTORY_POINTS) {
                sumpTimeHistory.shift(); sumpTempHistory.shift(); sumpPowerHistory.shift(); sumpRuntimeHistory.shift(); sumpSinceRunHistory.shift();
            }
            
            if (sumpTempChartInstance) { sumpTempChartInstance.data.labels = sumpTimeHistory; sumpTempChartInstance.data.datasets[0].data = sumpTempHistory; sumpTempChartInstance.update(); }
            if (sumpPowerChartInstance) { sumpPowerChartInstance.data.labels = sumpTimeHistory; sumpPowerChartInstance.data.datasets[0].data = sumpPowerHistory; sumpPowerChartInstance.update(); }
            if (sumpRuntimeChartInstance) { sumpRuntimeChartInstance.data.labels = sumpTimeHistory; sumpRuntimeChartInstance.data.datasets[0].data = sumpRuntimeHistory; sumpRuntimeChartInstance.update(); }
            if (sumpSinceRunChartInstance) { sumpSinceRunChartInstance.data.labels = sumpTimeHistory; sumpSinceRunChartInstance.data.datasets[0].data = sumpSinceRunHistory; sumpSinceRunChartInstance.update(); }

        } catch (error) {
            console.error("DEBUG: Error processing Sump Monitor event data:", error, "Raw data:", event.data);
            sumpMonitorStatusElement.textContent = "Data Error";
            sumpMonitorStatusElement.style.color = 'orange';
        }
    }, false);

     eventSource.onerror = function(err) {
        console.error("DEBUG: Sump Monitor EventSource failed:", err);
        sumpMonitorStatusElement.textContent = (err.target && err.target.readyState === EventSource.CLOSED) ? 'Conn. Closed' : "Conn. Error";
        sumpMonitorStatusElement.style.color = 'red';
    };
}


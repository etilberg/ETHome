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
let outdoorTempHistory = [];
let garageOutdoorTemps = []; 
let outdoorTempCache = {}; 

let sumpTimeHistory = [];
let sumpTempHistory = [];
let sumpPowerHistory = [];
let sumpRuntimeHistory = [];
let sumpSinceRunHistory = [];

// --- Chart Instance Variables ---
let fridgeChartInstance, freezerChartInstance, garageChartInstance;
let sumpTempChartInstance, sumpPowerChartInstance, sumpRuntimeChartInstance, sumpSinceRunChartInstance;
let sumpRunsPerDayChartInstance; 

function calculateMinMax(array) {
  if (!array.length) return { min: null, max: null };
  return {
    min: Math.min(...array),
    max: Math.max(...array)
  };
}

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

    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: label,
                data: [],
                borderColor: borderColor,
                borderWidth: 2,
                pointRadius: 0,
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
                    title: {
                        display: false,
                        text: 'Date'
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
                zoom: {
                    pan: {
                        enabled: false,
                        mode: 'x'
                    },
                    zoom: {
                        wheel: {
                            enabled: false
                        },
                        pinch: {
                            enabled: false
                        },
                        mode: 'x'
                    }
                }
            }
        }
    });
}

// --- Function to Fetch and Display Current Weather ---
async function displayCurrentWeather() {
    if (typeof VISUAL_CROSSING_API_KEY === 'undefined' || VISUAL_CROSSING_API_KEY.includes("YOUR_")) {
        console.error("DEBUG: Visual Crossing API Key not set in config.js");
        return;
    }

    const location = 'Watertown,SD';
    const apiUrl = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${location}?unitGroup=us&include=current&key=${VISUAL_CROSSING_API_KEY}&contentType=json`;

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        const current = data.currentConditions;
        const todayForecast = data.days[0];
        const tomorrowForecast = data.days[1];

        const currentTemp = Math.round(current.temp);
        const dailyHigh = Math.round(todayForecast.tempmax);
        const dailyLow = Math.round(todayForecast.tempmin);
        const windSpeed = Math.round(current.windspeed);
        const conditions = current.conditions;
        const synopsis = todayForecast.description;

        // ✅ Update the DOM
        document.getElementById('current-temp').textContent = `${currentTemp}°F`;
        document.getElementById('current-condition').textContent = conditions;
        document.getElementById('high-low').innerHTML = `H: <span class="temp-high">${dailyHigh}°</span> / L: <span class="temp-low">${dailyLow}°</span>`;
        document.getElementById('wind-speed').textContent = `Wind: ${windSpeed} mph`;
        document.getElementById('forecast-synopsis').querySelector('p').textContent = synopsis;

        // ✅ New fields
        document.getElementById("humidity").textContent = `Humidity: ${Math.round(current.humidity)}%`;
        document.getElementById("feels-like").textContent = `Feels like: ${Math.round(current.feelslike)}°`;
        document.getElementById("tomorrow-forecast").textContent = `Tomorrow: H: ${Math.round(tomorrowForecast.tempmax)}° / L: ${Math.round(tomorrowForecast.tempmin)}°`;

    } catch (error) {
        console.error("Could not fetch current weather:", error);
        document.getElementById('weather-location')?.textContent = "Weather data unavailable.";
    }
}

// --- Initialize Charts and Load Initial Data ---
document.addEventListener('DOMContentLoaded', () => {
    displayCurrentWeather();
    //console.log("DEBUG: DOM loaded, initializing charts.");
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
                pointRadius: 0,             // hide data points
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
    // --- THIS IS THE CORRECTED LOGIC ---
    // First, check if the garage chart was created successfully
    if (garageChartInstance) {
        // Then, push the new dataset to THAT specific chart instance
        garageChartInstance.data.datasets.push({
            label: 'Outdoor Temp (°F)',
            data: outdoorTempHistory,
            borderColor: 'rgb(255, 99, 132)', // A different color for the outdoor temp
            borderWidth: 2,
            fill: false,
            //borderDash: [5, 5],         // optional dashed line
            pointRadius: 0,             // hide data points
            tension: 0.4,
            yAxisID: 'y' // Ensure this matches the garage chart's y-axis ID
        });
        // Update the chart to show the newly added data
        garageChartInstance.update();
    }
    sumpTempChartInstance = createChart('sumpTempChart', 'Basement Temperature (°F)', 'rgb(255, 206, 86)');
    sumpPowerChartInstance = createChart('sumpPowerChart', 'External Power (V)', 'rgb(153, 102, 255)', 'Voltage (V)');
    sumpRuntimeChartInstance = createChart('sumpRuntimeChart', 'Sump Runtime (sec)', 'rgb(255, 159, 64)', 'Runtime (seconds)');
    sumpSinceRunChartInstance = createChart('sumpSinceRunChart', 'Time Since Last Cycle (min)', 'rgb(201, 203, 207)', 'Minutes');
    //console.log("DEBUG: Charts initialization attempted.");
    // ======================= INITIALIZE THE RunsPerDay CHART =======================
    sumpRunsPerDayChartInstance = createChart('sumpRunsPerDayChart', 'Total Cycles', 'rgb(129, 201, 149)', 'Number of Runs');
if (sumpRunsPerDayChartInstance) {
    sumpRunsPerDayChartInstance.config.type = 'bar'; // Set chart type to bar

    // --- Customize the tooltip to show the full date ---
    sumpRunsPerDayChartInstance.options.plugins.tooltip = {
        callbacks: {
            title: function(tooltipItems) {
                // The 'label' property of the first tooltip item contains our date string
                return tooltipItems[0].label;
            }
        }
    };

    sumpRunsPerDayChartInstance.update();
}
    // Start SSE connections
    connectTempMonitorSSE();
    connectSumpMonitorSSE();

    // Load initial historical data based on default dropdown selection
    const initialHours = parseInt(document.getElementById('history-range').value, 10);
    fetchTempMonitorHistoricalData(initialHours);
    fetchSumpHistoricalData(initialHours);
    
    // ======================= CALL THE NEW ANALYTICS FETCH =======================
    fetchSumpAnalyticsData();
});

// ... (rest of your script.js: history-range listener, resetZoomOnAllCharts, fetch functions, SSE connection functions) ...

// --- Event Listener for History Range Dropdown ---
document.getElementById('history-range').addEventListener('change', function() {
    const selectedHours = parseInt(this.value, 10);
    fetchTempMonitorHistoricalData(selectedHours); // Renamed function
    fetchSumpHistoricalData(selectedHours);      // New function
});

/*// --- Event Listener for Reset Zoom Button ---
document.getElementById('reset-zoom').addEventListener('click', resetZoomOnAllCharts);

function resetZoomOnAllCharts() {
    //console.log("DEBUG: Resetting zoom on all charts");
    if (fridgeChartInstance) fridgeChartInstance.resetZoom();
    if (freezerChartInstance) freezerChartInstance.resetZoom();
    if (garageChartInstance) garageChartInstance.resetZoom();
    if (sumpTempChartInstance) sumpTempChartInstance.resetZoom();
    // sumpPowerChartInstance does not load historical data per request, so skip
    if (sumpRuntimeChartInstance) sumpRuntimeChartInstance.resetZoom();
    if (sumpSinceRunChartInstance) sumpSinceRunChartInstance.resetZoom();
}
*/
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
                const heaterStatus = parseInt(cols[5].trim().replace('\r', ''));
                heaterStatusHistory.push(heaterStatus);
                lastHeaterStatus = heaterStatus;
            });

            console.log(`DEBUG: Loaded ${timeHistory.length} points of fridge/freezer/garage history.`);

            if (fridgeChartInstance) {
                fridgeChartInstance.data.labels = timeHistory;
                fridgeChartInstance.data.datasets[0].data = fridgeHistory;
                fridgeChartInstance.data.datasets[1].data = heaterStatusHistory;
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
          
          //  ---fill MIN/MAX array---
            const fridgeMinMax = calculateMinMax(fridgeHistory);
            const freezerMinMax = calculateMinMax(freezerHistory);
            const garageMinMax = calculateMinMax(garageHistory);
            
            // --- NEW, FOOLish FORMAT using classic string concatenation ---
            document.getElementById('fridge-stats').innerHTML = `H: <span class="temp-high">${fridgeMinMax.max.toFixed(0)}°</span> / L: <span class="temp-low">${fridgeMinMax.min.toFixed(0)}°</span>`;
            document.getElementById('freezer-stats').innerHTML = `H: <span class="temp-high">${freezerMinMax.max.toFixed(0)}°</span> / L: <span class="temp-low">${freezerMinMax.min.toFixed(0)}°</span>`;
            document.getElementById('garage-stats').innerHTML = `H: <span class="temp-high">${garageMinMax.max?.toFixed(0)}°</span> / L: <span class="temp-low">${garageMinMax.min?.toFixed(0)}°</span>`;
            // --- Sanity Check Log ---
            console.log(`DEBUG: Values to display - Fridge Max: ${fridgeMinMax.max}, Freezer Max: ${freezerMinMax.max}`);
                      
          // Update heater live display with last values in range
            if (lastHeaterRunTime !== null && liveHeaterValueElement) {
                liveHeaterValueElement.textContent = lastHeaterRunTime.toFixed(2);
            }
            if (lastHeaterStatus !== null && liveHeaterStatusElement) {
                liveHeaterStatusElement.textContent = lastHeaterStatus === 1 ? "On" : "Off";
            }
            
            if (timeHistory.length > 0) {
                fetchVisualCrossingOutdoorTemps(timeHistory, rangeHours);
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
    //console.log("DEBUG: Initializing Temp Monitor connection.");
    if (!TEMP_MONITOR_DEVICE_ID || TEMP_MONITOR_DEVICE_ID === "YOUR_FRIDGE_FREEZER_DEVICE_ID_HERE" || !TEMP_MONITOR_ACCESS_TOKEN || TEMP_MONITOR_ACCESS_TOKEN === "YOUR_FRIDGE_FREEZER_ACCESS_TOKEN_HERE") {
         console.error("DEBUG: Temp Monitor Device ID or Access Token not set (checked in connect function).");
         tempMonitorStatusElement.textContent = "Config Error!";
         tempMonitorStatusElement.style.color = 'red';
        return;
    }

    const sseUrl = `https://api.particle.io/v1/devices/${TEMP_MONITOR_DEVICE_ID}/events/${TEMP_MONITOR_EVENT_NAME}?access_token=${TEMP_MONITOR_ACCESS_TOKEN}`;
    //console.log(`DEBUG: Attempting Temp Monitor SSE connection (Token Hidden)`);
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
    // console.log("DEBUG: Initializing Sump Monitor connection.");
     if (!SUMP_MONITOR_DEVICE_ID || SUMP_MONITOR_DEVICE_ID === "YOUR_SUMP_PUMP_DEVICE_ID_HERE" || !SUMP_MONITOR_ACCESS_TOKEN || SUMP_MONITOR_ACCESS_TOKEN === "YOUR_SUMP_PUMP_ACCESS_TOKEN_HERE") {
        console.error("DEBUG: Sump Monitor Device ID or Access Token not set (checked in connect function).");
        sumpMonitorStatusElement.textContent = "Config Error!";
        sumpMonitorStatusElement.style.color = 'red';
        return;
    }

    const sseUrl = `https://api.particle.io/v1/devices/${SUMP_MONITOR_DEVICE_ID}/events/${SUMP_MONITOR_EVENT_NAME}?access_token=${SUMP_MONITOR_ACCESS_TOKEN}`;
    //console.log(`DEBUG: Attempting Sump Monitor SSE connection (Token Hidden)`);
    sumpMonitorStatusElement.textContent = "Connecting...";
     sumpMonitorStatusElement.style.color = '#555';

    const eventSource = new EventSource(sseUrl);

    eventSource.onopen = function() {
        //console.log("DEBUG: Sump Monitor SSE Connected!");
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

async function fetchVisualCrossingOutdoorTemps(timeHistory, rangeHours) {
    console.debug(`DEBUG: Fetching outdoor temps for ${rangeHours} hours`);

    if (!timeHistory || timeHistory.length === 0) {
        console.debug("DEBUG: Outdoor temp fetch skipped — timeHistory is empty.");
        return;
    }

    // Prevent querying if range is too short for hourly data
    if (rangeHours < 3) {
        console.debug("DEBUG: Outdoor temp resolution too coarse for <3h range");
        return;
    }

    // Format: YYYY-MM-DDTHH:mm:ss
    function formatVCDate(date) {
        // Ensure date is a valid Date object before calling methods on it
        const d = new Date(date);
        if (isNaN(d.getTime())) {
            throw new Error("Invalid time value provided to formatVCDate");
        }
        return d.toISOString().split('.')[0];
    }

    try {
        const start = timeHistory[0];
        const end = timeHistory[timeHistory.length - 1];
        const startDateStr = formatVCDate(start);
        const endDateStr = formatVCDate(end);

        const cacheKey = `vc_outdoor_${startDateStr}_${endDateStr}`;
        const cacheMinutes = 15;
        const cached = outdoorTempCache[cacheKey];
        const now = Date.now();

        if (cached && (now - cached.timestamp < cacheMinutes * 60000)) {
            console.debug(`DEBUG: Using cached outdoor temp data.`);
            garageOutdoorTemps = cached.data;
        } else {
          const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/Watertown,SD/${startDateStr}/${endDateStr}?unitGroup=us&timezone=America/Chicago&key=${VISUAL_CROSSING_API_KEY}&include=hours&contentType=json`;
          console.debug("DEBUG: Fetching Visual Crossing weather data:", url);

            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
            const json = await res.json();

            const hours = (json.days || []).flatMap(day => day.hours || []);
            const outdoorTimeTempMap = new Map();

            for (const hour of hours) {
                const ts = new Date(hour.datetimeEpoch * 1000).getTime();
                outdoorTimeTempMap.set(ts, hour.temp);
            }

            const mappedTemps = timeHistory.map(t => {
                const date = new Date(t);
                // Round the timestamp down to the beginning of the hour
                const hourTs = Math.floor(date.getTime() / 3600000) * 3600000;
                return outdoorTimeTempMap.get(hourTs) ?? null;
            });

            garageOutdoorTemps = mappedTemps;
            outdoorTempCache[cacheKey] = { timestamp: now, data: mappedTemps };
        }

        // *** FIX: Use the correct chart instance variable 'garageChartInstance' ***
        if (garageChartInstance) {
            const outdoorDataset = garageChartInstance.data.datasets.find(d => d.label === "Outdoor Temp (°F)");
            if (outdoorDataset) {
                outdoorDataset.data = garageOutdoorTemps;
                // Important: The labels for the garage chart should still be the main 'timeHistory'
                garageChartInstance.data.labels = timeHistory;
                garageChartInstance.update();
                console.debug(`DEBUG: Updated garage chart with ${garageOutdoorTemps.filter(v => v !== null).length} outdoor temp points.`);
            }
        }
    } catch (error) {
        console.error("DEBUG: Failed to fetch or process Visual Crossing data:", error);
    }
}

function applyOutdoorTemps(hourlyTemps) {
  const outdoorTemps = [];
  let currentIndex = 0;

  for (const t of timeHistory) {
    const timestamp = new Date(t);
    while (
      currentIndex < hourlyTemps.length - 1 &&
      hourlyTemps[currentIndex + 1].time <= timestamp
    ) {
      currentIndex++;
    }

    const outdoor = hourlyTemps[currentIndex];
    outdoorTemps.push(outdoor?.temp ?? null);
  }

  // Set the data on garage chart
  if (garageChartInstance) {
    const garageDataset = garageChartInstance.data.datasets.find(ds => ds.label === "Outdoor Temp (°F)");
    if (garageDataset) {
      garageDataset.data = outdoorTemps;
      garageChartInstance.update();
    }
  }

  console.log(`DEBUG: Mapped ${outdoorTemps.filter(v => v !== null).length} outdoor temps to ${timeHistory.length} garage timestamps.`);
}

// ======================= SUMP PUMP ANALYTICS FUNCTIONS =======================

/**
 * Processes raw sump data to calculate runs per day and updates the bar chart.
 * @param {Array} sumpData - An array of objects with { ts, sinceRun } properties.
 */
function processSumpAnalytics(sumpData) {
    if (sumpData.length === 0) {
        console.warn("DEBUG: No sump data to process for analytics.");
        return;
    }

    // Sort data just in case it's not chronological
    sumpData.sort((a, b) => a.ts - b.ts);

    const runsByDay = new Map();
    let totalRuns = 0;

    // Loop through the data to identify "runs"
    for (let i = 1; i < sumpData.length; i++) {
        const previous = sumpData[i - 1];
        const current = sumpData[i];

        // A "run" is detected when the timeSinceRun value suddenly drops.
        if (current.sinceRun < previous.sinceRun) {
            // Get the date string (e.g., "2025-06-15") for the current run
            const day = current.ts.toISOString().split('T')[0];
            const count = (runsByDay.get(day) || 0) + 1;
            runsByDay.set(day, count);
            totalRuns++;
        }
    }

    console.log(`DEBUG: Processed ${totalRuns} total sump runs across ${runsByDay.size} days.`);

    const labels = [...runsByDay.keys()];
    const data = [...runsByDay.values()];

    // Calculate the overall average
    const avgRunsPerDay = runsByDay.size > 0 ? (totalRuns / runsByDay.size).toFixed(1) : 0;

    if (sumpRunsPerDayChartInstance) {
        sumpRunsPerDayChartInstance.data.labels = labels;
        sumpRunsPerDayChartInstance.data.datasets[0].data = data;
        // Update the chart title with the calculated average
        sumpRunsPerDayChartInstance.options.plugins.title = {
            display: true,
            text: `Daily Sump Pump Cycle Count (Last 90 Days) Avg: ${avgRunsPerDay} per day`
        };
        sumpRunsPerDayChartInstance.update();
    }
}

/**
 * Fetches the full sump history CSV for the last 90 days and processes it.
 * This runs independently of the dropdown-controlled history fetches.
 */
function fetchSumpAnalyticsData() {
    console.log("DEBUG: Fetching full sump pump history for analytics.");

    if (!SUMP_HISTORY_CSV_URL || SUMP_HISTORY_CSV_URL.includes("YOUR_")) {
        console.error("DEBUG: SUMP_HISTORY_CSV_URL not set.");
        return;
    }

    fetch(SUMP_HISTORY_CSV_URL)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.text();
        })
        .then(csvText => {
            const lines = csvText.trim().split('\n');
            if (lines.length <= 1) return;

            const header = lines.shift().split(',');
            const tsIdx = header.findIndex(h => h.toLowerCase().includes('timestamp'));
            const sinceRunIdx = header.findIndex(h => h.toLowerCase().includes('timesince'));

            if (tsIdx === -1 || sinceRunIdx === -1) {
                console.error("DEBUG: Analytics requires 'timestamp' and 'timeSinceRun' columns in sump CSV.");
                return;
            }

            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

            const sumpData = lines.map(line => {
                const cols = line.split(',');
                const ts = new Date(cols[tsIdx]);
                // Filter out invalid dates and data older than 90 days
                if (isNaN(ts.getTime()) || ts < ninetyDaysAgo) {
                    return null;
                }
                return {
                    ts: ts,
                    sinceRun: parseFloat(cols[sinceRunIdx])
                };
            }).filter(item => item !== null); // Remove null entries

            processSumpAnalytics(sumpData);
        })
        .catch(error => {
            console.error("DEBUG: Failed to fetch sump history for analytics:", error);
        });
}

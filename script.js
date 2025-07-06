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

let sumpTimeHistory = [];
let sumpTempHistory = [];
let sumpPowerHistory = [];
let sumpRuntimeHistory = [];
let sumpSinceRunHistory = [];

// --- Chart Instance Variables ---
let fridgeChartInstance, freezerChartInstance, garageChartInstance;
let sumpTempChartInstance, sumpPowerChartInstance, sumpRuntimeChartInstance, sumpSinceRunChartInstance;
let sumpRunsPerDayChartInstance; 

// A single, unified cache for all weather station data
let masterWeatherCache = {
    data: new Map(), // Holds all hourly data: ts -> {temp, precip}
    timestamp: 0     // Unix timestamp of the last successful fetch
};
const MASTER_CACHE_DURATION = 1 * 60 * 60 * 1000; // 1 hours in milliseconds

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

        document.getElementById('current-temp').textContent = `${currentTemp}°F`;
        document.getElementById('current-condition').textContent = conditions;
        document.getElementById('high-low').innerHTML = `H: <span class="temp-high">${dailyHigh}°</span> / L: <span class="temp-low">${dailyLow}°</span>`;
        document.getElementById('wind-speed').textContent = `Wind: ${windSpeed} mph`;
        document.getElementById('forecast-synopsis').querySelector('p').textContent = synopsis;

        // New fields
        document.getElementById('humidity').textContent = `Humidity: ${Math.round(current.humidity)}%`;
        document.getElementById('feels-like').textContent = `Feels like: ${Math.round(current.feelslike)}°`;
        document.getElementById('tomorrow-forecast').textContent = `Tomorrow: H: ${Math.round(tomorrowForecast.tempmax)}° / L: ${Math.round(tomorrowForecast.tempmin)}°`;

    } catch (error) {
        console.error("Could not fetch current weather:", error);
        const locationEl = document.getElementById('weather-location');
        if (locationEl) {
            locationEl.textContent = "Weather data unavailable.";
        }
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

    const sumpSinceRunCtx = document.getElementById('sumpSinceRunChart').getContext('2d');
    sumpSinceRunChartInstance = new Chart(sumpSinceRunCtx, {
        type: 'line', // The base type is line
        data: {
            labels: [], // Populated later
            datasets: [{
                label: 'Time Since Last Cycle (min)',
                data: [],
                borderColor: 'rgb(201, 203, 207)',
                yAxisID: 'y_minutes', // Assign to the left axis
                tension: 0.1,
                pointRadius: 0,
            }, {
                label: 'Precipitation (in)',
                data: [],
                backgroundColor: 'rgba(54, 162, 235, 0.5)', // Blue for rain
                borderColor: 'rgba(54, 162, 235, 1)',
                yAxisID: 'y_precip', // Assign to the new right axis
                type: 'bar', // Display precipitation as bars
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                },
                y_minutes: { // Configuration for the left Y-axis (Minutes)
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Minutes'
                    }
                },
                y_precip: { // Configuration for the new right Y-axis (Precipitation)
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Precipitation (in)'
                    },
                    grid: {
                        drawOnChartArea: false, // Only draw grid for the left axis
                    },
                    ticks: {
                        beginAtZero: true
                    }
                }
            }
        }
    });
  
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

            // Clear existing history arrays
            timeHistory.length = 0;
            fridgeHistory.length = 0;
            freezerHistory.length = 0;
            garageHistory.length = 0;
            heaterStatusHistory.length = 0;
            
            // --- NEW LOGIC FOR RUNTIME CALCULATION ---
            let totalHeaterRunTimeMs = 0; // Total runtime in milliseconds
            let runStartTime = null;      // Timestamp when a run cycle starts
            const now = new Date();

            // First, filter all relevant data points from the CSV into an array
            // This assumes the CSV is sorted chronologically
            const dataInRange = lines.slice(1).map(line => {
                const cols = line.split(',');
                const ts = new Date(cols[0]);
                if (isNaN(ts.getTime())) return null;

                const diffHours = (now - ts) / (1000 * 60 * 60);
                if (diffHours > rangeHours) return null;

                return {
                    ts: ts,
                    garage: parseFloat(cols[1]),
                    freezer: parseFloat(cols[2]),
                    fridge: parseFloat(cols[3]),
                    heaterStatus: parseInt(cols[5].trim().replace('\r', ''))
                };
            }).filter(p => p !== null); // Remove any null (invalid or out-of-range) entries

            // Now, iterate through the filtered data to calculate runtime and populate charts
            for (const point of dataInRange) {
                const { ts, heaterStatus } = point;

                // If heater turns ON and a run cycle wasn't already started
                if (heaterStatus === 1 && !runStartTime) {
                    runStartTime = ts;
                } 
                // If heater turns OFF and a run cycle WAS in progress
                else if (heaterStatus === 0 && runStartTime) {
                    const duration = ts.getTime() - runStartTime.getTime();
                    totalHeaterRunTimeMs += duration;
                    runStartTime = null; // Reset for the next cycle
                }

                // Push data to chart history arrays
                timeHistory.push(point.ts);
                fridgeHistory.push(point.fridge);
                freezerHistory.push(point.freezer);
                garageHistory.push(point.garage);
                heaterStatusHistory.push(point.heaterStatus);
            }

            // Edge Case: Handle a run cycle that is still active at the end of the time range
            if (runStartTime && timeHistory.length > 0) {
                const lastTimestamp = timeHistory[timeHistory.length - 1];
                const duration = lastTimestamp.getTime() - runStartTime.getTime();
                totalHeaterRunTimeMs += duration;
            }
            // --- END OF NEW LOGIC ---

            console.log(`DEBUG: Loaded ${timeHistory.length} points of fridge/freezer/garage history.`);

            // Update charts with the new data
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

            const fridgeMinMax = calculateMinMax(fridgeHistory);
            const freezerMinMax = calculateMinMax(freezerHistory);
            const garageMinMax = calculateMinMax(garageHistory);

            document.getElementById('fridge-stats').innerHTML = `H: <span class="temp-high">${fridgeMinMax.max.toFixed(0)}°</span> / L: <span class="temp-low">${fridgeMinMax.min.toFixed(0)}°</span>`;
            document.getElementById('freezer-stats').innerHTML = `H: <span class="temp-high">${freezerMinMax.max.toFixed(0)}°</span> / L: <span class="temp-low">${freezerMinMax.min.toFixed(0)}°</span>`;
            document.getElementById('garage-stats').innerHTML = `H: <span class="temp-high">${garageMinMax.max?.toFixed(0)}°</span> / L: <span class="temp-low">${garageMinMax.min?.toFixed(0)}°</span>`;

            // Update heater display with the calculated total run time
            if (liveHeaterValueElement) {
                const totalHeaterRunTimeSeconds = totalHeaterRunTimeMs / 1000;
            
                if (totalHeaterRunTimeSeconds >= 5400) {
                    // 5400 seconds = 90 minutes
                    const hours = Math.floor(totalHeaterRunTimeSeconds / 3600);
                    const minutes = Math.floor((totalHeaterRunTimeSeconds % 3600) / 60);
                    liveHeaterValueElement.textContent = minutes > 0 
                        ? `${hours}h ${minutes}m`
                        : `${hours}h`;
                } else if (totalHeaterRunTimeSeconds > 60) {
                    // Between 1 minute and 90 minutes
                    liveHeaterValueElement.textContent = `${(totalHeaterRunTimeSeconds / 60).toFixed(1)} min`;
                } else {
                    // Under 1 minute
                    liveHeaterValueElement.textContent = `${Math.round(totalHeaterRunTimeSeconds)} s`;
                }
            }

            if (heaterStatusHistory.length > 0 && liveHeaterStatusElement) {
                const lastHeaterStatus = heaterStatusHistory[heaterStatusHistory.length - 1];
                liveHeaterStatusElement.textContent = lastHeaterStatus === 1 ? "On" : "Off";
            }
            
           if (timeHistory.length > 0) {
                  getOrFetchMasterWeatherData().then(weatherData => {
                      const mappedTemps = timeHistory.map(t => {
                          const hourTs = Math.floor(new Date(t).getTime() / 3600000) * 3600000;
                          // Get the temp property from the master data
                          return weatherData.get(hourTs)?.temp ?? null;
                      });
  
                      if (garageChartInstance) {
                          const outdoorDataset = garageChartInstance.data.datasets.find(d => d.label === "Outdoor Temp (°F)");
                          if (outdoorDataset) {
                              outdoorDataset.data = mappedTemps;
                              garageChartInstance.update();
                          }
                      }
                  });
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
            const tsIdx = header.findIndex(h => h.toLowerCase().includes('timestamp'));
            const runtimeIdx = header.findIndex(h => h.toLowerCase().includes('sumpruntime'));
            const sinceRunIdx = header.findIndex(h => h.toLowerCase().includes('timesince'));
            const tempIdx = header.findIndex(h => h.toLowerCase().includes('temp'));

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

            // First, update the charts that DON'T need weather data.
            if (sumpTempChartInstance) {
                sumpTempChartInstance.data.labels = sumpTimeHistory;
                sumpTempChartInstance.data.datasets[0].data = sumpTempHistory;
                sumpTempChartInstance.update();
            }
            if (sumpRuntimeChartInstance) {
                sumpRuntimeChartInstance.data.labels = sumpTimeHistory;
                sumpRuntimeChartInstance.data.datasets[0].data = sumpRuntimeHistory;
                sumpRuntimeChartInstance.update();
            }
            if (sumpPowerChartInstance) {
                sumpPowerChartInstance.data.labels = sumpTimeHistory;
                sumpPowerChartInstance.data.datasets[0].data = sumpPowerHistory;
                sumpPowerChartInstance.update();
            }

            // --- CORRECTED HOURLY AGGREGATION LOGIC ---
            getOrFetchMasterWeatherData().then(weatherData => {
                if (sumpTimeHistory.length === 0) return;

                const hourlyBins = new Map();
                const getHour = (ts) => Math.floor(new Date(ts).getTime() / 3600000) * 3600000;
                
                // 1. Create hourly bins for the ENTIRE time range first
                const startTime = getHour(sumpTimeHistory[0]);
                const endTime = getHour(sumpTimeHistory[sumpTimeHistory.length - 1]);

                for (let currentHour = startTime; currentHour <= endTime; currentHour += 3600000) {
                    // Initialize the bin with precipitation data from the master cache
                    hourlyBins.set(currentHour, {
                        sinceRunValues: [],
                        precip: weatherData.get(currentHour)?.precip ?? 0
                    });
                }
                
                // 2. Now, add the sump data into the appropriate, existing bins
                for (let i = 0; i < sumpTimeHistory.length; i++) {
                    const hourKey = getHour(sumpTimeHistory[i]);
                    if (hourlyBins.has(hourKey)) {
                        hourlyBins.get(hourKey).sinceRunValues.push(sumpSinceRunHistory[i]);
                    }
                }
                
                // 3. Sort the bins and create final chart arrays
                const sortedKeys = Array.from(hourlyBins.keys()).sort((a, b) => a - b);
                
                const hourlyLabels = sortedKeys.map(key => new Date(key));
                const hourlySumpData = sortedKeys.map(key => {
                    const values = hourlyBins.get(key).sinceRunValues;
                    return values.length > 0 ? values[values.length - 1] : null;
                });
                const hourlyPrecipData = sortedKeys.map(key => hourlyBins.get(key).precip);

                // 4. Update the chart with the correctly aggregated data
                if (sumpSinceRunChartInstance) {
                    sumpSinceRunChartInstance.data.labels = hourlyLabels;
                    sumpSinceRunChartInstance.data.datasets[0].data = hourlySumpData;
                    sumpSinceRunChartInstance.data.datasets[1].data = hourlyPrecipData;
                    sumpSinceRunChartInstance.update();
                }
            });
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
           /* if (jsonData.heater !== undefined && liveHeaterValueElement) {
                liveHeaterValueElement.textContent = jsonData.heater.toFixed(2); // Assuming it's a numeric value
            }*/
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
/**
 * The single function responsible for fetching 7 days of weather data from the API.
 * This should only be called by the controller function below.
 */
async function fetchMasterWeatherData() {
    console.log("DEBUG: Fetching 7-day master weather data from Visual Crossing API.");
    const dailyPromises = [];
    
    // Create a list of the last 7 days to fetch
    for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dayString = date.toISOString().split('T')[0];
        
        const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/Watertown,SD/${dayString}/${dayString}?unitGroup=us&timezone=America/Chicago&key=${VISUAL_CROSSING_API_KEY}&include=hours&contentType=json`;
        
        // The promise will now resolve with the raw hours array or throw an error
        const promise = fetch(url)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP error ${res.status} for day ${dayString}`);
                return res.json();
            })
            .then(json => (json.days && json.days[0] && json.days[0].hours) || []); // Return the hours array
            
        dailyPromises.push(promise);
    }

    const weatherDataMap = new Map();
    // Wait for all promises to settle
    const results = await Promise.allSettled(dailyPromises);

    // Now, loop through the results and populate the map
    for (const result of results) {
        if (result.status === 'fulfilled') {
            const hours = result.value; // This is the array of hours for a given day
            for (const hour of hours) {
                const ts = new Date(hour.datetimeEpoch * 1000).getTime();
                // Store both temp and precip in the same object
                weatherDataMap.set(ts, { temp: hour.temp, precip: hour.precip });
            }
        } else {
            // Log if any of the daily fetches failed
            console.error("DEBUG: A daily fetch for the master weather cache failed:", result.reason);
        }
    }

    return weatherDataMap;
}

/**
 * Controller function that decides whether to return cached data or fetch new data.
 * All chart functions should call this to get weather data.
 */
/**
 * Controller function that decides whether to return cached data or fetch new data.
 * It now checks three levels: localStorage, in-memory cache, and then fetches from the API.
 */
async function getOrFetchMasterWeatherData() {
    const now = Date.now();

    // --- NEW: Step 1 - Check for a valid cache in localStorage ---
    try {
        const cachedItem = localStorage.getItem('masterWeatherCache');
        if (cachedItem) {
            const parsedCache = JSON.parse(cachedItem);
            // Check if the localStorage cache is still valid (less than 30 mins old)
            if (now - parsedCache.timestamp < MASTER_CACHE_DURATION) {
                console.log("DEBUG: Using master weather cache from localStorage.");
                // Restore the Map data structure from the stored array
                masterWeatherCache.data = new Map(parsedCache.data);
                masterWeatherCache.timestamp = parsedCache.timestamp;
                return masterWeatherCache.data;
            }
        }
    } catch (error) {
        console.error("DEBUG: Could not read weather cache from localStorage.", error);
    }

    // --- Step 2 - Check the in-memory cache (for the current session) ---
    if (now - masterWeatherCache.timestamp < MASTER_CACHE_DURATION && masterWeatherCache.data.size > 0) {
        console.log("DEBUG: Using master weather cache (in-memory).");
        return masterWeatherCache.data;
    }
    
    // --- Step 3 - Fetch new data if all caches are stale or empty ---
    console.log("DEBUG: Master weather cache is stale or empty. Triggering new fetch.");
    const newWeatherData = await fetchMasterWeatherData();
    
    if (newWeatherData.size > 0) {
        // Update the in-memory cache
        masterWeatherCache.data = newWeatherData;
        masterWeatherCache.timestamp = Date.now();

        // --- NEW: Step 4 - Save the newly fetched data to localStorage ---
        try {
            // Convert the Map to an array to make it compatible with JSON.stringify
            const dataToStore = Array.from(masterWeatherCache.data.entries());
            const cacheToSave = {
                data: dataToStore,
                timestamp: masterWeatherCache.timestamp
            };
            localStorage.setItem('masterWeatherCache', JSON.stringify(cacheToSave));
            console.log("DEBUG: Saved new weather data to localStorage for future sessions.");
        } catch (error) {
            console.error("DEBUG: Could not save weather cache to localStorage.", error);
        }
    } else {
        console.error("DEBUG: Master weather fetch returned no data. Cache not updated.");
    }
    
    return masterWeatherCache.data;
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
 * @param {Array} sumpData - An array of objects with { ts, sinceRun, runTime } properties.
 */
function processSumpAnalytics(sumpData) {
    if (sumpData.length === 0) {
        console.warn("DEBUG: No sump data to process for analytics.");
        return;
    }

    const runsByDay = new Map();
    let totalRuns = 0;

    // --- FIX: New, more reliable counting logic ---
    // Iterate over all data points
    for (const current of sumpData) {
        // A "run" is now detected if the runTime for that event is greater than 0.
        if (current.runTime > 0) {
            // Get the date based on the local timezone
            const ts = current.ts;
            const year = ts.getFullYear();
            const month = (ts.getMonth() + 1).toString().padStart(2, '0');
            const dayOfMonth = ts.getDate().toString().padStart(2, '0');
            const day = `${year}-${month}-${dayOfMonth}`;

            const count = (runsByDay.get(day) || 0) + 1;
            runsByDay.set(day, count);
            totalRuns++;
        }
    }
    // --- END OF FIX ---

    console.log(`DEBUG: Processed ${totalRuns} total sump runs across ${runsByDay.size} days.`);
    
    // Sort the labels chronologically before displaying
    const labels = [...runsByDay.keys()].sort();
    const data = labels.map(day => runsByDay.get(day));

    // Calculate the overall average
    const avgRunsPerDay = runsByDay.size > 0 ? (totalRuns / runsByDay.size).toFixed(1) : 0;

    if (sumpRunsPerDayChartInstance) {
        sumpRunsPerDayChartInstance.data.labels = labels;
        sumpRunsPerDayChartInstance.data.datasets[0].data = data;
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
            // --- FIX: Also find the sumpRunTime column ---
            const runtimeIdx = header.findIndex(h => h.toLowerCase().includes('sumpruntime'));

            if (tsIdx === -1 || sinceRunIdx === -1 || runtimeIdx === -1) {
                console.error("DEBUG: Analytics requires 'timestamp', 'timeSinceRun', and 'sumpRunTime' columns in sump CSV.");
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
                    sinceRun: parseFloat(cols[sinceRunIdx]),
                    // --- FIX: Add runTime to the data object ---
                    runTime: parseFloat(cols[runtimeIdx])
                };
            }).filter(item => item !== null); // Remove null entries

            processSumpAnalytics(sumpData);
        })
        .catch(error => {
            console.error("DEBUG: Failed to fetch sump history for analytics:", error);
        });
}

// ================================
// Fridge Heater Control Logic
// ================================

const FRIDGE_DEVICE_ID = TEMP_MONITOR_DEVICE_ID;
const FRIDGE_ACCESS_TOKEN = TEMP_MONITOR_ACCESS_TOKEN;

const FRIDGE_HEATER_VARIABLE_NAME = "FridgeHeaterEnabled"; // Your variable name
const FRIDGE_HEATER_FUNCTION_NAME = "setFridgeHeater";    // Your function name

// Get Elements ONCE (global scope)
const fridgeButton = document.getElementById("fridge-toggle-button");
const fridgeStatus = document.getElementById("fridge-toggle-status");

window.addEventListener("load", () => {
  // Add click listener after load
  fridgeButton?.addEventListener("click", toggleFridgeHeater);

  // Initialize state
  fetchFridgeHeaterState();
});

async function fetchFridgeHeaterState() {
  try {
    const resp = await fetch(`https://api.particle.io/v1/devices/${FRIDGE_DEVICE_ID}/${FRIDGE_HEATER_VARIABLE_NAME}?access_token=${FRIDGE_ACCESS_TOKEN}`);
    if (!resp.ok) {
      const errorText = await resp.text();
      console.error("Error response:", errorText);
      fridgeButton.textContent = "Error Loading State";
      return;
    }
    const data = await resp.json();
    console.log("Fridge Heater State:", data);
    if (data && "result" in data) {
      const isEnabled = data.result;
      updateFridgeButton(isEnabled);
    } else {
      console.error("Invalid response:", data);
      fridgeButton.textContent = "Error Loading State";
    }
  } catch (error) {
    console.error("Error fetching Fridge Heater state:", error);
    fridgeButton.textContent = "Error Loading State";
  }
}

function updateFridgeButton(isEnabled) {
  fridgeButton.textContent = isEnabled ? "Disable Fridge Heater" : "Enable Fridge Heater";
  fridgeStatus.textContent = `Fridge Heater is ${isEnabled ? "Enabled" : "Disabled"}`;
}

async function toggleFridgeHeater() {
  // --- THIS LINE IS THE FIX ---
  // If the button text includes "Enable", the action is "on". Otherwise, it's "off".
  const action = fridgeButton.textContent.includes("Enable") ? "on" : "off";

  try {
    const resp = await fetch(`https://api.particle.io/v1/devices/${FRIDGE_DEVICE_ID}/${FRIDGE_HEATER_FUNCTION_NAME}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `access_token=${FRIDGE_ACCESS_TOKEN}&args=${action}`
    });
    const data = await resp.json();
    if (data && data.return_value !== undefined) {
      // After a successful command, re-fetch the state to update the button.
      fetchFridgeHeaterState();
    } else {
      console.error("Error or invalid response from function call:", data);
      alert("Error sending command to device.");
    }
  } catch (error) {
    console.error("Error toggling Fridge Heater:", error);
    alert("Error toggling Fridge Heater.");
  }
}
// Init
fetchFridgeHeaterState();

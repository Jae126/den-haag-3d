/**
 * Public Transport Network - Real-time Data Handler
 * 
 * This module handles:
 * - Google Maps TransitLayer and TrafficLayer
 * - Real-time HTM vehicle positions from GTFS-RT/OV API
 * - Vehicle marker updates and cleanup
 */

// ============================================
// CONFIGURATION - REPLACE THESE VALUES
// ============================================

// Google Maps API Key (already loaded in index.html)
// If you need to change it, update the script tag in index.html

// Real-time HTM/OV API endpoint
// Option 1: OV API v0 (recommended for The Hague/HTM)
const HTM_REALTIME_API_URL = 'https://v0.ovapi.nl/gtfs-rt/vehiclePositions';

// Option 2: NDOV Loket GTFS-RT (if available)
// const HTM_REALTIME_API_URL = 'https://gtfs.ovapi.nl/gtfs-rt/vehiclePositions';

// Option 3: HTM-specific endpoint (if available)
// const HTM_REALTIME_API_URL = 'https://api.htm.nl/realtime/vehicles';

// Update interval in milliseconds (10-15 seconds as requested)
const UPDATE_INTERVAL = 12000; // 12 seconds

// ============================================
// Global State
// ============================================

let transportMap = null;
let transitLayer = null;
let trafficLayer = null;
let vehicleMarkers = new Map(); // Store markers by vehicle ID
let updateIntervalId = null;
let isTransportLayerActive = false;

// ============================================
// Google Maps Layers Setup
// ============================================

/**
 * Initialize Google Maps with TransitLayer and TrafficLayer
 * @param {google.maps.Map} map - The Google Maps instance
 */
function setupTransportMapLayers(map) {
    if (!map) {
        console.error('Transport map not initialized');
        return;
    }

    transportMap = map;

    // Add TransitLayer (shows tram/bus/metro lines & stops)
    transitLayer = new google.maps.TransitLayer();
    transitLayer.setMap(map);

    // Add TrafficLayer (shows live road congestion)
    trafficLayer = new google.maps.TrafficLayer();
    trafficLayer.setMap(map);

    console.log('Transport layers (Transit + Traffic) enabled');
}

/**
 * Remove TransitLayer and TrafficLayer
 */
function removeTransportMapLayers() {
    if (transitLayer) {
        transitLayer.setMap(null);
        transitLayer = null;
    }

    if (trafficLayer) {
        trafficLayer.setMap(null);
        trafficLayer = null;
    }

    console.log('Transport layers removed');
}

// ============================================
// Real-time Vehicle Data Fetching
// ============================================

/**
 * Fetch real-time vehicle positions from OV API
 * @returns {Promise<Array>} Array of vehicle position objects
 */
async function fetchRealtimeVehicleData() {
    try {
        // Using OV API v0 - this provides real-time vehicle positions
        const response = await fetch(HTM_REALTIME_API_URL, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
            // Note: OV API may require CORS proxy in production
            // You might need to use: 'https://cors-anywhere.herokuapp.com/' + HTM_REALTIME_API_URL
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        // OV API v0 returns data in a specific format
        // Extract vehicle positions from the response
        const vehicles = [];
        
        // Parse the response structure
        // The API structure may vary, adjust based on actual response
        if (data.entity) {
            // GTFS-RT format
            data.entity.forEach(entity => {
                if (entity.vehicle && entity.vehicle.position) {
                    vehicles.push({
                        id: entity.id || entity.vehicle.vehicle?.id || `vehicle-${Date.now()}-${Math.random()}`,
                        lat: entity.vehicle.position.latitude,
                        lng: entity.vehicle.position.longitude,
                        bearing: entity.vehicle.position.bearing || null,
                        line: entity.vehicle.trip?.routeId || 'Unknown',
                        destination: entity.vehicle.trip?.tripHeadsign || 'Unknown',
                        delay: entity.vehicle.delay || null,
                        timestamp: entity.vehicle.timestamp || Date.now() / 1000
                    });
                }
            });
        } else if (Array.isArray(data)) {
            // Alternative format - array of vehicles
            data.forEach(vehicle => {
                if (vehicle.position) {
                    vehicles.push({
                        id: vehicle.id || `vehicle-${Date.now()}-${Math.random()}`,
                        lat: vehicle.position.lat || vehicle.position.latitude,
                        lng: vehicle.position.lng || vehicle.position.longitude,
                        bearing: vehicle.position.bearing || null,
                        line: vehicle.line || vehicle.routeId || 'Unknown',
                        destination: vehicle.destination || vehicle.headsign || 'Unknown',
                        delay: vehicle.delay || null,
                        timestamp: vehicle.timestamp || Date.now() / 1000
                    });
                }
            });
        }

        return vehicles;
    } catch (error) {
        console.error('Error fetching real-time vehicle data:', error);
        
        // Return mock data for development/testing if API fails
        // Remove this in production once API is working
        console.warn('Using mock data due to API error');
        return getMockVehicleData();
    }
}

/**
 * Generate mock vehicle data for testing
 * @returns {Array} Array of mock vehicle positions
 */
function getMockVehicleData() {
    // Mock data for The Hague area
    const basePositions = [
        { lat: 52.080, lng: 4.323, line: 'Tram 1', destination: 'Scheveningen' },
        { lat: 52.077, lng: 4.311, line: 'Tram 1', destination: 'Delft' },
        { lat: 52.105, lng: 4.278, line: 'Tram 9', destination: 'Vrederust' },
        { lat: 52.070, lng: 4.298, line: 'Tram 9', destination: 'Scheveningen' },
        { lat: 52.051, lng: 4.288, line: 'Bus 22', destination: 'Kijkduin' },
        { lat: 52.065, lng: 4.300, line: 'Bus 22', destination: 'Centraal' },
    ];

    // Add slight random movement for realism
    return basePositions.map((pos, index) => ({
        id: `mock-vehicle-${index}`,
        lat: pos.lat + (Math.random() - 0.5) * 0.002,
        lng: pos.lng + (Math.random() - 0.5) * 0.002,
        bearing: Math.random() * 360,
        line: pos.line,
        destination: pos.destination,
        delay: Math.random() > 0.7 ? Math.floor(Math.random() * 300) : null, // 30% chance of delay
        timestamp: Date.now() / 1000
    }));
}

// ============================================
// Marker Management
// ============================================

/**
 * Create or update vehicle markers on the map
 * @param {Array} vehicles - Array of vehicle position objects
 */
function updateVehicleMarkers(vehicles) {
    if (!transportMap) {
        console.warn('Transport map not available for marker updates');
        return;
    }

    // Track which vehicles are still active
    const activeVehicleIds = new Set();

    vehicles.forEach(vehicle => {
        activeVehicleIds.add(vehicle.id);

        if (vehicleMarkers.has(vehicle.id)) {
            // Update existing marker
            const marker = vehicleMarkers.get(vehicle.id);
            
            // Update position
            marker.setPosition({
                lat: vehicle.lat,
                lng: vehicle.lng
            });

            // Update rotation if bearing is available
            if (vehicle.bearing !== null && marker.icon) {
                marker.setIcon({
                    ...marker.icon,
                    rotation: vehicle.bearing
                });
            }

            // Update info window content if it exists
            if (marker.infoWindow) {
                marker.infoWindow.setContent(createInfoWindowContent(vehicle));
            }
        } else {
            // Create new marker
            const marker = createVehicleMarker(vehicle);
            vehicleMarkers.set(vehicle.id, marker);
        }
    });

    // Remove markers for vehicles that are no longer active
    vehicleMarkers.forEach((marker, vehicleId) => {
        if (!activeVehicleIds.has(vehicleId)) {
            marker.setMap(null);
            if (marker.infoWindow) {
                marker.infoWindow.close();
            }
            vehicleMarkers.delete(vehicleId);
        }
    });

    console.log(`Updated ${vehicles.length} vehicle markers`);
}

/**
 * Create a vehicle marker with custom icon
 * @param {Object} vehicle - Vehicle data object
 * @returns {google.maps.Marker} Google Maps marker
 */
function createVehicleMarker(vehicle) {
    // Create custom icon for vehicle
    const icon = {
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        fillColor: getLineColor(vehicle.line),
        fillOpacity: 1,
        strokeColor: '#FFFFFF',
        strokeWeight: 2,
        scale: 6,
        rotation: vehicle.bearing || 0,
        anchor: new google.maps.Point(0, 0)
    };

    const marker = new google.maps.Marker({
        position: { lat: vehicle.lat, lng: vehicle.lng },
        map: transportMap,
        icon: icon,
        title: `${vehicle.line} → ${vehicle.destination}`,
        zIndex: 1000 // Ensure vehicles appear above transit lines
    });

    // Create info window
    const infoWindow = new google.maps.InfoWindow({
        content: createInfoWindowContent(vehicle)
    });

    marker.infoWindow = infoWindow;

    // Add click listener to show info window
    marker.addListener('click', () => {
        // Close all other info windows
        vehicleMarkers.forEach((m) => {
            if (m.infoWindow && m !== marker) {
                m.infoWindow.close();
            }
        });
        infoWindow.open(transportMap, marker);
    });

    return marker;
}

/**
 * Create info window content for vehicle
 * @param {Object} vehicle - Vehicle data object
 * @returns {string} HTML content for info window
 */
function createInfoWindowContent(vehicle) {
    const delayText = vehicle.delay 
        ? `<p style="margin: 0.25rem 0; color: #EF4444;"><strong>Delay:</strong> ${vehicle.delay} seconds</p>`
        : '<p style="margin: 0.25rem 0; color: #22C55E;"><strong>On time</strong></p>';
    
    const lastUpdated = new Date(vehicle.timestamp * 1000).toLocaleTimeString();

    return `
        <div style="padding: 0.5rem; min-width: 200px;">
            <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: #1E293B;">${vehicle.line}</h3>
            <p style="margin: 0.25rem 0; color: #475569;"><strong>Destination:</strong> ${vehicle.destination}</p>
            ${delayText}
            <p style="margin: 0.25rem 0 0 0; font-size: 0.75rem; color: #94A3B8;">Updated: ${lastUpdated}</p>
        </div>
    `;
}

/**
 * Get color for transport line
 * @param {string} line - Line identifier (e.g., "Tram 1", "Bus 22")
 * @returns {string} Hex color code
 */
function getLineColor(line) {
    // Color mapping for HTM lines
    const lineColors = {
        'Tram 1': '#3B82F6',  // Blue
        'Tram 9': '#10B981',  // Green
        'Tram 16': '#8B5CF6', // Purple
        'Bus 22': '#F59E0B',  // Orange
        'Bus 24': '#EF4444',  // Red
    };

    // Try to match line number
    const lineMatch = line.match(/\d+/);
    if (lineMatch) {
        const lineNum = lineMatch[0];
        if (line.includes('Tram')) {
            return lineColors[`Tram ${lineNum}`] || '#3B82F6';
        } else if (line.includes('Bus')) {
            return lineColors[`Bus ${lineNum}`] || '#F59E0B';
        }
    }

    return '#6B7280'; // Default gray
}

/**
 * Clear all vehicle markers
 */
function clearVehicleMarkers() {
    vehicleMarkers.forEach((marker) => {
        marker.setMap(null);
        if (marker.infoWindow) {
            marker.infoWindow.close();
        }
    });
    vehicleMarkers.clear();
    console.log('All vehicle markers cleared');
}

// ============================================
// Update Loop
// ============================================

/**
 * Start real-time updates
 */
function startRealtimeUpdates() {
    if (updateIntervalId) {
        console.warn('Real-time updates already running');
        return;
    }

    if (!transportMap) {
        console.error('Cannot start updates: transport map not initialized');
        return;
    }

    isTransportLayerActive = true;

    // Initial fetch
    fetchAndUpdateVehicles();

    // Set up interval
    updateIntervalId = setInterval(() => {
        if (isTransportLayerActive) {
            fetchAndUpdateVehicles();
        }
    }, UPDATE_INTERVAL);

    console.log(`Real-time updates started (interval: ${UPDATE_INTERVAL}ms)`);
}

/**
 * Stop real-time updates
 */
function stopRealtimeUpdates() {
    if (updateIntervalId) {
        clearInterval(updateIntervalId);
        updateIntervalId = null;
    }

    isTransportLayerActive = false;
    clearVehicleMarkers();

    console.log('Real-time updates stopped');
}

/**
 * Fetch and update vehicles (called by interval)
 */
async function fetchAndUpdateVehicles() {
    if (!isTransportLayerActive || !transportMap) {
        return;
    }

    try {
        const vehicles = await fetchRealtimeVehicleData();
        updateVehicleMarkers(vehicles);
    } catch (error) {
        console.error('Error in update loop:', error);
    }
}

// ============================================
// Public API
// ============================================

/**
 * Initialize transport map with layers and start real-time updates
 * @param {google.maps.Map} map - The Google Maps instance
 */
function initTransportRealtime(map) {
    setupTransportMapLayers(map);
    startRealtimeUpdates();
}

/**
 * Cleanup transport map layers and stop updates
 */
function cleanupTransportRealtime() {
    stopRealtimeUpdates();
    removeTransportMapLayers();
    transportMap = null;
}

// Export functions for use in index.html
window.TransportRealtime = {
    init: initTransportRealtime,
    cleanup: cleanupTransportRealtime,
    startUpdates: startRealtimeUpdates,
    stopUpdates: stopRealtimeUpdates
};


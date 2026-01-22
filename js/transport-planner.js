/**
 * Public Transport Planner - Route Planning & Nearby Stops
 * 
 * This module handles:
 * - Google Maps DirectionsService for route planning
 * - User geolocation for "Locate Me" and nearby stops
 * - Nearby transport stops detection
 * - Route display on map
 * 
 * IMPORTANT: This module requires Google Maps API with the following libraries:
 * - places (for autocomplete)
 * - directions (for route planning)
 * - geometry (for distance calculations)
 * 
 * FIXED FOR GITHUB PAGES DEPLOYMENT:
 * - Added proper async loading checks with waitForGoogleMaps()
 * - Added retry logic for initialization
 * - Replaced blocking alerts with non-intrusive UI messages
 * - Added comprehensive error handling and debugging logs
 * - Made transportStops and helper functions globally accessible
 * 
 * API KEY CONFIGURATION FOR GITHUB PAGES:
 * If route planning fails on GitHub Pages, check:
 * 1. Google Cloud Console > APIs & Services > Credentials
 * 2. Find your API key and click "Edit"
 * 3. Under "Application restrictions", select "HTTP referrers"
 * 4. Add: https://jae126.github.io/*
 * 5. Under "API restrictions", ensure these APIs are enabled:
 *    - Maps JavaScript API
 *    - Directions API
 *    - Places API
 *    - Geocoding API
 * 6. Save and wait 5-10 minutes for changes to propagate
 */

// ============================================
// Configuration
// ============================================

// Maximum distance (in meters) to consider a stop as "nearby"
const NEARBY_DISTANCE_METERS = 500;

// Maximum number of nearby stops to display
const MAX_NEARBY_STOPS = 10;

// ============================================
// Global State
// ============================================

let transportMap = null;
let directionsService = null;
let directionsRenderer = null;
let userLocation = null;
let nearbyStopsMarkers = [];
let routePolyline = null;
let isInitialized = false;

// ============================================
// Google Maps API Loading Check
// ============================================

/**
 * Check if Google Maps API is fully loaded with required libraries
 * @returns {boolean} True if all required APIs are available
 */
function isGoogleMapsReady() {
    if (typeof google === 'undefined' || !google.maps) {
        console.warn('[TransportPlanner] Google Maps API not loaded yet');
        return false;
    }
    
    if (!google.maps.places) {
        console.warn('[TransportPlanner] Google Maps Places library not loaded');
        return false;
    }
    
    if (!google.maps.DirectionsService) {
        console.warn('[TransportPlanner] Google Maps DirectionsService not available');
        return false;
    }
    
    if (!google.maps.DirectionsRenderer) {
        console.warn('[TransportPlanner] Google Maps DirectionsRenderer not available');
        return false;
    }
    
    return true;
}

/**
 * Wait for Google Maps API to be ready
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} delay - Delay between retries in milliseconds
 * @returns {Promise<boolean>} True if API is ready, false if timeout
 */
function waitForGoogleMaps(maxRetries = 20, delay = 500) {
    return new Promise((resolve) => {
        let attempts = 0;
        
        const checkReady = () => {
            attempts++;
            
            if (isGoogleMapsReady()) {
                console.log('[TransportPlanner] Google Maps API is ready');
                resolve(true);
                return;
            }
            
            if (attempts >= maxRetries) {
                console.error('[TransportPlanner] Google Maps API failed to load after', attempts, 'attempts');
                console.error('[TransportPlanner] Check: 1) API key is valid, 2) Libraries are included, 3) API key restrictions allow this domain');
                resolve(false);
                return;
            }
            
            setTimeout(checkReady, delay);
        };
        
        checkReady();
    });
}

// ============================================
// Initialization
// ============================================

/**
 * Initialize the transport planner with a Google Maps instance
 * @param {google.maps.Map} map - The Google Maps instance
 */
async function initTransportPlanner(map) {
    console.log('[TransportPlanner] Initializing...');
    
    // Wait for Google Maps API to be ready
    const isReady = await waitForGoogleMaps();
    if (!isReady) {
        console.error('[TransportPlanner] Cannot initialize: Google Maps API not ready');
        showRoutePlanningError('Google Maps API is not available. Please check your internet connection and refresh the page.');
        return;
    }
    
    if (!map) {
        console.error('[TransportPlanner] Cannot initialize: map instance is null');
        showRoutePlanningError('Map is not initialized. Please try again.');
        return;
    }
    
    transportMap = map;
    
    try {
        // Initialize DirectionsService
        directionsService = new google.maps.DirectionsService();
        
        // Initialize DirectionsRenderer
        directionsRenderer = new google.maps.DirectionsRenderer({
            map: map,
            suppressMarkers: false, // Show origin and destination markers
            polylineOptions: {
                strokeColor: '#3B82F6',
                strokeWeight: 4,
                strokeOpacity: 0.8
            }
        });
        
        isInitialized = true;
        console.log('[TransportPlanner] Initialized successfully');
        
        // Try to get user location for nearby stops
        getUserLocation();
        
    } catch (error) {
        console.error('[TransportPlanner] Initialization error:', error);
        showRoutePlanningError('Failed to initialize route planning. Please refresh the page.');
        isInitialized = false;
    }
}

// ============================================
// User Location & Nearby Stops
// ============================================

/**
 * Get user's current location using geolocation API
 */
function getUserLocation() {
    if (!navigator.geolocation) {
        console.warn('[TransportPlanner] Geolocation is not supported by this browser');
        updateNearbyStopsUI('Geolocation not supported', []);
        return;
    }
    
    const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000 // Cache for 1 minute
    };
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            userLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            console.log('[TransportPlanner] User location obtained:', userLocation);
            findNearbyStops(userLocation);
        },
        (error) => {
            console.warn('[TransportPlanner] Geolocation error:', error.message);
            let message = 'Location access denied.';
            if (error.code === error.PERMISSION_DENIED) {
                message = 'Location permission denied. Please enable location access to see nearby stops.';
            } else if (error.code === error.POSITION_UNAVAILABLE) {
                message = 'Location unavailable.';
            } else if (error.code === error.TIMEOUT) {
                message = 'Location request timed out.';
            }
            updateNearbyStopsUI(message, []);
        },
        options
    );
}

/**
 * Find nearby transport stops based on user location
 * @param {Object} location - {lat, lng} coordinates
 */
function findNearbyStops(location) {
    // Get transportStops from global scope (defined in index.html)
    const transportStops = window.transportStops;
    
    if (!transportStops || !Array.isArray(transportStops)) {
        console.warn('[TransportPlanner] transportStops array not available');
        updateNearbyStopsUI('Stops data not available', []);
        return;
    }
    
    if (!isGoogleMapsReady()) {
        console.warn('[TransportPlanner] Google Maps not ready for distance calculations');
        return;
    }
    
    const userLatLng = new google.maps.LatLng(location.lat, location.lng);
    const nearby = [];
    
    transportStops.forEach(stop => {
        if (!stop.position || !stop.position.lat || !stop.position.lng) {
            return;
        }
        
        const stopLatLng = new google.maps.LatLng(stop.position.lat, stop.position.lng);
        const distance = google.maps.geometry.spherical.computeDistanceBetween(userLatLng, stopLatLng);
        
        if (distance <= NEARBY_DISTANCE_METERS) {
            nearby.push({
                ...stop,
                distance: Math.round(distance)
            });
        }
    });
    
    // Sort by distance
    nearby.sort((a, b) => a.distance - b.distance);
    
    // Limit to max nearby stops
    const limitedNearby = nearby.slice(0, MAX_NEARBY_STOPS);
    
    console.log(`[TransportPlanner] Found ${limitedNearby.length} nearby stops`);
    updateNearbyStopsUI(null, limitedNearby);
    renderNearbyStopsMarkers(limitedNearby);
}

/**
 * Update the nearby stops UI
 * @param {string|null} errorMessage - Error message to display, or null if no error
 * @param {Array} stops - Array of nearby stops
 */
function updateNearbyStopsUI(errorMessage, stops) {
    const countElement = document.getElementById('nearby-stops-count');
    const listElement = document.getElementById('nearby-stops-list');
    
    if (!countElement || !listElement) {
        return;
    }
    
    if (errorMessage) {
        countElement.textContent = errorMessage;
        listElement.innerHTML = `<p style="color: var(--text-slate-400); text-align: center; padding: 1rem;">${errorMessage}</p>`;
        return;
    }
    
    if (stops.length === 0) {
        countElement.textContent = 'No nearby stops';
        listElement.innerHTML = '<p style="color: var(--text-slate-400); text-align: center; padding: 1rem;">No stops found within 500m</p>';
        return;
    }
    
    countElement.textContent = `${stops.length} nearby`;
    
    const lang = window.currentLanguage || 'en';
    
    // Get helper functions from global scope (defined in index.html)
    const getTransportTypeColor = window.getTransportTypeColor || function(type) {
        // Fallback if function not available
        switch (type) {
            case 'train': return { color: 'rgb(234, 179, 8)', strokeColor: 'rgb(202, 138, 4)' };
            case 'tram': return { color: 'rgb(59, 130, 246)', strokeColor: 'rgb(37, 99, 235)' };
            case 'bus': return { color: 'rgb(139, 92, 246)', strokeColor: 'rgb(124, 58, 237)' };
            default: return { color: 'rgb(139, 92, 246)', strokeColor: 'rgb(124, 58, 237)' };
        }
    };
    
    const getTransportTypeIcon = window.getTransportTypeIcon || function(type) {
        // Fallback if function not available
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 2rem; height: 2rem;"><circle cx="12" cy="12" r="10"/></svg>`;
    };
    
    listElement.innerHTML = stops.map(stop => {
        const colors = getTransportTypeColor(stop.type);
        const borderColor = colors.strokeColor || colors.color;
        const bgColor = colors.color ? colors.color.replace('rgb', 'rgba').replace(')', ', 0.2)') : 'rgba(139, 92, 246, 0.2)';
        
        return `
            <div class="transport-stop-card" onclick="selectTransportStop(${stop.id})" style="padding: 1rem; background: rgba(15, 23, 42, 0.95); border: 2px solid ${borderColor}; border-radius: 0.75rem; cursor: pointer; transition: all 0.2s; margin-bottom: 0.75rem;">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <div style="padding: 0.5rem; background: ${bgColor}; border-radius: 0.5rem;">
                        ${getTransportTypeIcon(stop.type)}
                    </div>
                    <div style="flex: 1;">
                        <h4 style="margin: 0 0 0.25rem 0; color: ${colors.color}; font-size: 1rem; font-weight: 600;">${stop.name[lang] || stop.name.en}</h4>
                        <p style="margin: 0; color: var(--text-slate-400); font-size: 0.875rem;">${stop.distance}m away</p>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Render markers for nearby stops on the map
 * @param {Array} stops - Array of nearby stops
 */
function renderNearbyStopsMarkers(stops) {
    // Clear existing markers
    clearNearbyStopsMarkers();
    
    if (!transportMap || !stops || stops.length === 0) {
        return;
    }
    
    stops.forEach(stop => {
        if (!stop.position) return;
        
        const colors = getTransportTypeColor(stop.type);
        const marker = new google.maps.Marker({
            position: stop.position,
            map: transportMap,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                fillColor: colors.color,
                fillOpacity: 1,
                strokeColor: '#FFFFFF',
                strokeWeight: 2,
                scale: 8
            },
            title: stop.name[window.currentLanguage || 'en'] || stop.name.en,
            zIndex: 1000
        });
        
        nearbyStopsMarkers.push(marker);
    });
}

/**
 * Clear all nearby stops markers
 */
function clearNearbyStopsMarkers() {
    nearbyStopsMarkers.forEach(marker => {
        marker.setMap(null);
    });
    nearbyStopsMarkers = [];
}

// ============================================
// Route Planning
// ============================================

/**
 * Plan a route from user location (or map center) to destination
 * @param {string} destination - Destination address or place name
 */
async function planRoute(destination) {
    console.log('[TransportPlanner] Planning route to:', destination);
    
    // Check if initialized
    if (!isInitialized) {
        console.error('[TransportPlanner] Not initialized. Attempting to initialize...');
        const isReady = await waitForGoogleMaps();
        if (!isReady) {
            showRoutePlanningError('Google Maps API is not available. Please refresh the page.');
            return;
        }
        // If we have a map, try to initialize
        if (transportMap) {
            await initTransportPlanner(transportMap);
        } else {
            showRoutePlanningError('Map is not initialized. Please wait for the map to load.');
            return;
        }
    }
    
    if (!directionsService || !directionsRenderer) {
        console.error('[TransportPlanner] DirectionsService or DirectionsRenderer not available');
        showRoutePlanningError('Route planning service is not available. Please refresh the page.');
        return;
    }
    
    // Determine origin (user location or map center)
    let origin;
    if (userLocation) {
        origin = new google.maps.LatLng(userLocation.lat, userLocation.lng);
        console.log('[TransportPlanner] Using user location as origin');
    } else if (transportMap) {
        const center = transportMap.getCenter();
        if (center) {
            origin = center;
            console.log('[TransportPlanner] Using map center as origin');
        } else {
            // Default to The Hague center
            origin = new google.maps.LatLng(52.0705, 4.3007);
            console.log('[TransportPlanner] Using default location (The Hague center) as origin');
        }
    } else {
        showRoutePlanningError('Unable to determine starting location. Please enable location access.');
        return;
    }
    
    // Create request
    const request = {
        origin: origin,
        destination: destination,
        travelMode: google.maps.TravelMode.TRANSIT, // Use public transit
        transitOptions: {
            modes: [google.maps.TransitMode.TRAM, google.maps.TransitMode.BUS, google.maps.TransitMode.RAIL],
            routingPreference: google.maps.TransitRoutePreference.LESS_WALKING
        }
    };
    
    // Show loading state
    showRoutePlanningLoading(true);
    
    try {
        directionsService.route(request, (result, status) => {
            showRoutePlanningLoading(false);
            
            if (status === google.maps.DirectionsStatus.OK) {
                console.log('[TransportPlanner] Route found successfully');
                directionsRenderer.setDirections(result);
                displayRouteInfo(result);
            } else {
                console.error('[TransportPlanner] Directions request failed:', status);
                handleRouteError(status, destination);
            }
        });
    } catch (error) {
        showRoutePlanningLoading(false);
        console.error('[TransportPlanner] Route planning error:', error);
        showRoutePlanningError('An error occurred while planning the route. Please try again.');
    }
}

/**
 * Handle route planning errors
 * @param {string} status - Google Maps DirectionsStatus
 * @param {string} destination - Destination that was requested
 */
function handleRouteError(status, destination) {
    let errorMessage = 'Unable to plan route.';
    
    switch (status) {
        case google.maps.DirectionsStatus.NOT_FOUND:
            errorMessage = `Destination "${destination}" not found. Please try a different address.`;
            break;
        case google.maps.DirectionsStatus.ZERO_RESULTS:
            errorMessage = 'No route found. The destination may be too far or unreachable by public transport.';
            break;
        case google.maps.DirectionsStatus.REQUEST_DENIED:
            errorMessage = 'Route planning request denied. Please check API key permissions.';
            console.error('[TransportPlanner] API key may be restricted or invalid');
            break;
        case google.maps.DirectionsStatus.OVER_QUERY_LIMIT:
            errorMessage = 'Route planning quota exceeded. Please try again later.';
            break;
        case google.maps.DirectionsStatus.INVALID_REQUEST:
            errorMessage = 'Invalid route request. Please check the destination address.';
            break;
        default:
            errorMessage = `Route planning failed (${status}). Please try again.`;
    }
    
    showRoutePlanningError(errorMessage);
    
    // Clear any existing route
    if (directionsRenderer) {
        directionsRenderer.setDirections({ routes: [] });
    }
}

/**
 * Display route information
 * @param {Object} result - DirectionsResult from Google Maps
 */
function displayRouteInfo(result) {
    const displayElement = document.getElementById('route-plan-display');
    if (!displayElement) {
        return;
    }
    
    if (!result.routes || result.routes.length === 0) {
        return;
    }
    
    const route = result.routes[0];
    const leg = route.legs[0];
    const lang = window.currentLanguage || 'en';
    
    let html = `
        <div style="padding: 1rem; background: rgba(15, 23, 42, 0.95); border: 2px solid rgba(59, 130, 246, 0.5); border-radius: 0.75rem; margin-bottom: 1rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
                <h4 style="margin: 0; color: rgb(96, 165, 250); font-size: 1rem; font-weight: 600;">${lang === 'en' ? 'Route' : 'Route'}</h4>
                <button onclick="clearRoute()" style="padding: 0.25rem 0.75rem; background: transparent; border: 1px solid rgba(59, 130, 246, 0.5); border-radius: 0.375rem; color: rgb(96, 165, 250); cursor: pointer; font-size: 0.75rem;">${lang === 'en' ? 'Clear' : 'Wissen'}</button>
            </div>
            <div style="color: var(--text-slate-300); font-size: 0.875rem;">
                <p style="margin: 0 0 0.5rem 0;"><strong>${lang === 'en' ? 'From:' : 'Van:'}</strong> ${leg.start_address}</p>
                <p style="margin: 0 0 0.5rem 0;"><strong>${lang === 'en' ? 'To:' : 'Naar:'}</strong> ${leg.end_address}</p>
                <p style="margin: 0; color: rgb(96, 165, 250);"><strong>${lang === 'en' ? 'Duration:' : 'Duur:'}</strong> ${leg.duration.text} • <strong>${lang === 'en' ? 'Distance:' : 'Afstand:'}</strong> ${leg.distance.text}</p>
            </div>
        </div>
    `;
    
    displayElement.innerHTML = html;
    displayElement.style.display = 'block';
}

/**
 * Show route planning loading state
 * @param {boolean} isLoading - Whether to show loading state
 */
function showRoutePlanningLoading(isLoading) {
    const displayElement = document.getElementById('route-plan-display');
    if (!displayElement) {
        return;
    }
    
    if (isLoading) {
        displayElement.innerHTML = `
            <div style="padding: 1rem; background: rgba(15, 23, 42, 0.95); border: 2px solid rgba(59, 130, 246, 0.5); border-radius: 0.75rem; margin-bottom: 1rem; text-align: center;">
                <p style="color: var(--text-slate-300); margin: 0;">Planning route...</p>
            </div>
        `;
        displayElement.style.display = 'block';
    }
}

/**
 * Show route planning error message
 * @param {string} message - Error message to display
 */
function showRoutePlanningError(message) {
    const displayElement = document.getElementById('route-plan-display');
    if (!displayElement) {
        // Fallback: show in console and try to show a non-blocking message
        console.error('[TransportPlanner]', message);
        return;
    }
    
    const lang = window.currentLanguage || 'en';
    displayElement.innerHTML = `
        <div style="padding: 1rem; background: rgba(239, 68, 68, 0.1); border: 2px solid rgba(239, 68, 68, 0.5); border-radius: 0.75rem; margin-bottom: 1rem;">
            <p style="color: rgb(248, 113, 113); margin: 0; font-size: 0.875rem;">${message}</p>
        </div>
    `;
    displayElement.style.display = 'block';
}

/**
 * Clear the current route
 */
function clearRoute() {
    if (directionsRenderer) {
        directionsRenderer.setDirections({ routes: [] });
    }
    
    const displayElement = document.getElementById('route-plan-display');
    if (displayElement) {
        displayElement.style.display = 'none';
        displayElement.innerHTML = '';
    }
}

// ============================================
// Cleanup
// ============================================

/**
 * Cleanup transport planner resources
 */
function cleanupTransportPlanner() {
    console.log('[TransportPlanner] Cleaning up...');
    
    clearRoute();
    clearNearbyStopsMarkers();
    
    if (directionsRenderer) {
        directionsRenderer.setMap(null);
        directionsRenderer = null;
    }
    
    directionsService = null;
    transportMap = null;
    userLocation = null;
    isInitialized = false;
}

// ============================================
// Public API
// ============================================

// Export functions for use in index.html
window.TransportPlanner = {
    init: initTransportPlanner,
    cleanup: cleanupTransportPlanner,
    planRoute: planRoute,
    getUserLocation: getUserLocation,
    clearRoute: clearRoute
};

// Make clearRoute available globally for onclick handlers
window.clearRoute = clearRoute;

console.log('[TransportPlanner] Module loaded. Waiting for initialization...');


/**
 * Public Transport Planner - Nearby Stops & Route Search
 *
 * Uses free services only (no API key needed):
 * - Leaflet + OpenStreetMap for the map
 * - Nominatim (OpenStreetMap) to find the destination
 * - Step-by-step transit directions open in Google Maps (free link, no key)
 */

// Show up to this many stops in "Nearby Stops"
const MAX_NEARBY_STOPS = 5;
// Use the visitor's location only when they are within this distance of The Hague
const MAX_DISTANCE_FROM_DEN_HAAG = 15000;
const DEN_HAAG_CENTRAAL = { lat: 52.0805, lng: 4.3245 };

let plannerMap = null;
let userLocation = null;
let nearbyStopsMarkers = [];
let routeLayers = [];

function plannerLang() {
    return window.currentLanguage || 'en';
}

// Distance in metres between two {lat, lng} points
function distanceMeters(a, b) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDistance(m) {
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function initTransportPlanner(map) {
    if (!map || typeof L === 'undefined') return;
    plannerMap = map;
    getUserLocation();
}

// The visitor's location if they are in The Hague, otherwise Den Haag Centraal
function getOrigin() {
    return userLocation && distanceMeters(userLocation, DEN_HAAG_CENTRAAL) <= MAX_DISTANCE_FROM_DEN_HAAG
        ? userLocation
        : DEN_HAAG_CENTRAAL;
}

function getUserLocation() {
    if (!navigator.geolocation) {
        findNearbyStops();
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (position) => {
            userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
            findNearbyStops();
        },
        () => findNearbyStops(),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
}

function findNearbyStops() {
    const stops = window.transportStops;
    if (!Array.isArray(stops)) return;
    const origin = getOrigin();
    const nearby = stops
        .filter(stop => stop.position)
        .map(stop => ({ ...stop, distance: distanceMeters(origin, stop.position) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, MAX_NEARBY_STOPS);
    updateNearbyStopsUI(nearby, origin === DEN_HAAG_CENTRAAL);
}

function updateNearbyStopsUI(stops, fromCentraal) {
    const countElement = document.getElementById('nearby-stops-count');
    const listElement = document.getElementById('nearby-stops-list');
    if (!countElement || !listElement) return;
    const lang = plannerLang();

    countElement.textContent = fromCentraal
        ? (lang === 'en' ? 'Near Den Haag Centraal' : 'Rond Den Haag Centraal')
        : (lang === 'en' ? 'Near you' : 'Bij jou in de buurt');

    const getTransportTypeColor = window.getTransportTypeColor || (() => ({ color: 'rgb(139, 92, 246)' }));
    const getTransportTypeIcon = window.getTransportTypeIcon || (() => '');

    listElement.innerHTML = stops.map(stop => {
        const colors = getTransportTypeColor(stop.type);
        const borderColor = colors.strokeColor || colors.color;
        const bgColor = colors.color.replace('rgb', 'rgba').replace(')', ', 0.2)');
        return `
            <div class="transport-stop-card" onclick="selectTransportStop(${stop.id}); focusMapOn('transport', selectedTransportStop);" style="padding: 1rem; background: rgba(15, 23, 42, 0.95); border: 2px solid ${borderColor}; border-radius: 0.75rem; cursor: pointer; transition: all 0.2s; margin-bottom: 0.75rem;">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <div style="padding: 0.5rem; background: ${bgColor}; border-radius: 0.5rem;">${getTransportTypeIcon(stop.type)}</div>
                    <div style="flex: 1;">
                        <h4 style="margin: 0 0 0.25rem 0; color: ${colors.color}; font-size: 1rem; font-weight: 600;">${stop.name[lang] || stop.name.en}</h4>
                        <p style="margin: 0; color: var(--text-slate-400); font-size: 0.875rem;">${formatDistance(stop.distance)} ${lang === 'en' ? 'away' : 'afstand'}</p>
                    </div>
                </div>
            </div>`;
    }).join('');
}

function clearNearbyStopsMarkers() {
    nearbyStopsMarkers.forEach(m => m.remove());
    nearbyStopsMarkers = [];
}

// Find the destination with OpenStreetMap and show it on the map
async function planRoute(destination) {
    const lang = plannerLang();
    showRoutePlanningLoading(true);
    try {
        const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=nl'
            + '&viewbox=4.18,52.14,4.45,52.00&bounded=0&q=' + encodeURIComponent(destination);
        const response = await fetch(url, { headers: { 'Accept-Language': lang === 'en' ? 'en' : 'nl' } });
        const results = await response.json();
        if (!results.length) {
            showRoutePlanningError(lang === 'en'
                ? `Could not find "${destination}". Try a street name or a well-known place.`
                : `"${destination}" niet gevonden. Probeer een straatnaam of bekende plek.`);
            return;
        }
        const place = results[0];
        const target = { lat: parseFloat(place.lat), lng: parseFloat(place.lon) };
        drawRoute(getOrigin(), target, place.display_name.split(',').slice(0, 2).join(','));
    } catch (error) {
        showRoutePlanningError(lang === 'en'
            ? 'Route search is not available right now. Check your internet connection and try again.'
            : 'Route zoeken is nu niet beschikbaar. Controleer je internetverbinding en probeer opnieuw.');
    }
}

function drawRoute(origin, target, targetName) {
    clearRoute();
    const lang = plannerLang();
    if (plannerMap) {
        const line = L.polyline([origin, target], { color: '#3B82F6', weight: 4, opacity: 0.85, dashArray: '8 8' }).addTo(plannerMap);
        const start = L.circleMarker(origin, { radius: 8, color: '#FFFFFF', weight: 2, fillColor: '#22C55E', fillOpacity: 1 }).addTo(plannerMap);
        const end = L.circleMarker(target, { radius: 9, color: '#FFFFFF', weight: 2, fillColor: '#3B82F6', fillOpacity: 1 }).addTo(plannerMap);
        end.bindTooltip(targetName);
        routeLayers = [line, start, end];
        plannerMap.fitBounds(line.getBounds(), { padding: [40, 40] });
    }

    const nearestStop = (window.transportStops || [])
        .map(stop => ({ ...stop, distance: distanceMeters(target, stop.position) }))
        .sort((a, b) => a.distance - b.distance)[0];
    const directionsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}`
        + `&destination=${target.lat},${target.lng}&travelmode=transit`;
    const fromLabel = origin === DEN_HAAG_CENTRAAL ? 'Den Haag Centraal' : (lang === 'en' ? 'Your location' : 'Jouw locatie');

    const displayElement = document.getElementById('route-plan-display');
    if (!displayElement) return;
    displayElement.innerHTML = `
        <div style="padding: 1rem; background: rgba(15, 23, 42, 0.95); border: 2px solid rgba(59, 130, 246, 0.5); border-radius: 0.75rem; margin-bottom: 1rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
                <h4 style="margin: 0; color: rgb(96, 165, 250); font-size: 1rem; font-weight: 600;">Route</h4>
                <button onclick="clearRoute()" style="padding: 0.25rem 0.75rem; background: transparent; border: 1px solid rgba(59, 130, 246, 0.5); border-radius: 0.375rem; color: rgb(96, 165, 250); cursor: pointer; font-size: 0.75rem;">${lang === 'en' ? 'Clear' : 'Wissen'}</button>
            </div>
            <div style="color: var(--text-slate-300); font-size: 0.875rem;">
                <p style="margin: 0 0 0.5rem 0;"><strong>${lang === 'en' ? 'From:' : 'Van:'}</strong> ${fromLabel}</p>
                <p style="margin: 0 0 0.5rem 0;"><strong>${lang === 'en' ? 'To:' : 'Naar:'}</strong> ${targetName}</p>
                <p style="margin: 0 0 0.5rem 0;"><strong>${lang === 'en' ? 'Distance (straight line):' : 'Afstand (hemelsbreed):'}</strong> ${formatDistance(distanceMeters(origin, target))}</p>
                ${nearestStop ? `<p style="margin: 0 0 0.75rem 0;"><strong>${lang === 'en' ? 'Closest stop to destination:' : 'Dichtstbijzijnde halte:'}</strong> ${nearestStop.name[lang] || nearestStop.name.en} (${formatDistance(nearestStop.distance)})</p>` : ''}
                <a href="${directionsUrl}" target="_blank" rel="noopener noreferrer" style="color: rgb(96, 165, 250);">${lang === 'en' ? 'Open step-by-step transit directions ↗' : 'Open reisadvies met OV ↗'}</a>
            </div>
        </div>`;
    displayElement.style.display = 'block';
}

function showRoutePlanningLoading(isLoading) {
    const displayElement = document.getElementById('route-plan-display');
    if (!displayElement || !isLoading) return;
    displayElement.innerHTML = `
        <div style="padding: 1rem; background: rgba(15, 23, 42, 0.95); border: 2px solid rgba(59, 130, 246, 0.5); border-radius: 0.75rem; margin-bottom: 1rem; text-align: center;">
            <p style="color: var(--text-slate-300); margin: 0;">${plannerLang() === 'en' ? 'Finding destination...' : 'Bestemming zoeken...'}</p>
        </div>`;
    displayElement.style.display = 'block';
}

function showRoutePlanningError(message) {
    const displayElement = document.getElementById('route-plan-display');
    if (!displayElement) return;
    displayElement.innerHTML = `
        <div style="padding: 1rem; background: rgba(239, 68, 68, 0.1); border: 2px solid rgba(239, 68, 68, 0.5); border-radius: 0.75rem; margin-bottom: 1rem;">
            <p style="color: rgb(248, 113, 113); margin: 0; font-size: 0.875rem;">${message}</p>
        </div>`;
    displayElement.style.display = 'block';
}

function clearRoute() {
    routeLayers.forEach(layer => layer.remove());
    routeLayers = [];
    const displayElement = document.getElementById('route-plan-display');
    if (displayElement) {
        displayElement.style.display = 'none';
        displayElement.innerHTML = '';
    }
}

function cleanupTransportPlanner() {
    clearRoute();
    clearNearbyStopsMarkers();
    plannerMap = null;
}

window.TransportPlanner = {
    init: initTransportPlanner,
    cleanup: cleanupTransportPlanner,
    planRoute: planRoute,
    getUserLocation: getUserLocation,
    clearRoute: clearRoute
};
window.clearRoute = clearRoute;

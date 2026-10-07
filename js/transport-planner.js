/**
 * Public Transport Planner - Nearby Stops & Route Search
 *
 * Uses free services only (no API key needed):
 * - Leaflet + OpenStreetMap for the map
 * - Nominatim (OpenStreetMap) to find the destination
 * - Journey advice is worked out here from the stops and lines in the site's own data
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
    plannerMap = map && typeof L !== 'undefined' ? map : null;
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

// Rough travel speeds in metres per minute (for estimates only)
const WALK_SPEED = 80;
const RIDE_SPEED = { train: 800, tram: 300, bus: 300 };
// Streets are not straight lines: stretch straight-line distances a little
const DETOUR_FACTOR = 1.3;
// Closer than this, walking is the best advice
const WALK_ONLY_DISTANCE = 1200;

function nearestStop(point) {
    return (window.transportStops || [])
        .filter(stop => stop.position)
        .map(stop => ({ ...stop, distance: distanceMeters(point, stop.position) }))
        .sort((a, b) => a.distance - b.distance)[0] || null;
}

function sharedLines(a, b) {
    return a.lines.filter(line => b.lines.includes(line));
}

function walkMinutes(m) {
    return Math.max(1, Math.round(m * DETOUR_FACTOR / WALK_SPEED));
}

// Numbered lines are trams (or buses at bus stops); named lines such as Intercity are trains
function lineVehicle(from, to, lines) {
    if (!lines.every(line => /^\d+$/.test(line))) return 'train';
    return from.type === 'bus' || to.type === 'bus' ? 'bus' : 'tram';
}

function rideMinutes(from, to, vehicle) {
    const speed = RIDE_SPEED[vehicle] || RIDE_SPEED.tram;
    return Math.max(2, Math.round(distanceMeters(from.position, to.position) * DETOUR_FACTOR / speed));
}

function rideStep(from, to, lines) {
    const vehicle = lineVehicle(from, to, lines);
    return { kind: 'ride', from, to, lines, vehicle, minutes: rideMinutes(from, to, vehicle) };
}

// Work out a simple journey: walk to a stop, ride (with at most one change), walk to the destination
function buildJourney(origin, target) {
    const total = distanceMeters(origin, target);
    if (total <= WALK_ONLY_DISTANCE) {
        return { walkOnly: true, minutes: walkMinutes(total), distance: total };
    }
    const from = nearestStop(origin);
    const to = nearestStop(target);
    if (!from || !to || from.id === to.id) {
        return { walkOnly: true, minutes: walkMinutes(total), distance: total };
    }
    const steps = [{ kind: 'walk', to: from, meters: from.distance, minutes: walkMinutes(from.distance) }];
    const direct = sharedLines(from, to);
    if (direct.length) {
        steps.push(rideStep(from, to, direct));
    } else {
        const change = (window.transportStops || []).find(stop =>
            stop.id !== from.id && stop.id !== to.id && sharedLines(from, stop).length && sharedLines(stop, to).length);
        if (change) {
            steps.push(rideStep(from, change, sharedLines(from, change)));
            steps.push(rideStep(change, to, sharedLines(change, to)));
        } else {
            steps.push({ kind: 'nolink', from, to });
        }
    }
    const lastWalk = distanceMeters(to.position, target);
    steps.push({ kind: 'walk-end', meters: lastWalk, minutes: walkMinutes(lastWalk) });
    const minutes = steps.reduce((sum, step) => sum + (step.minutes || 0), 0);
    return { walkOnly: false, steps, minutes, distance: total, complete: !steps.some(s => s.kind === 'nolink') };
}

function journeyStepHtml(step, targetName, lang) {
    const en = lang === 'en';
    const row = (icon, title, detail, minutes) => `
        <li style="display: flex; gap: 0.75rem; align-items: flex-start; padding: 0.75rem 0; border-top: 1px solid rgba(51, 65, 85, 0.6);">
            <span style="flex-shrink: 0; width: 2rem; height: 2rem; border-radius: 0.5rem; background: rgba(59, 130, 246, 0.15); color: rgb(147, 197, 253); display: flex; align-items: center; justify-content: center;">${icon}</span>
            <span style="flex: 1;">
                <span style="display: block; color: var(--text-slate-200); font-weight: 600;">${title}</span>
                ${detail ? `<span style="display: block; color: var(--text-slate-400); font-size: 0.875rem; margin-top: 0.125rem;">${detail}</span>` : ''}
            </span>
            ${minutes ? `<span style="flex-shrink: 0; color: var(--text-slate-300); font-size: 0.875rem;">~${minutes} min</span>` : ''}
        </li>`;
    const walkIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 1.1rem; height: 1.1rem;"><circle cx="13" cy="4" r="2"/><path d="m9 20 3-6 3 3v4"/><path d="m6 8 4-2 3 3 3 1"/><path d="M10 12l-2 3"/></svg>';
    const icon = (type) => (window.getTransportTypeIcon ? window.getTransportTypeIcon(type) : '').replace('width: 2rem; height: 2rem;', 'width: 1.1rem; height: 1.1rem;');
    const name = (stop) => stop.name[lang] || stop.name.en;
    const lineWord = (vehicle, lines) => `${vehicle === 'train' ? (en ? 'Train' : 'Trein') : vehicle === 'bus' ? 'Bus' : 'Tram'} ${lines.join(' / ')}`;
    switch (step.kind) {
        case 'walk':
            return row(walkIcon, en ? `Walk to ${name(step.to)}` : `Loop naar ${name(step.to)}`, formatDistance(step.meters), step.minutes);
        case 'ride':
            return row(icon(step.vehicle), en ? `Take ${lineWord(step.vehicle, step.lines)}` : `Neem ${lineWord(step.vehicle, step.lines)}`,
                en ? `${name(step.from)} → ${name(step.to)}` : `${name(step.from)} → ${name(step.to)}`, step.minutes);
        case 'nolink':
            return row(icon(step.from.type), en ? `Travel from ${name(step.from)} to ${name(step.to)}` : `Reis van ${name(step.from)} naar ${name(step.to)}`,
                en ? 'No direct line between these stops in our data. Ask staff for the best connection.' : 'Geen directe lijn tussen deze haltes in onze gegevens. Vraag een medewerker naar de beste verbinding.', 0);
        case 'walk-end':
            return row(walkIcon, en ? `Walk to ${targetName}` : `Loop naar ${targetName}`, formatDistance(step.meters), step.minutes);
        default:
            return '';
    }
}

function drawRoute(origin, target, targetName) {
    clearRoute();
    const lang = plannerLang();
    const en = lang === 'en';
    if (plannerMap) {
        const line = L.polyline([origin, target], { color: '#3B82F6', weight: 4, opacity: 0.85, dashArray: '8 8' }).addTo(plannerMap);
        routeLayers = [line];
        plannerMap.fitBounds(line.getBounds(), { padding: [40, 40] });
    }

    const journey = buildJourney(origin, target);
    const fromLabel = origin === DEN_HAAG_CENTRAAL ? 'Den Haag Centraal' : (en ? 'Your location' : 'Jouw locatie');
    const body = journey.walkOnly
        ? `<p style="margin: 0; color: var(--text-slate-300);">${en ? `It is close by: walk about ${formatDistance(journey.distance)}.` : `Dichtbij: ongeveer ${formatDistance(journey.distance)} lopen.`}</p>`
        : `<ol style="list-style: none; margin: 0; padding: 0;">${journey.steps.map(step => journeyStepHtml(step, targetName, lang)).join('')}</ol>`;

    const displayElement = document.getElementById('route-plan-display');
    if (!displayElement) return;
    displayElement.innerHTML = `
        <div style="padding: 1.25rem; background: rgba(15, 23, 42, 0.95); border: 2px solid rgba(59, 130, 246, 0.6); border-radius: 0.75rem; margin-bottom: 1.5rem;">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 0.75rem;">
                <div>
                    <h4 style="margin: 0; color: rgb(96, 165, 250); font-size: 1.1rem; font-weight: 600;">${fromLabel} → ${targetName}</h4>
                    <p style="margin: 0.25rem 0 0 0; color: var(--text-slate-400); font-size: 0.875rem;">
                        ${journey.complete === false ? '' : `${en ? 'About' : 'Ongeveer'} <strong style="color: var(--text-slate-200);">${journey.minutes} min</strong> · `}${formatDistance(journey.distance)} ${en ? 'as the crow flies' : 'hemelsbreed'}
                    </p>
                </div>
                <button onclick="clearRoute()" style="flex-shrink: 0; min-height: 2.25rem; padding: 0 0.9rem; background: transparent; border: 1px solid rgba(59, 130, 246, 0.5); border-radius: 0.5rem; color: rgb(96, 165, 250); cursor: pointer; font-size: 0.875rem;">${en ? 'Close' : 'Sluiten'}</button>
            </div>
            ${body}
            <p style="margin: 0.75rem 0 0 0; color: var(--text-slate-500); font-size: 0.75rem;">${en ? 'Times are estimates based on distance, not live timetables.' : 'Tijden zijn schattingen op basis van afstand, geen actuele dienstregeling.'}</p>
        </div>`;
    displayElement.style.display = 'block';
    displayElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

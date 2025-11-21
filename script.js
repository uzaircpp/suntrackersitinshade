// Fixed and improved script.js for Sunlight Tracker
// - Uses OSRM routing to get real road geometry
// - Samples route at regular intervals (meters)
// - Uses SunCalc (dynamically loaded if needed) for accurate sun azimuth/altitude
// - Handles timezones by using the browser Date from datetime-local
// - Draws colored segments (sunlit vs shaded) and gives a recommendation

let map;
let routeLayer;

// Ensure SunCalc is available by dynamically loading it if necessary
function ensureSunCalc() {
    return new Promise((resolve, reject) => {
        if (window.SunCalc) return resolve(window.SunCalc);
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/suncalc@1.9.0/suncalc.js';
        script.onload = () => {
            if (window.SunCalc) resolve(window.SunCalc);
            else reject(new Error('SunCalc not available after load'));
        };
        script.onerror = () => reject(new Error('Failed to load SunCalc'));
        document.head.appendChild(script);
    });
}

function initMap() {
    map = L.map('map').setView([47.6062, -122.3321], 10); // Default: Seattle
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    routeLayer = L.layerGroup().addTo(map);
}

window.onload = initMap;

// Main handler called by the button
async function trackSunlight() {
    try {
        const start = document.getElementById("start").value.trim();
        const end = document.getElementById("end").value.trim();
        const timeStr = document.getElementById("time").value;

        if (!start || !end || !timeStr) {
            document.getElementById("result").innerText = "Please fill all fields.";
            return;
        }

        // Geocode start and end
        const startCoords = await geocode(start);
        const endCoords = await geocode(end);
        if (!startCoords || !endCoords) {
            document.getElementById("result").innerText = "Invalid city names or geocoding failed.";
            return;
        }

        // Get real road route from OSRM (returns array of [lat, lng])
        const routeCoords = await fetchRoute(startCoords, endCoords);
        if (!routeCoords || routeCoords.length < 2) {
            document.getElementById("result").innerText = "Could not retrieve route geometry.";
            return;
        }

        // Clear previous drawings
        routeLayer.clearLayers();

        // Draw full route (base polyline)
        L.polyline(routeCoords, { color: '#2a6fdb', weight: 4, opacity: 0.6 }).addTo(routeLayer);
        map.fitBounds(L.polyline(routeCoords).getBounds(), { padding: [40, 40] });

        // Ensure SunCalc is loaded
        await ensureSunCalc();

        // Sample route points (every 100 meters by default)
        const samples = sampleRoutePoints(routeCoords, 100);

        // Analyze each sample: sun position and heading (bearing)
        const date = new Date(timeStr); // datetime-local -> treated as local time by browser
        const sunOnSideCounts = { left: 0, right: 0, none: 0 };
        const segmentLayers = []; // we'll draw colored segments

        // Build segments between consecutive samples and decide sunlit/shaded
        for (let i = 0; i < samples.length - 1; i++) {
            const p1 = samples[i];
            const p2 = samples[i + 1];

            // Heading from p1 -> p2 (degrees)
            const heading = calculateBearing(p1.lat, p1.lng, p2.lat, p2.lng);

            // Use SunCalc to get sun position at the sample point time
            const pos = SunCalc.getPosition(date, p1.lat, p1.lng);
            const azimuthRad = pos.azimuth; // radians, -PI..PI (measured from south)
            const altitudeRad = pos.altitude; // radians

            // Convert SunCalc azimuth (measured from south, east negative) to standard azimuth from north
            // SunCalc.azimuth returns angle from south: 0 = south, -pi/2 = east, +pi/2 = west
            // Convert to degrees from north (0 = north, 90 = east, 180 = south, 270 = west)
            let sunAzDeg = (azimuthRad * 180 / Math.PI);
            // Convert: sunDegFromNorth = (180 + sunAzDeg) mod 360
            sunAzDeg = (180 + sunAzDeg + 360) % 360;

            // Relative angle sun vs heading (0..360)
            const relativeAngle = (sunAzDeg - heading + 360) % 360;

            // Decide which side sun is on for this segment (simple heuristic)
            // We'll consider sun on "right" if relativeAngle between 0 and 180 (front-right to rear-right),
            // and "left" if relativeAngle between 180 and 360 (rear-left to front-left).
            // Note: This matches earlier simple heuristic and is consistent for speaking points.
            let sunSide = null;
            if (altitudeRad <= 0) {
                sunSide = 'none'; // sun below horizon
            } else {
                sunSide = (relativeAngle > 180) ? 'right' : 'left';
            }
            sunOnSideCounts[sunSide] = (sunOnSideCounts[sunSide] || 0) + 1;

            // Mark segment as sunlit if altitude > 0 and sun is roughly to one side (not behind large occlusion)
            const isSunlit = altitudeRad > 0;

            // Color: sunlit -> orange, shaded -> gray
            const color = isSunlit ? '#ffb84d' : '#99a3b2';
            const segment = L.polyline([[p1.lat, p1.lng], [p2.lat, p2.lng]], { color, weight: 6, opacity: 0.9 }).addTo(routeLayer);
            segmentLayers.push(segment);
        }

        // Compute a recommendation: sit on side opposite where the sun mostly is
        // If most samples have sun on left -> recommend sit right, etc.
        const totalRelevant = sunOnSideCounts.left + sunOnSideCounts.right;
        let recommendation = '';
        if (totalRelevant === 0) {
            recommendation = "No sun at this time (sun below horizon) — either side is fine.";
        } else {
            const sunOnLeft = sunOnSideCounts.left || 0;
            const sunOnRight = sunOnSideCounts.right || 0;
            if (sunOnLeft > sunOnRight) recommendation = "Sun is mostly on the left — sit on the right for shade.";
            else if (sunOnRight > sunOnLeft) recommendation = "Sun is mostly on the right — sit on the left for shade.";
            else recommendation = "Sun is roughly balanced across the route — choose either side.";
        }

        document.getElementById("result").innerText = recommendation;
    } catch (err) {
        console.error(err);
        document.getElementById("result").innerText = "Error: " + (err.message || String(err));
    }
}

// Geocode using Nominatim (returns [lat, lon] or null)
// Note: Nominatim public service has rate limits. For production use, use an API key / hosted solution.
async function geocode(location) {
    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        if (data && data.length > 0) {
            return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
        }
        return null;
    } catch (e) {
        console.error('Geocode error', e);
        return null;
    }
}

// Fetch route geometry from OSRM public demo server
// start/end are [lat, lon] pairs. Returns array of {lat, lng}
async function fetchRoute(startCoords, endCoords) {
    try {
        const [lat1, lon1] = startCoords;
        const [lat2, lon2] = endCoords;
        // OSRM expects lon,lat order in URL
        const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('Routing API error');
        const data = await resp.json();
        if (!data.routes || data.routes.length === 0) return null;
        const coords = data.routes[0].geometry.coordinates; // array of [lon, lat]
        // Convert to [{lat, lng}, ...]
        return coords.map(c => ({ lat: c[1], lng: c[0] }));
    } catch (e) {
        console.error('fetchRoute error', e);
        return null;
    }
}

// Sample a route (array of {lat,lng}) every `intervalMeters` meters.
// Returns array of sample points {lat, lng}
function sampleRoutePoints(route, intervalMeters = 100) {
    if (!route || route.length === 0) return [];
    const samples = [];
    // Helper: haversine distance (meters)
    function haversine(a, b) {
        const R = 6371000;
        const lat1 = a.lat * Math.PI / 180;
        const lat2 = b.lat * Math.PI / 180;
        const dLat = (b.lat - a.lat) * Math.PI / 180;
        const dLon = (b.lng - a.lng) * Math.PI / 180;
        const sinDlat = Math.sin(dLat / 2);
        const sinDlon = Math.sin(dLon / 2);
        const aa = sinDlat * sinDlat + Math.cos(lat1) * Math.cos(lat2) * sinDlon * sinDlon;
        const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
        return R * c;
    }
    // Linear interpolate between two lat/lngs by fraction t (0..1)
    function interp(a, b, t) {
        return {
            lat: a.lat + (b.lat - a.lat) * t,
            lng: a.lng + (b.lng - a.lng) * t
        };
    }

    samples.push(route[0]); // always include first point
    let remaining = intervalMeters;
    for (let i = 0; i < route.length - 1; i++) {
        let a = route[i];
        let b = route[i + 1];
        let segLen = haversine(a, b);
        if (segLen === 0) continue;
        let t = 0;
        while (remaining <= segLen) {
            // fraction along this segment where next sample falls
            const frac = (segLen - remaining) / segLen;
            // point at frac from a -> b is at t = 1 - frac
            const point = interp(a, b, 1 - frac);
            samples.push(point);
            // prepare for next point after consuming remaining
            // now treat point as new 'a' for the remainder of the segment
            // effectively move 'a' forward by (segLen - remaining)
            const distToNewA = segLen - remaining;
            // remaining distance along segment after new point
            segLen = remaining; // leftover segment length from new 'a' to original b
            a = point;
            remaining = intervalMeters;
        }
        // reduce remaining by the leftover segment length (if any)
        remaining -= segLen;
        if (remaining < 0) remaining = intervalMeters + remaining; // carryover
    }
    // Always include last point
    const last = route[route.length - 1];
    if (!samples.length || samples[samples.length - 1].lat !== last.lat || samples[samples.length - 1].lng !== last.lng) {
        samples.push(last);
    }
    // Deduplicate if necessary
    return samples;
}

// Calculate initial bearing (degrees) from lat1,lng1 -> lat2,lng2
function calculateBearing(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; // Degrees
}

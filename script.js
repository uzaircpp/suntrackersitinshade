let map;
let routeLayer;

function initMap() {
    map = L.map('map').setView([47.6062, -122.3321], 10); // Default: Seattle
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    routeLayer = L.layerGroup().addTo(map);
}

async function trackSunlight() {
    const start = document.getElementById("start").value;
    const end = document.getElementById("end").value;
    const time = document.getElementById("time").value;

    if (!start || !end || !time) {
        document.getElementById("result").innerText = "Please fill all fields.";
        return;
    }

    const startCoords = await geocode(start);
    const endCoords = await geocode(end);

    if (!startCoords || !endCoords) {
        document.getElementById("result").innerText = "Invalid city names.";
        return;
    }

    const route = [startCoords, endCoords];
    routeLayer.clearLayers();
    L.polyline(route, { color: 'blue' }).addTo(routeLayer);
    map.fitBounds(L.polyline(route).getBounds());

    const midLat = (startCoords[0] + endCoords[0]) / 2;
    const midLng = (startCoords[1] + endCoords[1]) / 2;
    const sunData = await getSunPosition(midLat, midLng, time);
    const sunAzimuth = sunData.azimuth;

    const heading = calculateBearing(startCoords[0], startCoords[1], endCoords[0], endCoords[1]);

    const relativeAngle = (sunAzimuth * 180 / Math.PI - heading + 360) % 360;
    const result = relativeAngle > 180 ? "Sit on the right for shade" : "Sit on the left for shade";
    document.getElementById("result").innerText = result;
}

async function geocode(location) {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`);
    const data = await response.json();
    if (data.length > 0) {
        return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    }
    return null;
}

async function getSunPosition(lat, lng, dateTime) {
    const date = dateTime.split("T")[0];
    const response = await fetch(
        `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&date=${date}&formatted=0`
    );
    const data = await response.json();
    const sunrise = new Date(data.results.sunrise).getTime();
    const sunset = new Date(data.results.sunset).getTime();
    const current = new Date(dateTime).getTime();
    const dayLength = sunset - sunrise;
    const timeProgress = (current - sunrise) / dayLength;
    const azimuth = 90 + timeProgress * 180; 
    return { azimuth: azimuth * Math.PI / 180 }; // Radians
}

function calculateBearing(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; // Degrees
}

window.onload = initMap;
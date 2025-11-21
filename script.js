let map;
let routeLayer;

function initMap() {
  map = L.map('map').setView([47.6062, -122.3321], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(map);
  routeLayer = L.layerGroup().addTo(map);
}

window.onload = initMap;


async function trackSunlight() {
  try {
    const start = document.getElementById("start").value.trim();
    const end = document.getElementById("end").value.trim();
    const timeStr = document.getElementById("time").value;
    if (!start || !end || !timeStr) {
      document.getElementById("result").innerText = "Please fill all fields.";
      return;
    }

    const startCoords = await geocode(start);
    const endCoords = await geocode(end);
    if (!startCoords || !endCoords) {
      document.getElementById("result").innerText = "Invalid city names.";
      return;
    }

    // Draw a simple straight polyline between start and end
    routeLayer.clearLayers();
    const route = [startCoords, endCoords];
    L.polyline(route, { color: 'blue' }).addTo(routeLayer);
    map.fitBounds(L.polyline(route).getBounds());

    // Use the midpoint
    const midLat = (startCoords[0] + endCoords[0]) / 2;
    const midLng = (startCoords[1] + endCoords[1]) / 2;

  
    const date = new Date(timeStr);
    if (isNaN(date.getTime())) {
      document.getElementById("result").innerText = "Invalid date/time.";
      return;
    }


    if (typeof SunCalc === 'undefined') {
      document.getElementById("result").innerText = "SunCalc library missing. Add its script in HTML.";
      return;
    }

  
    const pos = SunCalc.getPosition(date, midLat, midLng);
    const altitude = pos.altitude; // radians
    const azimuthRad = pos.azimuth; 


    let sunDegFromNorth = (180 + (azimuthRad * 180 / Math.PI)) % 360;


    const heading = calculateBearing(startCoords[0], startCoords[1], endCoords[0], endCoords[1]);


    const relativeAngle = (sunDegFromNorth - heading + 360) % 360;

    // If sun below horizon (altitude <= 0) 
    if (altitude <= 0) {
      document.getElementById("result").innerText = "Sun is below horizon at this time — either side is fine.";
      return;
    }

    // Decide side: sun on right if relativeAngle in (0,180), left if (180,360)
    const side = (relativeAngle > 180) ? 'right' : 'left';
    const recommendation = (side === 'right')
      ? "Sun is mostly on the right — sit on the left for shade."
      : "Sun is mostly on the left — sit on the right for shade.";

  
    document.getElementById("result").innerText =
      `${recommendation} (sun azimuth: ${Math.round(sunDegFromNorth)}°, heading: ${Math.round(heading)}°)`;

  } catch (err) {
    console.error(err);
    document.getElementById("result").innerText = "An error occurred. See console for details.";
  }
}


async function geocode(location) {
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.length === 0) return null;
    return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
  } catch (e) {
    console.error('geocode error', e);
    return null;
  }
}

// (degrees)
function calculateBearing(lat1, lng1, lat2, lng2) {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

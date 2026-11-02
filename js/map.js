// map.js
// Everything about the Leaflet map lives here: setting it up,
// drawing the route, placing markers, showing the user's location.
// Other files (like ui.js) import the functions they need from this file.

// Leaflet is loaded in index.html, so the global "L" is already available.

// Campus center, taken from your OpenStreetMap link. Order is [latitude, longitude].
const CAMPUS_CENTER = [18.019461, 83.40109];
const DEFAULT_ZOOM = 17;

// These variables remember things between function calls
let map = null; // the Leaflet map itself
let markersLayer = null; // a group that holds all place markers
let routeLine = null; // the line of the current route
let userMarker = null; // the dot showing the user's GPS position

// ---------- Setup ----------

// Creates the map inside <main id="map"> and adds the OpenStreetMap picture tiles.
export function initMap() {
  map = L.map("map").setView(CAMPUS_CENTER, DEFAULT_ZOOM);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  return map;
}

export function getMap() {
  return map;
}

// ---------- Markers (named places) ----------

// Adds one marker with a popup label, like "Library".
export function addPlaceMarker(name, lat, lng) {
  return L.marker([lat, lng]).bindPopup(name).addTo(markersLayer);
}

export function clearPlaceMarkers() {
  markersLayer.clearLayers();
}

// ---------- Route line ----------

// latlngs is a list of points: [[lat, lng], [lat, lng], ...]
export function drawRoute(latlngs) {
  clearRoute(); // remove the old route first

  routeLine = L.polyline(latlngs, {
    color: "#0b6e4f",
    weight: 6,
    opacity: 0.9,
  }).addTo(map);

  // Zoom the map so the whole route is visible
  map.fitBounds(routeLine.getBounds(), { padding: [40, 40] });
}

export function clearRoute() {
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
}

// ---------- User location (used later by GPS) ----------

export function showUserLocation(lat, lng) {
  if (userMarker) {
    userMarker.setLatLng([lat, lng]);
  } else {
    userMarker = L.circleMarker([lat, lng], {
      radius: 8,
      color: "#ffffff",
      weight: 3,
      fillColor: "#1d4ed8",
      fillOpacity: 1,
    }).addTo(map);
  }
}

// ---------- Helper for you while building ----------

// Click anywhere on the map and a popup shows that spot's coordinates.
// We will use this to collect the lat/lng of Library, Canteen, Gate, etc.
// for places.json. You can remove it at the end.
export function enableClickCoords() {
  map.on("click", (e) => {
    const lat = e.latlng.lat.toFixed(6);
    const lng = e.latlng.lng.toFixed(6);
    L.popup().setLatLng(e.latlng).setContent(`${lat}, ${lng}`).openOn(map);
    console.log(`lat: ${lat}, lng: ${lng}`);
  });
}

// ---------- Debug: draw the whole graph so we can check the data ----------

let networkLayer = null;

// nodes = [{ id, lat, lng }, ...]    edges = [{ from, to, distance }, ...]
// Blue lines are edges (hover to see the length in meters).
// Red dots are nodes (hover to see the node id).
export function drawNetwork(nodes, edges) {
  if (networkLayer) map.removeLayer(networkLayer);
  networkLayer = L.layerGroup().addTo(map);

  // A quick lookup: node id -> node
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const e of edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    L.polyline(
      [
        [a.lat, a.lng],
        [b.lat, b.lng],
      ],
      { color: "#1d4ed8", weight: 4, opacity: 0.8 }
    )
      .bindTooltip(`${Math.round(e.distance)} m`)
      .addTo(networkLayer);
  }

  for (const n of nodes) {
    L.circleMarker([n.lat, n.lng], {
      radius: 4,
      color: "#b91c1c",
      weight: 2,
      fillColor: "#ffffff",
      fillOpacity: 1,
    })
      .bindTooltip(String(n.id))
      .addTo(networkLayer);
  }
}
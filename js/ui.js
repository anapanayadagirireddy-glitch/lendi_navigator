import {
  initMap,
  drawNetwork,
  drawRoute,
  clearRoute,
  getMap,
  enableClickCoords,
  addPlaceMarker,
  showUserLocation,
} from "./map.js";
import { buildGraph } from "./graph.js";
import { dijkstra } from "./dijkstra.js";
import { getCurrentPosition, gpsErrorMessage } from "./gps.js";

// true  = "collect mode": click a place on the map and it shows its coordinates
//         (we use this to fill places.json)
// false = normal mode: pick From and To from the dropdowns and press "Find route"
const COLLECT_MODE = false;

const WALKING_SPEED_M_PER_MIN = 83; // about 5 km/h

// If the user is farther than this from every campus path, we say they are off campus.
const MAX_DISTANCE_FROM_CAMPUS_M = 300;

// Loads data/places.json. If the file is missing or empty we return [] instead of crashing.
async function loadPlaces() {
  try {
    const response = await fetch("data/places.json");
    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.warn("Could not load data/places.json:", error);
    return [];
  }
}

async function start() {
  initMap();

  // Load the graph data that convert.js created
  const nodes = await (await fetch("data/nodes.json")).json();
  const edges = await (await fetch("data/edges.json")).json();

  const graph = buildGraph(nodes, edges);
  console.log(`Graph built: ${graph.nodeCount} nodes, ${graph.edgeCount} edges`);

  if (COLLECT_MODE) {
    drawNetwork(nodes, edges); // show the paths so you can click close to them
    enableClickCoords(); // click the map -> popup with lat, lng
    return;
  }

  // ---------- NORMAL MODE ----------
  const info = document.getElementById("route-info");
  const startSelect = document.getElementById("start-select");
  const endSelect = document.getElementById("end-select");
  const routeBtn = document.getElementById("route-btn");
  const gpsBtn = document.getElementById("gps-btn");

  const places = await loadPlaces();
  if (places.length === 0) {
    info.textContent = "No places yet. Add them to data/places.json.";
    return;
  }

  // Snap every place to its nearest graph node, and fill both dropdowns.
  // The option value is the index of the place in the list.
  places.forEach((place, index) => {
    const { node, distance } = graph.findNearestNode(place.lat, place.lng);
    place.nodeId = node.id;

    // A big snap distance means the coordinates are far from any path. Worth a look.
    if (distance > 40) {
      console.warn(`${place.name} is ${Math.round(distance)} m from the nearest path`);
    }

    addPlaceMarker(place.name, place.lat, place.lng);

    for (const select of [startSelect, endSelect]) {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = place.name;
      select.appendChild(option);
    }
  });

  // ---------- "Use my location" ----------
  // When we get a GPS position we remember the nearest graph node here.
  let myNodeId = null;

  gpsBtn.addEventListener("click", async () => {
    info.textContent = "Getting your location...";
    gpsBtn.disabled = true;

    try {
      const position = await getCurrentPosition();
      showUserLocation(position.lat, position.lng);

      const { node, distance } = graph.findNearestNode(position.lat, position.lng);

      if (distance > MAX_DISTANCE_FROM_CAMPUS_M) {
        myNodeId = null;
        info.textContent = `You seem to be about ${Math.round(distance)} m away from the campus paths, so I cannot start a route from here.`;
        return;
      }

      myNodeId = node.id;

      // Add (or reuse) a "My location" option in the From dropdown and select it.
      let option = startSelect.querySelector('option[value="me"]');
      if (!option) {
        option = document.createElement("option");
        option.value = "me";
        option.textContent = "My location";
        startSelect.insertBefore(option, startSelect.options[1] || null);
      }
      startSelect.value = "me";

      info.textContent = "Location found. Now choose a destination and press Find route.";
    } catch (error) {
      info.textContent = gpsErrorMessage(error);
      console.warn("GPS error:", error);
    } finally {
      gpsBtn.disabled = false;
    }
  });

  // ---------- "Find route" ----------
  routeBtn.addEventListener("click", () => {
    if (startSelect.value === "" || endSelect.value === "") {
      info.textContent = "Please choose both a start and a destination.";
      return;
    }

    // The start is either a place from the list or the user's GPS position.
    const from =
      startSelect.value === "me"
        ? { name: "My location", nodeId: myNodeId }
        : places[Number(startSelect.value)];
    const to = places[Number(endSelect.value)];

    if (from.nodeId === null || from.nodeId === undefined) {
      info.textContent = "Press Use my location first, or choose a start place.";
      return;
    }
    if (startSelect.value === endSelect.value) {
      clearRoute();
      info.textContent = "Start and destination are the same place.";
      return;
    }

    const result = dijkstra(graph, from.nodeId, to.nodeId);

    if (result.path.length === 0) {
      clearRoute();
      info.textContent = `No route found from ${from.name} to ${to.name}.`;
      return;
    }

    drawRoute(graph.pathToLatLngs(result.path));

    const meters = Math.round(result.distance);
    const minutes = Math.max(1, Math.round(result.distance / WALKING_SPEED_M_PER_MIN));
    info.textContent = `${from.name} to ${to.name}: ${meters} m, about ${minutes} min walk`;
    console.log(
      `Route: ${result.path.length} nodes, ${meters} m, Dijkstra looked at ${result.visitedCount} nodes`
    );
  });
}

start();
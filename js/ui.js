import {
  initMap,
  drawNetwork,
  drawRoute,
  updateRoute,
  clearRoute,
  getMap,
  enableClickCoords,
  addPlaceMarker,
} from "./map.js";
import { buildGraph, haversine } from "./graph.js";
import { dijkstra } from "./dijkstra.js";
import { astar } from "./astar.js";
import { getCurrentPosition, gpsErrorMessage } from "./gps.js";
import { loadBlocks, openBlockCard, closeCard } from "./card.js";
import { enableCompass, startTracking, recenter, isTracking } from "./tracker.js";
import { makeRoute, updateProgress, rerouteFrom } from "./progress.js";

// true  = "collect mode": click a place on the map and it shows its coordinates
//         (we use this to fill places.json)
// false = normal mode: pick From and To from the dropdowns and press "Find route"
const COLLECT_MODE = false;

const WALKING_SPEED_M_PER_MIN = 83; // about 5 km/h

// If the user is farther than this from every campus path, we say they are off campus.
const MAX_DISTANCE_FROM_CAMPUS_M = 300;

// GPS often lands a few meters beside the path. If the user is within this distance of a path,
// the arrow is placed ON the path.
const SNAP_MAX_DISTANCE_M = 25;

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

  // A small line under the route text that compares the two algorithms
  const algoInfo = document.createElement("p");
  algoInfo.style.cssText = "margin: 4px 0 0; font-size: 0.85rem; color: #4b5563;";
  info.after(algoInfo);

  // The "You have arrived" banner (hidden until you arrive)
  const arrivedBanner = document.createElement("div");
  arrivedBanner.hidden = true;
  arrivedBanner.style.cssText =
    "margin: 8px 0 0; padding: 10px 12px; font-weight: 600; color: #ffffff; background: #0b6e4f; border-radius: 6px;";
  info.after(arrivedBanner);

  // "Share route" button (hidden until a route exists)
  const shareBtn = document.createElement("button");
  shareBtn.type = "button";
  shareBtn.textContent = "Share route";
  shareBtn.hidden = true;
  document.querySelector(".controls").append(shareBtn);

  // The start and destination of the route on screen (used to build the link)
  let sharedRoute = null;

  // The route the user is walking now: { route, to }. While they walk along it, the green
  // line gets shorter (see followRoute below). It is null when there is no route.
  let activeRoute = null;
  let arrived = false; // true after the "You have arrived" message, until the next route

  const places = await loadPlaces();
  if (places.length === 0) {
    info.textContent = "No places yet. Add them to data/places.json.";
    return;
  }

  // Load the block details (rooms, labs...) used by the info card.
  // If this file is missing, the app still works, there is just no card.
  try {
    await loadBlocks();
  } catch (error) {
    console.warn("Could not load data/blocks.json:", error);
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

    const marker = addPlaceMarker(place.name, place.lat, place.lng);

    // Tapping the marker of a block that has room details opens its card
    marker.on("click", () => {
      if (place.blockId) openBlockCard(place.blockId);
    });

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
  let myPosition = null; // the user's latest GPS position

  // ---------- Follow the route while walking ----------
  // Called on every new GPS position. Trims the green line to what is LEFT to walk,
  // says when you arrive, and builds a new route if you leave the old one.
  function followRoute(pos) {
    if (!activeRoute) return;
    const { route, to } = activeRoute;
    const progress = updateProgress(route, pos.lat, pos.lng, pos.accuracy);

    if (progress.status === "following") {
      updateRoute(progress.latlngs, progress.walked); // green = still to walk, grey = already walked
      const meters = Math.round(progress.meters);
      const minutes = Math.max(1, Math.round(progress.meters / WALKING_SPEED_M_PER_MIN));
      info.textContent = `${to.name}: ${meters} m left, about ${minutes} min`;
      return;
    }

    if (progress.status === "arrived") {
      clearRoute();
      activeRoute = null;
      arrived = true;
      algoInfo.textContent = "";
      info.textContent = "";
      arrivedBanner.textContent = `You have arrived at ${to.name}`;
      arrivedBanner.hidden = false;
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]); // a short buzz (Android phones)
      return;
    }

    if (progress.status === "off-route" && myNodeId !== null) {
      const fresh = rerouteFrom(graph, pos.lat, pos.lng, to.nodeId);
      if (!fresh) {
        info.textContent = `You are off the route and I cannot find a way to ${to.name} from here.`;
        return;
      }
      drawRoute(fresh.latlngs, false); // false = do not move the map
      activeRoute.route = makeRoute(fresh.latlngs);
      const meters = Math.round(fresh.meters);
      const minutes = Math.max(1, Math.round(fresh.meters / WALKING_SPEED_M_PER_MIN));
      info.textContent = `New route to ${to.name}: ${meters} m, about ${minutes} min`;
    }
    // "waiting" and "holding": do nothing, the line stays as it is
  }

  // ---------- GPS log (only when the page is opened with ?debug=1) ----------
  // Open the page like  https://your-site/?debug=1 , walk around, then press
  // "Download GPS log". The file shows how good (or noisy) your phone's GPS really is.
  const gpsLog = [];
  let logButton = null;
  if (new URLSearchParams(window.location.search).has("debug")) {
    logButton = document.createElement("button");
    logButton.type = "button";
    logButton.textContent = "Download GPS log (0)";
    document.querySelector(".controls").append(logButton);

    logButton.addEventListener("click", () => {
      const header = "time,raw_lat,raw_lng,accuracy_m,shown_lat,shown_lng,snapped,raw_to_nearest_path_m";
      const csv = [header, ...gpsLog.map((row) => row.join(","))].join("\n");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      link.download = "gps-log.csv";
      link.click();
    });
  }

  function recordFix(pos) {
    if (!logButton) return;
    const nearest = graph.snapToPath(pos.rawLat, pos.rawLng);
    gpsLog.push([
      new Date().toISOString(),
      pos.rawLat.toFixed(7),
      pos.rawLng.toFixed(7),
      Math.round(pos.accuracy),
      pos.lat.toFixed(7),
      pos.lng.toFixed(7),
      pos.snapped ? 1 : 0,
      nearest ? nearest.distance.toFixed(1) : "",
    ]);
    logButton.textContent = `Download GPS log (${gpsLog.length})`;
  }

  gpsBtn.addEventListener("click", async () => {
    // Already tracking? Then this button just brings the map back to you.
    if (isTracking()) {
      recenter();
      if (myNodeId !== null) {
        startSelect.value = "me"; // use where I stand as the start again
        info.textContent = "Start set to your location. Choose a destination and press Find route.";
      } else {
        info.textContent = "You seem to be away from the campus paths, so I cannot start a route from here.";
      }
      return;
    }

    enableCompass(); // must run right inside the tap (iPhones ask for permission here)
    info.textContent = "Getting your location...";
    gpsBtn.disabled = true;

    try {
      const position = await getCurrentPosition();

      const { node, distance } = graph.findNearestNode(position.lat, position.lng);

      if (distance > MAX_DISTANCE_FROM_CAMPUS_M) {
        myNodeId = null;
        info.textContent = `You seem to be about ${Math.round(distance)} m away from the campus paths, so I cannot start a route from here.`;
        return;
      }

      myNodeId = node.id;
      myPosition = position;

      // Show the arrow and keep following the user. Every new position updates myNodeId.
      startTracking({
        initial: position,
        snap: (lat, lng, lastKey) => {
          const snapped = graph.snapToPath(lat, lng, lastKey);
          return snapped && snapped.distance <= SNAP_MAX_DISTANCE_M ? snapped : null;
        },
        onPosition: (pos) => {
          myPosition = pos;
          const nearest = graph.findNearestNode(pos.lat, pos.lng);
          myNodeId =
            nearest.distance <= MAX_DISTANCE_FROM_CAMPUS_M ? nearest.node.id : null;
          recordFix(pos);
          followRoute(pos); // shrink the green line to what is left
        },
        onError: (error) => {
          console.warn("GPS error:", error);
          // While a route is on the screen (or you have just arrived), a short GPS hiccup
          // should not wipe the distance text. A blocked permission is always shown.
          if (error.code === 1 || (!activeRoute && !arrived)) {
            info.textContent = gpsErrorMessage(error);
          }
        },
      });

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

  // ---------- "Share route" ----------
  // Link format:  https://your-site/?from=Parking&to=Sai%20Block
  function buildShareLink() {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    if (sharedRoute.from) url.searchParams.set("from", sharedRoute.from);
    url.searchParams.set("to", sharedRoute.to);
    return url.toString();
  }

  shareBtn.addEventListener("click", async () => {
    if (!sharedRoute) return;
    const link = buildShareLink();

    // A link that points to this computer (file:// or localhost) cannot work on another device
    const host = window.location.hostname;
    const isLocal =
      window.location.protocol === "file:" ||
      host === "localhost" ||
      host === "127.0.0.1" ||
      /^(192\.168\.|10\.)/.test(host);

    // On phones, open the share sheet (WhatsApp, Messages...). The link is inside the text,
    // so apps that drop a separate "url" field still send it.
    const isPhone = window.matchMedia("(pointer: coarse)").matches;
    if (navigator.share && isPhone && !isLocal) {
      try {
        await navigator.share({
          title: "Lendi Campus Navigator",
          text: `Route to ${sharedRoute.to} on the Lendi Campus Navigator: ${link}`,
        });
        return;
      } catch (error) {
        if (error.name === "AbortError") return; // the user closed the share sheet
      }
    }

    // Otherwise copy the link
    try {
      await navigator.clipboard.writeText(link);
      const label = shareBtn.textContent;
      shareBtn.textContent = "Link copied!";
      setTimeout(() => {
        shareBtn.textContent = label;
      }, 2000);
    } catch (error) {
      window.prompt("Copy this link:", link);
    }

    if (isLocal) {
      algoInfo.textContent =
        "This link points to a local address, so it only works on this computer. After the site is on GitHub Pages, shared links will work for everyone.";
    }
  });

  // ---------- "Find route" ----------
  routeBtn.addEventListener("click", () => {
    arrivedBanner.hidden = true;
    algoInfo.textContent = "";
    shareBtn.hidden = true;
    sharedRoute = null;
    activeRoute = null;
    arrived = false;
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
      closeCard();
      info.textContent = "Start and destination are the same place.";
      return;
    }

    const result = dijkstra(graph, from.nodeId, to.nodeId);

    if (result.path.length === 0) {
      clearRoute();
      closeCard();
      info.textContent = `No route found from ${from.name} to ${to.name}.`;
      return;
    }

    drawRoute(graph.pathToLatLngs(result.path));

    // Remember this route, so the green line can shrink while the user walks along it
    activeRoute = { route: makeRoute(graph.pathToLatLngs(result.path)), to };

    // Remember this route so the Share button can build a link.
    // "My location" is only true for you, so it is left out of the link.
    sharedRoute = { from: startSelect.value === "me" ? null : from.name, to: to.name };
    shareBtn.hidden = false;

    // Run A* on the same start and destination and compare it with Dijkstra
    const aStarResult = astar(graph, from.nodeId, to.nodeId);
    algoInfo.textContent = `Nodes checked: Dijkstra ${result.visitedCount}, A* ${aStarResult.visitedCount}`;
    if (Math.abs(result.distance - aStarResult.distance) > 0.5) {
      console.warn("Dijkstra and A* gave different distances!", result.distance, aStarResult.distance);
    }

    const meters = Math.round(result.distance);
    const minutes = Math.max(1, Math.round(result.distance / WALKING_SPEED_M_PER_MIN));
    info.textContent = `${from.name} to ${to.name}: ${meters} m, about ${minutes} min walk`;

    // If we are tracking the user but they chose a start where they are not standing, tell them
    if (isTracking() && startSelect.value !== "me" && myPosition) {
      const away = haversine(myPosition.lat, myPosition.lng, from.lat, from.lng);
      if (away > 60) {
        info.textContent += `. Note: you are not at ${from.name}. Tap Use my location to start from where you are.`;
      }
    }
    console.log(
      `Route: ${result.path.length} nodes, ${meters} m, Dijkstra looked at ${result.visitedCount} nodes`
    );

    // If the destination is a block with room details, open its card
    if (to.blockId) {
      openBlockCard(to.blockId);
    } else {
      closeCard();
    }
  });

  // ---------- Open a shared link ----------
  // If the page was opened with ?from=...&to=..., fill the dropdowns and show the route.
  const params = new URLSearchParams(window.location.search);
  const indexOfPlace = (name) =>
    places.findIndex((p) => p.name.toLowerCase() === (name || "").toLowerCase());
  const sharedToIndex = indexOfPlace(params.get("to"));
  const sharedFromIndex = indexOfPlace(params.get("from"));

  if (sharedToIndex !== -1) {
    endSelect.value = String(sharedToIndex);
    if (sharedFromIndex !== -1) {
      startSelect.value = String(sharedFromIndex);
      routeBtn.click(); // show the route right away
    } else {
      info.textContent = `Destination: ${places[sharedToIndex].name}. Choose where you are, or tap Use my location.`;
    }
  }
}

start();
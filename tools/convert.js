// tools/convert.js
// One-time script: turns the raw OpenStreetMap export (tools/campus-raw.json)
// into the two clean files our app uses: data/nodes.json and data/edges.json
//
// Run it from your project folder with:   node tools/convert.js

const fs = require("fs");
const path = require("path");

// ---------- Settings ----------
const INPUT = path.join(__dirname, "campus-raw.json");
const OUT_DIR = path.join(__dirname, "..", "data");

// Same center as map.js. We only keep points near the campus.
const CAMPUS_CENTER = { lat: 18.019461, lng: 83.40109 };
const MAX_RADIUS_M = 450;

// Only these kinds of OSM ways are walkable for us.
// (highway=services is a petrol-pump area, NOT a road, so it is left out on purpose.)
const WALKABLE = new Set([
  "footway",
  "path",
  "pedestrian",
  "steps",
  "track",
  "service",
  "living_street",
  "residential",
  "unclassified",
  "tertiary",
  "tertiary_link",
]);

// ---------- Helper: distance between two GPS points in meters (haversine) ----------
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000; // earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------- Step 1: read the raw file ----------
const raw = JSON.parse(fs.readFileSync(INPUT, "utf8"));

const nodes = new Map(); // id -> { id, lat, lng }
const edges = []; // { from, to, distance }
const seenEdges = new Set(); // to avoid saving the same edge twice

// ---------- Step 2: every walkable way becomes a chain of edges ----------
for (const way of raw.elements) {
  if (way.type !== "way" || !way.tags || !WALKABLE.has(way.tags.highway)) continue;
  if (!way.nodes || !way.geometry || way.nodes.length !== way.geometry.length) continue;

  for (let i = 0; i < way.nodes.length - 1; i++) {
    const idA = way.nodes[i];
    const idB = way.nodes[i + 1];
    const pA = way.geometry[i];
    const pB = way.geometry[i + 1];
    if (idA === idB || !pA || !pB) continue;

    const key = idA < idB ? `${idA}-${idB}` : `${idB}-${idA}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);

    nodes.set(idA, { id: idA, lat: pA.lat, lng: pA.lon });
    nodes.set(idB, { id: idB, lat: pB.lat, lng: pB.lon });

    const distance = haversine(pA.lat, pA.lon, pB.lat, pB.lon);
    edges.push({ from: idA, to: idB, distance: Math.round(distance * 100) / 100 });
  }
}
console.log(`Read from raw file: ${nodes.size} nodes, ${edges.length} edges`);

// ---------- Step 3: throw away everything too far from the campus ----------
const nearIds = new Set();
for (const n of nodes.values()) {
  if (haversine(CAMPUS_CENTER.lat, CAMPUS_CENTER.lng, n.lat, n.lng) <= MAX_RADIUS_M) {
    nearIds.add(n.id);
  }
}
const nearEdges = edges.filter((e) => nearIds.has(e.from) && nearIds.has(e.to));
console.log(`Within ${MAX_RADIUS_M} m of campus: ${nearIds.size} nodes, ${nearEdges.length} edges`);

// ---------- Step 4: keep only the part that is connected to the campus ----------
// (paths that are not connected to the main network are useless for routing)
const neighbors = new Map(); // id -> list of neighbor ids
for (const e of nearEdges) {
  if (!neighbors.has(e.from)) neighbors.set(e.from, []);
  if (!neighbors.has(e.to)) neighbors.set(e.to, []);
  neighbors.get(e.from).push(e.to);
  neighbors.get(e.to).push(e.from);
}

// Find the node closest to the campus center, and start from there
let startId = null;
let best = Infinity;
for (const id of neighbors.keys()) {
  const n = nodes.get(id);
  const d = haversine(CAMPUS_CENTER.lat, CAMPUS_CENTER.lng, n.lat, n.lng);
  if (d < best) {
    best = d;
    startId = id;
  }
}

// Breadth-first search: collect every node reachable from startId
const keep = new Set([startId]);
const queue = [startId];
while (queue.length > 0) {
  const current = queue.shift();
  for (const next of neighbors.get(current)) {
    if (!keep.has(next)) {
      keep.add(next);
      queue.push(next);
    }
  }
}

const finalNodes = [...keep].map((id) => nodes.get(id));
const finalEdges = nearEdges.filter((e) => keep.has(e.from) && keep.has(e.to));

// ---------- Step 5: write the output files ----------
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "nodes.json"), JSON.stringify(finalNodes, null, 2));
fs.writeFileSync(path.join(OUT_DIR, "edges.json"), JSON.stringify(finalEdges, null, 2));

console.log(`\nSaved to data/: ${finalNodes.length} nodes, ${finalEdges.length} edges`);
console.log(`Dropped as disconnected from campus: ${nearIds.size - keep.size} nodes`);

// ---------- Step 6: check the named paths are connected ----------
for (const way of raw.elements) {
  if (way.type === "way" && way.tags && way.tags.name) {
    const connected = way.nodes.some((id) => keep.has(id));
    console.log(`Path "${way.tags.name}" connected to campus network: ${connected ? "YES" : "NO"}`);
  }
}
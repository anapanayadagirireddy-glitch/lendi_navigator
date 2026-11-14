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

// ---------- Step 2b: join dead ends to a path that passes right next to them ----------
// In OpenStreetMap a path sometimes stops 1 to 3 meters SHORT of the path it should join.
// On the map it looks connected, but in our graph it is NOT, so a route that starts at the
// end of that path has to go the long way round. Here we join such dead ends to the path
// that passes next to them.
const JOIN_DISTANCE_M = 4; // only join when the other path is this close (meters)
let nextNewId = 900000000000; // ids for the new meeting points (real OSM ids are smaller)

// Closest point on the straight piece a-b to the point p (all are { lat, lng })
function projectOnSegment(p, a, b) {
  const M_PER_DEG_LAT = 110540;
  const M_PER_DEG_LNG = 111320 * Math.cos((p.lat * Math.PI) / 180);
  // Work in meters with p at (0, 0)
  const ax = (a.lng - p.lng) * M_PER_DEG_LNG;
  const ay = (a.lat - p.lat) * M_PER_DEG_LAT;
  const bx = (b.lng - p.lng) * M_PER_DEG_LNG;
  const by = (b.lat - p.lat) * M_PER_DEG_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : -(ax * dx + ay * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx;
  const py = ay + t * dy;
  return {
    lat: p.lat + py / M_PER_DEG_LAT,
    lng: p.lng + px / M_PER_DEG_LNG,
    distance: Math.hypot(px, py),
  };
}

const round2 = (x) => Math.round(x * 100) / 100;

// A dead end is a point with only ONE path attached
const degree = new Map();
for (const e of edges) {
  degree.set(e.from, (degree.get(e.from) || 0) + 1);
  degree.set(e.to, (degree.get(e.to) || 0) + 1);
}
const deadEnds = [...degree.keys()].filter((id) => degree.get(id) === 1);
let joinedCount = 0;

for (const id of deadEnds) {
  const p = nodes.get(id);

  // The one neighbor of this dead end. Paths touching it do not count as "another path".
  const own = edges.find((e) => e.from === id || e.to === id);
  const neighbor = own.from === id ? own.to : own.from;

  let best = null;
  for (const e of edges) {
    if (e.from === id || e.to === id || e.from === neighbor || e.to === neighbor) continue;
    const hit = projectOnSegment(p, nodes.get(e.from), nodes.get(e.to));
    if (!best || hit.distance < best.distance) best = { ...hit, edge: e };
  }
  if (!best || best.distance > JOIN_DISTANCE_M) continue;

  const a = nodes.get(best.edge.from);
  const b = nodes.get(best.edge.to);
  const alongA = haversine(a.lat, a.lng, best.lat, best.lng);
  const alongB = haversine(b.lat, b.lng, best.lat, best.lng);

  let target;
  if (alongA < 0.5) {
    target = a.id; // it meets the other path right at one of its corners
  } else if (alongB < 0.5) {
    target = b.id;
  } else {
    // Cut the other path in two at the meeting point
    target = nextNewId++;
    nodes.set(target, { id: target, lat: best.lat, lng: best.lng });
    edges.splice(edges.indexOf(best.edge), 1);
    edges.push(
      { from: best.edge.from, to: target, distance: round2(alongA) },
      { from: target, to: best.edge.to, distance: round2(alongB) }
    );
  }

  const t = nodes.get(target);
  edges.push({ from: id, to: target, distance: round2(haversine(p.lat, p.lng, t.lat, t.lng)) });
  joinedCount++;
  console.log(
    `Joined dead end ${id} (${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}) to a path ${best.distance.toFixed(1)} m away`
  );
}
console.log(`Dead ends joined to a nearby path: ${joinedCount} (of ${deadEnds.length} dead ends)\n`);

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
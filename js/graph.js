// graph.js
// The Graph class: this is the data structure at the heart of the project.
//
// We store the graph as an ADJACENCY LIST:
//   for every node id, a list of its neighbors and the distance to each one.
//
//   Example:  adjacency.get(101) = [ { to: 102, distance: 14.5 }, { to: 250, distance: 32.1 } ]
//   means node 101 is connected to node 102 (14.5 m away) and node 250 (32.1 m away).

// ---------- Distance between two GPS points in meters (haversine formula) ----------
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000; // earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export class Graph {
  constructor() {
    this.nodes = new Map(); // id -> { id, lat, lng }
    this.adjacency = new Map(); // id -> [ { to, distance }, ... ]
  }

  // Add one point to the graph
  addNode(node) {
    this.nodes.set(node.id, node);
    if (!this.adjacency.has(node.id)) {
      this.adjacency.set(node.id, []);
    }
  }

  // Connect two nodes. People can walk both ways, so we add the edge in BOTH directions.
  addEdge(fromId, toId, distance) {
    this.adjacency.get(fromId).push({ to: toId, distance });
    this.adjacency.get(toId).push({ to: fromId, distance });
  }

  getNode(id) {
    return this.nodes.get(id);
  }

  // Returns the list of { to, distance } for a node
  getNeighbors(id) {
    return this.adjacency.get(id) || [];
  }

  get nodeCount() {
    return this.nodes.size;
  }

  // Each edge is stored twice (once per direction), so divide by 2
  get edgeCount() {
    let total = 0;
    for (const list of this.adjacency.values()) {
      total += list.length;
    }
    return total / 2;
  }

  // Finds the graph node closest to any GPS point.
  // We need this to attach places (Library, Canteen...) and the user's GPS position to the graph.
  // Returns { node, distance } where distance is in meters.
  findNearestNode(lat, lng) {
    let bestNode = null;
    let bestDistance = Infinity;

    for (const node of this.nodes.values()) {
      const d = haversine(lat, lng, node.lat, node.lng);
      if (d < bestDistance) {
        bestDistance = d;
        bestNode = node;
      }
    }
    return { node: bestNode, distance: bestDistance };
  }

  // Turns a list of node ids into [[lat, lng], ...] so the map can draw the route
  pathToLatLngs(path) {
    return path.map((id) => {
      const node = this.nodes.get(id);
      return [node.lat, node.lng];
    });
  }
}

// ---------- Build a Graph from the data in nodes.json and edges.json ----------
export function buildGraph(nodes, edges) {
  const graph = new Graph();

  for (const node of nodes) {
    graph.addNode(node);
  }
  for (const edge of edges) {
    graph.addEdge(edge.from, edge.to, edge.distance);
  }

  return graph;
}
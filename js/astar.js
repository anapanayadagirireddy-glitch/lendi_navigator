// astar.js
// A* (say "A star"): a smarter version of Dijkstra that finds the SAME shortest route
// but checks fewer nodes.
//
// THE IDEA:
//   Dijkstra spreads out from the start in all directions, like ripples in water.
//   It checks every node that is closer to the start than the destination is,
//   even the ones in the opposite direction.
//
//   A* adds a HINT: "how far is the destination in a straight line?"
//   For every node it calculates:
//
//        f = g + h
//
//        g = the real distance walked from the start to this node (same as Dijkstra)
//        h = the straight-line distance from this node to the destination (the hint)
//
//   It always checks the node with the smallest f next. Nodes that lead AWAY from the
//   destination get a big h, so they wait at the back of the queue and often never get checked.
//
// WHY IT STILL GIVES THE SHORTEST ROUTE:
//   The hint must never be bigger than the real remaining distance. A straight line is always
//   shorter than (or equal to) any walkable path, so this rule holds.
//   (If the hint were ever too big, A* could miss the shortest route.)

import { MinPriorityQueue } from "./dijkstra.js";
import { haversine } from "./graph.js";

// Returns the same kind of result as dijkstra():
//   path, distance (meters), visitedCount (how many nodes were checked)
export function astar(graph, startId, endId) {
    const noRoute = { path: [], distance: Infinity, visitedCount: 0 };

    if (!graph.nodes.has(startId) || !graph.nodes.has(endId)) {
        return noRoute;
    }

    const goal = graph.getNode(endId);

    // The hint: straight-line distance from a node to the destination, in meters
    const hint = (id) => {
        const node = graph.getNode(id);
        return haversine(node.lat, node.lng, goal.lat, goal.lng);
    };

    const g = new Map(); // node id -> real distance from the start (only for nodes we have reached)
    const previous = new Map(); // node id -> the node we came from
    const visited = new Set();

    g.set(startId, 0);

    const queue = new MinPriorityQueue();
    queue.push(startId, hint(startId)); // priority f = g + h = 0 + h

    while (!queue.isEmpty()) {
        const { item: current } = queue.pop();

        if (visited.has(current)) continue; // outdated queue entry
        visited.add(current);

        if (current === endId) break; // reached the destination

        for (const { to, distance } of graph.getNeighbors(current)) {
            if (visited.has(to)) continue;

            const newG = g.get(current) + distance;
            const oldG = g.has(to) ? g.get(to) : Infinity;

            if (newG < oldG) {
                g.set(to, newG);
                previous.set(to, current);
                queue.push(to, newG + hint(to)); // f = g + h
            }
        }
    }

    if (!g.has(endId)) {
        return { ...noRoute, visitedCount: visited.size };
    }

    // Build the route by walking backwards from the destination
    const path = [];
    for (let at = endId; at !== undefined; at = previous.get(at)) {
        path.push(at);
    }
    path.reverse();

    return { path, distance: g.get(endId), visitedCount: visited.size };
}
// dijkstra.js
// Dijkstra's shortest-path algorithm, plus the priority queue it needs.
//
// THE IDEA (in plain words):
//   1. Start at the start node. Its distance is 0. Every other node is "infinity" (unknown).
//   2. Always pick the unvisited node that is CLOSEST to the start so far.
//   3. From that node, look at each neighbor: is going through this node a shorter way
//      to reach the neighbor than what we knew before? If yes, remember the better way.
//   4. Repeat until we reach the destination.
//   5. To get the route, walk backwards from the destination using the "previous" notes.

// ---------- Min priority queue (a binary min-heap) ----------
// It always gives back the item with the SMALLEST priority first.
// push and pop both take O(log n) time. A plain array would need O(n) to find the minimum.
//
// The heap is stored in an array. For the item at index i:
//   parent      = floor((i - 1) / 2)
//   left child  = 2 * i + 1
//   right child = 2 * i + 2
export class MinPriorityQueue {
  constructor() {
    this.heap = []; // each entry is { item, priority }
  }

  get size() {
    return this.heap.length;
  }

  isEmpty() {
    return this.heap.length === 0;
  }

  // Add an item, then move it UP until the heap order is correct again
  push(item, priority) {
    this.heap.push({ item, priority });
    this._bubbleUp(this.heap.length - 1);
  }

  // Remove and return the entry with the smallest priority
  pop() {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last; // move the last entry to the top...
      this._sinkDown(0); // ...then move it DOWN to where it belongs
    }
    return top; // { item, priority }
  }

  _swap(i, j) {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.heap[parent].priority <= this.heap[i].priority) break;
      this._swap(parent, i);
      i = parent;
    }
  }

  _sinkDown(i) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;

      if (left < n && this.heap[left].priority < this.heap[smallest].priority) {
        smallest = left;
      }
      if (right < n && this.heap[right].priority < this.heap[smallest].priority) {
        smallest = right;
      }
      if (smallest === i) break;

      this._swap(i, smallest);
      i = smallest;
    }
  }
}

// ---------- Dijkstra ----------
// graph    : a Graph from graph.js
// startId  : id of the node where we start
// endId    : id of the node where we want to go
//
// Returns:
//   path         : list of node ids from start to end (empty if there is no route)
//   distance     : total length in meters (Infinity if there is no route)
//   visitedCount : how many nodes the algorithm had to look at (useful to compare with A* later)
export function dijkstra(graph, startId, endId) {
  const noRoute = { path: [], distance: Infinity, visitedCount: 0 };

  // Safety check: both nodes must exist in the graph
  if (!graph.nodes.has(startId) || !graph.nodes.has(endId)) {
    return noRoute;
  }

  const dist = new Map(); // node id -> shortest distance from start found so far
  const previous = new Map(); // node id -> the node we came from on that shortest way
  const visited = new Set(); // nodes we are completely done with

  for (const id of graph.nodes.keys()) {
    dist.set(id, Infinity);
  }
  dist.set(startId, 0);

  const queue = new MinPriorityQueue();
  queue.push(startId, 0);

  while (!queue.isEmpty()) {
    const { item: current } = queue.pop();

    // The queue can hold old, outdated entries for a node. Skip them.
    if (visited.has(current)) continue;
    visited.add(current);

    // The closest unvisited node is the destination: its distance is final. Stop.
    if (current === endId) break;

    for (const { to, distance } of graph.getNeighbors(current)) {
      if (visited.has(to)) continue;

      const newDistance = dist.get(current) + distance;
      if (newDistance < dist.get(to)) {
        dist.set(to, newDistance); // found a shorter way to "to"
        previous.set(to, current); // remember how we got there
        queue.push(to, newDistance);
      }
    }
  }

  // If the end node still has distance Infinity, it was never reached
  if (dist.get(endId) === Infinity) {
    return { ...noRoute, visitedCount: visited.size };
  }

  // Build the route by walking BACKWARDS from the end to the start
  const path = [];
  for (let at = endId; at !== undefined; at = previous.get(at)) {
    path.push(at);
  }
  path.reverse();

  return { path, distance: dist.get(endId), visitedCount: visited.size };
}
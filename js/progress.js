// progress.js
// Follows the user along the green route, like Google Maps does.
//
// THE IDEA (in plain words):
//   The route is a chain of short straight pieces. On every GPS update we ask:
//   "Which piece of the route are you on, and how far along it?"
//   Everything BEFORE that point is already walked, so we drop it from the green line.
//   What is left (from your position to the destination) is the new green line.
//
//   If you wander away from the route for a few updates in a row, we find a NEW shortest
//   route from where you are (a "reroute").
//
// This file has no map code. It only does maths, so it is easy to test.

import { haversine } from "./graph.js";
import { dijkstra } from "./dijkstra.js";

// Closer than this to the route (meters) = "you are on the route".
// When the GPS says it is less sure than this (accuracy), we allow more, up to MAX_ON_ROUTE_M,
// because a weak GPS can put you 30 m from where you really are.
export const ON_ROUTE_M = 25;
const MAX_ON_ROUTE_M = 40;
// This many updates in a row away from the route = "you left the route".
export const OFF_ROUTE_FIXES = 4;
// This close to the destination (meters) = "you have arrived".
export const ARRIVED_M = 15;
// GPS jitter can make you look like you stepped backwards. A step back is ignored, so the
// green line does not grow back, unless it keeps happening for BACK_FIXES updates in a row
// (then you really turned round). Steps back smaller than the GPS accuracy (and never less
// than TINY_BACK_M) are always ignored, because they cannot be told apart from noise.
const TINY_BACK_M = 3;
const BACK_FIXES = 6;
// Nobody walks faster than this (meters per second). A GPS reading that says you jumped
// further than this since the last update is mostly noise, so we only move the green line
// forward this fast. If the jump was real, the line simply catches up a moment later.
const MAX_SPEED_M_PER_S = 3.5;
const FORWARD_SLACK_M = 3;
// To join the route we need this many good updates in a row. One lucky or unlucky reading
// (very common when GPS has just started) must not trim the line by itself.
const JOIN_FIXES = 3;

// ---------- Making a route object ----------
// latlngs: [[lat, lng], [lat, lng], ...] along the route, from start to destination.
export function makeRoute(latlngs) {
    const cum = [0]; // cum[i] = meters from the start up to point i
    for (let i = 1; i < latlngs.length; i++) {
        const [aLat, aLng] = latlngs[i - 1];
        const [bLat, bLng] = latlngs[i];
        cum.push(cum[i - 1] + haversine(aLat, aLng, bLat, bLng));
    }
    return {
        latlngs,
        cum,
        total: cum[cum.length - 1],
        lastIndex: 0, // the piece we were on last time
        along: 0, // meters walked so far (never goes down by GPS jitter)
        lastPoint: null, // the point on the route where the green line starts now
        active: false, // becomes true once the user has been ON the route
        offCount: 0, // updates in a row that were off the route
        backCount: 0, // updates in a row that looked like walking backwards
        lastTime: null, // time (ms) of the last update that moved the line
        joinHits: [], // the first on-route updates, collected before we start trimming
    };
}

// The point that is `along` meters from the start of the route.
function pointAtAlong(route, along) {
    const last = route.latlngs.length - 1;
    if (along >= route.total) {
        const [lat, lng] = route.latlngs[last];
        return { lat, lng, index: Math.max(0, last - 1), along: route.total };
    }
    let i = 0;
    while (i < last - 1 && route.cum[i + 1] < along) i++;
    const length = route.cum[i + 1] - route.cum[i];
    const t = length === 0 ? 0 : (along - route.cum[i]) / length;
    const [aLat, aLng] = route.latlngs[i];
    const [bLat, bLng] = route.latlngs[i + 1];
    return { lat: aLat + (bLat - aLat) * t, lng: aLng + (bLng - aLng) * t, index: i, along };
}

// ---------- Closest point on one straight piece ----------
function projectOnPiece(a, b, lat, lng) {
    const M_PER_DEG_LAT = 110540;
    const M_PER_DEG_LNG = 111320 * Math.cos((lat * Math.PI) / 180);

    // Work in meters with the GPS point at (0, 0)
    const ax = (a[1] - lng) * M_PER_DEG_LNG;
    const ay = (a[0] - lat) * M_PER_DEG_LAT;
    const bx = (b[1] - lng) * M_PER_DEG_LNG;
    const by = (b[0] - lat) * M_PER_DEG_LAT;

    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;

    // How far along the piece is the closest point? 0 = at a, 1 = at b
    let t = lengthSquared === 0 ? 0 : -(ax * dx + ay * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));

    const px = ax + t * dx;
    const py = ay + t * dy;
    return {
        lat: lat + py / M_PER_DEG_LAT,
        lng: lng + px / M_PER_DEG_LNG,
        distance: Math.hypot(px, py),
        t,
    };
}

// Finds the closest point ON the route to a GPS position.
// Before the user has joined the route we look at the whole route (they may join in the middle).
// After that we only look at pieces near where they were last time. This stops the green line
// from jumping to a far-away part of the route that happens to pass close by.
export function projectOnRoute(route, lat, lng) {
    const pieces = route.latlngs.length - 1;

    if (pieces < 1) {
        const [pLat, pLng] = route.latlngs[0];
        return { lat: pLat, lng: pLng, distance: haversine(lat, lng, pLat, pLng), index: 0, t: 0, along: 0 };
    }

    const search = (from, to) => {
        let best = null;
        for (let i = from; i <= to; i++) {
            const hit = projectOnPiece(route.latlngs[i], route.latlngs[i + 1], lat, lng);
            if (!best || hit.distance < best.distance) {
                best = { ...hit, index: i, along: route.cum[i] + hit.t * (route.cum[i + 1] - route.cum[i]) };
            }
        }
        return best;
    };

    if (!route.active) return search(0, pieces - 1);
    return search(Math.max(0, route.lastIndex - 1), Math.min(pieces - 1, route.lastIndex + 8));
}

// ---------- The main function: call it on every GPS update ----------
// Returns one of:
//   { status: "waiting" }                              you have not joined the route yet
//   { status: "holding" }                              a bit off the route: change nothing yet
//   { status: "following", latlngs, walked, meters }   `latlngs` = still to walk (green), `walked` = already walked (grey)
//   { status: "arrived" }                              you are at the destination
//   { status: "off-route" }                            you left the route: reroute now
// accuracy (optional): how sure the GPS is, in meters. A weak GPS gets more room.
// now (optional): the time in milliseconds, used to limit how fast the line can move.
export function updateProgress(route, lat, lng, accuracy = 0, now = Date.now()) {
    const limit = Math.min(MAX_ON_ROUTE_M, Math.max(ON_ROUTE_M, accuracy || 0));
    let hit = projectOnRoute(route, lat, lng);

    if (hit.distance > limit) {
        route.offCount++;
        // Before we ever joined the route, being away from it is normal.
        if (!route.active) {
            route.joinHits = [];
            return { status: "waiting" };
        }
        return route.offCount >= OFF_ROUTE_FIXES ? { status: "off-route" } : { status: "holding" };
    }

    // Joining the route: wait for a few good updates in a row, then start from the one that
    // is furthest back (the careful choice: the line may shrink a little late, never too early).
    if (!route.active) {
        route.joinHits.push(hit);
        if (route.joinHits.length < JOIN_FIXES) return { status: "waiting" };
        hit = route.joinHits.reduce((a, b) => (b.along < a.along ? b : a));
        route.joinHits = [];
        route.active = true;
    }

    route.offCount = 0;

    // Stepping backwards is usually GPS jitter, so keep the old point. Believe it only if it
    // goes on for several updates in a row.
    let point = hit;
    const back = route.along - hit.along;
    if (route.lastPoint && back > 0) {
        // A step back smaller than the GPS accuracy cannot be told apart from noise
        if (back <= Math.max(TINY_BACK_M, accuracy || 0)) {
            point = route.lastPoint;
        } else {
            route.backCount++;
            if (route.backCount < BACK_FIXES) point = route.lastPoint;
            else route.backCount = 0; // believe it: the user turned round
        }
    } else {
        route.backCount = 0;
    }

    // Do not let the green line jump further forward than a person could have walked
    if (route.lastPoint && route.lastTime !== null && point.along > route.along) {
        const seconds = Math.max(0.5, (now - route.lastTime) / 1000);
        const maxAlong = route.along + MAX_SPEED_M_PER_S * seconds + FORWARD_SLACK_M;
        if (point.along > maxAlong) point = pointAtAlong(route, maxAlong);
    }
    route.lastTime = now;
    route.along = point.along;
    route.lastIndex = point.index;
    route.lastPoint = point;

    const meters = Math.max(0, route.total - point.along);
    if (meters <= ARRIVED_M) return { status: "arrived", meters };

    // The green line: from where you are now, then every remaining point of the route
    const latlngs = [[point.lat, point.lng], ...route.latlngs.slice(point.index + 1)];
    // The part already walked: from the start of the route up to where you are now
    const walked = [...route.latlngs.slice(0, point.index + 1), [point.lat, point.lng]];
    return { status: "following", latlngs, walked, meters };
}

// ---------- A new route from where the user stands ----------
// The user is somewhere ON a path, between two corners. The shortest way to the destination
// starts from one of those two corners, so we try both and keep the better one.
// Returns { latlngs, meters } or null if there is no way.
export function rerouteFrom(graph, lat, lng, toNodeId) {
    const snap = graph.snapToPath(lat, lng);
    if (!snap) return null;

    let best = null;
    for (const text of snap.key.split("-")) {
        const id = graph.nodes.has(Number(text)) ? Number(text) : text;
        const node = graph.getNode(id);
        if (!node) continue;

        const result = dijkstra(graph, id, toNodeId);
        if (result.path.length === 0) continue;

        const meters = haversine(lat, lng, node.lat, node.lng) + result.distance;
        if (!best || meters < best.meters) {
            best = { latlngs: [[lat, lng], ...graph.pathToLatLngs(result.path)], meters };
        }
    }
    return best;
}
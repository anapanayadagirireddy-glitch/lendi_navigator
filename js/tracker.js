// tracker.js
// Live location tracking with an ARROW that shows where you are and which way you face.
//
// GPS is only accurate to about 5 to 15 meters (worse between buildings), so a raw reading
// jumps around inside its "accuracy circle". Before drawing the arrow we clean each reading:
//   1. Ignore very poor readings.
//   2. Smooth: move only part of the way towards each new reading.
//   3. Snap: if we are close to a campus path, put the arrow ON the path.
//
// Where the direction comes from (best first):
//   1. The phone's compass (works even when you stand still). iPhones ask permission once.
//   2. GPS movement direction (only known while you are walking).
//   3. Neither known (for example on a laptop): we draw a plain blue dot instead of an arrow.
//
// Public functions:
//   enableCompass()          call it INSIDE the button tap (iPhones need that)
//   startTracking({...})     start following the user and draw the arrow
//   recenter()               move the map back to the user and follow again
//   isTracking()             true while tracking
//   stopTracking()           stop everything

import { getMap } from "./map.js";

// Readings worse than this (accuracy in meters) are ignored, unless we ignored several in a row
const MAX_USABLE_ACCURACY_M = 40;
const MAX_SKIPPED_IN_A_ROW = 4;

let watchId = null;
let arrowMarker = null;
let accuracyCircle = null;
let follow = true; // is the map following the user?

let compassHeading = null; // degrees, 0 = north, from the compass (or null)
let gpsHeading = null; // degrees, from walking direction (last known value, or null)
let displayAngle = null; // the angle we actually draw (smoothed)
let compassStarted = false;

let smoothed = null; // the smoothed position { lat, lng }
let lastEdgeKey = null; // the path piece we were snapped to last time
let skipped = 0; // poor readings ignored in a row

// The arrow icon. It points UP (north) before we rotate it.
// The dot is shown when we do not know the direction yet.
const ICON_HTML = `
  <div style="position:relative;width:44px;height:44px;">
    <div class="gps-dot" style="position:absolute;left:12px;top:12px;width:20px;height:20px;border-radius:50%;background:#1d4ed8;border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.5);"></div>
    <svg class="gps-arrow" viewBox="0 0 44 44" width="44" height="44"
         style="position:absolute;left:0;top:0;display:none;transform-origin:50% 50%;filter:drop-shadow(0 1px 3px rgba(0,0,0,.5));">
      <path d="M22 3 L36 38 L22 30 L8 38 Z" fill="#1d4ed8" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
    </svg>
  </div>`;

// ---------- Cleaning the readings ----------

// Moves from the previous smoothed position towards the new reading.
// A good reading (small accuracy number) is trusted more than a poor one.
export function smoothStep(previous, reading) {
    if (!previous) return { lat: reading.lat, lng: reading.lng };
    const accuracy = reading.accuracy > 0 ? reading.accuracy : 15;
    const trust = Math.min(0.6, Math.max(0.15, 12 / accuracy)); // between 0.15 and 0.6
    return {
        lat: previous.lat + (reading.lat - previous.lat) * trust,
        lng: previous.lng + (reading.lng - previous.lng) * trust,
    };
}

// ---------- Direction ----------

function currentHeading() {
    return compassHeading !== null ? compassHeading : gpsHeading;
}

// Rotates the arrow towards the newest direction, smoothly.
function updateArrowRotation() {
    if (!arrowMarker) return;
    const root = arrowMarker.getElement();
    if (!root) return;
    const dot = root.querySelector(".gps-dot");
    const arrow = root.querySelector(".gps-arrow");

    const target = currentHeading();
    if (target === null) {
        dot.style.display = "block";
        arrow.style.display = "none";
        return;
    }
    dot.style.display = "none";
    arrow.style.display = "block";

    if (displayAngle === null) {
        displayAngle = target;
    } else {
        // Take the SHORTEST way round (so 350 degrees to 10 degrees turns 20, not 340),
        // and move only part of the way each time so the arrow does not shake.
        const diff = ((((target - displayAngle) % 360) + 540) % 360) - 180;
        displayAngle += diff * 0.35;
    }
    arrow.style.transform = `rotate(${displayAngle}deg)`;
}

function onOrientation(event) {
    let heading = null;
    if (typeof event.webkitCompassHeading === "number") {
        heading = event.webkitCompassHeading; // iPhone: degrees clockwise from north
    } else if (event.absolute === true && typeof event.alpha === "number") {
        heading = (360 - event.alpha) % 360; // Android: alpha counts the other way round
    }
    if (heading === null) return;
    compassHeading = heading;
    updateArrowRotation();
}

// Starts listening to the phone's compass.
// IMPORTANT: call this directly inside a button click, before any "await".
export async function enableCompass() {
    if (compassStarted || typeof DeviceOrientationEvent === "undefined") return;

    try {
        // iPhones (iOS 13+) ask the user for permission here
        if (typeof DeviceOrientationEvent.requestPermission === "function") {
            const answer = await DeviceOrientationEvent.requestPermission();
            if (answer !== "granted") return;
        }
    } catch (error) {
        console.warn("Compass permission problem:", error);
        return;
    }

    compassStarted = true;
    if ("ondeviceorientationabsolute" in window) {
        window.addEventListener("deviceorientationabsolute", onOrientation, true); // Android Chrome
    } else {
        window.addEventListener("deviceorientation", onOrientation, true); // iPhone
    }
}

// ---------- Drawing the arrow ----------

function placeArrow(lat, lng, accuracy) {
    const map = getMap();

    if (!arrowMarker) {
        arrowMarker = L.marker([lat, lng], {
            icon: L.divIcon({ className: "", html: ICON_HTML, iconSize: [44, 44], iconAnchor: [22, 22] }),
            zIndexOffset: 1000,
            interactive: false,
        }).addTo(map);

        accuracyCircle = L.circle([lat, lng], {
            radius: 0,
            color: "#1d4ed8",
            weight: 1,
            fillColor: "#1d4ed8",
            fillOpacity: 0.1,
            interactive: false,
        }).addTo(map);
    } else {
        arrowMarker.setLatLng([lat, lng]);
        accuracyCircle.setLatLng([lat, lng]);
    }

    // Show the "how sure is GPS" circle only when it is reasonably small
    accuracyCircle.setRadius(accuracy && accuracy <= 150 ? accuracy : 0);
    updateArrowRotation();
}

// ---------- Tracking ----------

// Cleans one GPS reading, draws the arrow, and returns where the arrow was drawn
// (or null if the reading was ignored).
function handleReading(reading, snap, onPosition) {
    // 1) Ignore a very poor reading (but not forever: indoors they may all be poor)
    if (smoothed && reading.accuracy > MAX_USABLE_ACCURACY_M && skipped < MAX_SKIPPED_IN_A_ROW) {
        skipped++;
        return null;
    }
    skipped = 0;

    // 2) Smooth
    smoothed = smoothStep(smoothed, reading);

    // 3) Snap to the nearest path, if there is one close enough
    let shown = { lat: smoothed.lat, lng: smoothed.lng };
    let snapped = false;
    if (snap) {
        const onPath = snap(smoothed.lat, smoothed.lng, lastEdgeKey);
        if (onPath) {
            shown = { lat: onPath.lat, lng: onPath.lng };
            lastEdgeKey = onPath.key;
            snapped = true;
        } else {
            lastEdgeKey = null;
        }
    }

    placeArrow(shown.lat, shown.lng, reading.accuracy);
    if (follow) getMap().panTo([shown.lat, shown.lng]);

    if (onPosition) {
        onPosition({
            lat: shown.lat,
            lng: shown.lng,
            rawLat: reading.lat,
            rawLng: reading.lng,
            accuracy: reading.accuracy,
            heading: currentHeading(),
            snapped,
        });
    }
    return shown;
}

// initial   : the first position you already have, { lat, lng, accuracy }
// snap      : optional function (lat, lng, lastKey) that returns a point ON a path, or null
// onPosition: called on every new position with { lat, lng, accuracy, heading, snapped, ... }
// onError   : called when GPS fails
export function startTracking({ initial, snap, onPosition, onError } = {}) {
    if (watchId !== null) return;
    if (!navigator.geolocation) {
        if (onError) onError(new Error("Geolocation is not supported"));
        return;
    }

    const map = getMap();
    follow = true;
    smoothed = null;
    lastEdgeKey = null;
    skipped = 0;

    // If the user drags the map themselves, stop forcing it back to them
    map.on("dragstart", () => {
        follow = false;
    });

    if (initial) {
        const shown = handleReading(
            { lat: initial.lat, lng: initial.lng, accuracy: initial.accuracy },
            snap,
            onPosition
        );
        if (shown) map.setView([shown.lat, shown.lng], Math.max(map.getZoom(), 18));
    }

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude, accuracy, heading, speed } = position.coords;

            // GPS only knows the direction while we move. Keep the last good value.
            if (typeof heading === "number" && !Number.isNaN(heading) && speed > 0.5) {
                gpsHeading = heading;
            }

            handleReading({ lat: latitude, lng: longitude, accuracy }, snap, onPosition);
        },
        (error) => {
            if (onError) onError(error);
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );
}

export function isTracking() {
    return watchId !== null;
}

// Brings the map back to the user and makes it follow again
export function recenter() {
    follow = true;
    if (arrowMarker) getMap().panTo(arrowMarker.getLatLng());
}

export function stopTracking() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (arrowMarker) getMap().removeLayer(arrowMarker);
    if (accuracyCircle) getMap().removeLayer(accuracyCircle);
    arrowMarker = null;
    accuracyCircle = null;
    displayAngle = null;
    smoothed = null;
    lastEdgeKey = null;
}
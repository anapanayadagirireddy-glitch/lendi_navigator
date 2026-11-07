// tracker.js
// Live location tracking with an ARROW that shows where you are and which way you face.
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

let watchId = null;
let arrowMarker = null;
let accuracyCircle = null;
let follow = true; // is the map following the user?

let compassHeading = null; // degrees, 0 = north, from the compass (or null)
let gpsHeading = null; // degrees, from walking direction (last known value, or null)
let displayAngle = null; // the angle we actually draw (smoothed)
let compassStarted = false;

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

// initial   : the first position you already have, { lat, lng, accuracy }
// onPosition: called on every new position with { lat, lng, accuracy, heading }
// onError   : called when GPS fails
export function startTracking({ initial, onPosition, onError } = {}) {
    if (watchId !== null) return;
    if (!navigator.geolocation) {
        if (onError) onError(new Error("Geolocation is not supported"));
        return;
    }

    const map = getMap();
    follow = true;

    // If the user drags the map themselves, stop forcing it back to them
    map.on("dragstart", () => {
        follow = false;
    });

    if (initial) {
        placeArrow(initial.lat, initial.lng, initial.accuracy);
        map.setView([initial.lat, initial.lng], Math.max(map.getZoom(), 18));
    }

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude, accuracy, heading, speed } = position.coords;

            // GPS only knows the direction while we move. Keep the last good value.
            if (typeof heading === "number" && !Number.isNaN(heading) && speed > 0.5) {
                gpsHeading = heading;
            }

            placeArrow(latitude, longitude, accuracy);
            if (follow) map.panTo([latitude, longitude]);

            if (onPosition) {
                onPosition({ lat: latitude, lng: longitude, accuracy, heading: currentHeading() });
            }
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
}
// gps.js
// Asks the browser for the user's current position (the "Use my location" button).
// The browser will show a permission popup the first time. GPS only works on
// https:// pages, or on localhost / 127.0.0.1 (Live Server) while we are testing.

// Returns a Promise that gives { lat, lng, accuracy } (accuracy is in meters).
export function getCurrentPosition() {
  // TESTING TRICK: open the page like  http://127.0.0.1:5500/index.html?fakegps=18.0197,83.4010
  // and the button will pretend you are standing at that spot.
  const fake = new URLSearchParams(window.location.search).get("fakegps");
  if (fake) {
    const [lat, lng] = fake.split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return Promise.resolve({ lat, lng, accuracy: 5 });
    }
  }

  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This browser does not support GPS."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => reject(error),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

// Turns a GPS error into a short message a person can understand.
export function gpsErrorMessage(error) {
  if (error && error.code === 1) {
    return "Location permission was denied. Allow location for this site and try again.";
  }
  if (error && error.code === 2) {
    return "Your location is not available right now. Try again outside or near a window.";
  }
  if (error && error.code === 3) {
    return "Getting your location took too long. Please try again.";
  }
  return (error && error.message) || "Could not get your location.";
}
const GEO_ERRORS = {
  1: 'Location permission denied. Allow location access to punch.',
  2: 'Location unavailable right now. Make sure GPS/mobile data is on, then try again.',
  3: 'GPS took too long. Move to an open area and retry.',
};

/** Resolve a geolocation fix (high accuracy). Rejects with a friendly message
 * for permission-denied / unavailable / timeout — punch is blocked server-side
 * when the strict geofence is enabled, so we surface the reason before sending. */
export function getPosition({ timeoutMs = 12000, maximumAge = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const geo = navigator.geolocation;
    if (!geo) {
      reject(new Error('Geolocation is not supported on this device'));
      return;
    }
    geo.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          measuredAt: pos.timestamp,
        }),
      (err) => reject(new Error(GEO_ERRORS[err.code] || 'Could not determine your location')),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge },
    );
  });
}
import { AppError } from './errors.js';

const EARTH_RADIUS_M = 6371000;

const deg2rad = (d) => (d * Math.PI) / 180;

/** Haversine great-circle distance in meters. */
export function haversineM(lat1, lng1, lat2, lng2) {
  const dLat = deg2rad(lat2 - lat1);
  const dLng = deg2rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Plausibility checks for a geolocation fix. Browsers do NOT expose the
 * Android mock-location flag (`Location.isFromMockProvider` is Android-only),
 * so the practical mock guards are: finite/in-range coordinates, accuracy must
 * be > 0 (spoofers often report 0 or NaN), and accuracy below the configured
 * cap. A separate IP-cross-check could tighten this on-prem, but introduces a
 * geo-IP dependency — radius + accuracy are the shipped guard.
 */
export function validateGeoPoint(geo, maxAccuracyM) {
  if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng) || !Number.isFinite(geo.accuracy)) {
    throw new AppError('Invalid geolocation coordinates', 400, 'LOCATION_INVALID');
  }
  if (geo.lat < -90 || geo.lat > 90 || geo.lng < -180 || geo.lng > 180) {
    throw new AppError('Invalid geolocation coordinates', 400, 'LOCATION_INVALID');
  }
  if (geo.accuracy <= 0 || !Number.isFinite(geo.accuracy)) {
    throw new AppError('Location accuracy is invalid', 400, 'LOCATION_INACCURATE');
  }
  if (maxAccuracyM != null && geo.accuracy > maxAccuracyM) {
    throw new AppError(
      `Location accuracy is too low (${Math.round(geo.accuracy)}m, limit ${Math.round(maxAccuracyM)}m)`,
      400,
      'LOCATION_INACCURATE',
    );
  }
}

/**
 * Enforce a strict punch geofence: valid fix, accuracy cap, then within-radius.
 * When the office anchor is unconfigured (officeLat/officeLng null) only the
 * plausibility checks apply — the geofence is effectively disabled until the
 * LGU provides coordinates (set via OFFICE_LAT/OFFICE_LNG and reseed).
 */
export function assertWithinGeofence(geo, rule) {
  validateGeoPoint(geo, rule.maxAccuracyM);
  if (rule.officeLat == null || rule.officeLng == null) return;
  const radius = rule.geofenceRadiusM ?? 200;
  let distanceM;
  try {
    distanceM = haversineM(geo.lat, geo.lng, rule.officeLat, rule.officeLng);
  } catch {
    throw new AppError('Invalid geolocation coordinates', 400, 'LOCATION_INVALID');
  }
  if (distanceM > radius) {
    throw new AppError(
      `You are outside the office geofence (${Math.round(distanceM)}m away, limit ${Math.round(radius)}m)`,
      403,
      'OUTSIDE_GEOFENCE',
    );
  }
}
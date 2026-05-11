import axios from 'axios';
import { ENV } from '../config/env.js';
import { cache, cacheKey } from '../utils/cache.js';

const ROUTES_BASE = ENV.GOOGLE_ROUTES_BASE;
const KEY = ENV.GOOGLE_MAPS_KEY;

// SafarMate mode → Google Routes API travelMode
const MODE_MAP = {
  driving:    'DRIVE',
  motorcycle: 'TWO_WHEELER',
  cycling:    'BICYCLE',
  walking:    'WALK',
};

const ALLOWED_AVOID = new Set(['highways', 'tollways', 'ferries']);

const polylineToGeoJson = (encoded) => {
  // Google's encoded polyline → GeoJSON LineString coordinates [[lng,lat], ...]
  if (!encoded) return { type: 'LineString', coordinates: [] };
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let result = 0, shift = 0, b;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;
    result = 0; shift = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return { type: 'LineString', coordinates: coords };
};

export const getRoute = async ({
  coordinates,
  mode = 'driving',
  alternatives = true,
  avoidFeatures = [],
}) => {
  if (!coordinates || coordinates.length < 2)
    throw new Error('At least 2 coordinates required');
  if (!KEY) {
    const e = new Error('GOOGLE_MAPS_KEY not configured. Add it to backend/.env and restart.');
    e.statusCode = 500;
    throw e;
  }

  const travelMode = MODE_MAP[mode] || MODE_MAP.driving;
  const cleanAvoid = (avoidFeatures || []).filter((f) => ALLOWED_AVOID.has(f));

  const pathKey = coordinates.map((c) => c.join(',')).join('|');
  const key = cacheKey(
    'g-route',
    travelMode,
    pathKey,
    alternatives,
    cleanAvoid.join(',')
  );
  const hit = cache.get(key);
  if (hit) return hit;

  // Build request
  const [oLng, oLat] = coordinates[0];
  const [dLng, dLat] = coordinates[coordinates.length - 1];
  const intermediates = coordinates
    .slice(1, -1)
    .map(([lng, lat]) => ({ location: { latLng: { latitude: lat, longitude: lng } } }));

  const body = {
    origin: { location: { latLng: { latitude: oLat, longitude: oLng } } },
    destination: { location: { latLng: { latitude: dLat, longitude: dLng } } },
    intermediates,
    travelMode,
    routingPreference:
      travelMode === 'DRIVE' || travelMode === 'TWO_WHEELER'
        ? 'TRAFFIC_AWARE'
        : undefined,
    computeAlternativeRoutes:
      alternatives && intermediates.length === 0,
    languageCode: 'en',
    units: 'METRIC',
  };

  // Avoid options
  if (cleanAvoid.length > 0) {
    body.routeModifiers = {
      avoidHighways: cleanAvoid.includes('highways'),
      avoidTolls: cleanAvoid.includes('tollways'),
      avoidFerries: cleanAvoid.includes('ferries'),
    };
  }

  console.log(
    `🛣️  route: ${mode} (${travelMode}), ${coordinates.length} pts, avoid=[${cleanAvoid.join(',')}]`
  );

  try {
    const { data } = await axios.post(
      `${ROUTES_BASE}/directions/v2:computeRoutes`,
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': KEY,
          'X-Goog-FieldMask':
            'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.startLocation,routes.warnings',
        },
        timeout: 20000,
      }
    );

    const rawRoutes = data.routes || [];
    if (rawRoutes.length === 0) return [];

    const routes = rawRoutes.map((r, i) => {
      const steps = (r.legs || []).flatMap((leg) =>
        (leg.steps || []).map((s) => ({
          instruction: s.navigationInstruction?.instructions || '',
          name: '',
          distance: s.distanceMeters || 0,
          duration: parseDurationToSec(s.staticDuration),
          location: s.startLocation?.latLng
            ? [s.startLocation.latLng.longitude, s.startLocation.latLng.latitude]
            : null,
        }))
      );

      return {
        id: i,
        mode,
        distance: r.distanceMeters || 0,
        duration: parseDurationToSec(r.duration),
        geometry: polylineToGeoJson(r.polyline?.encodedPolyline),
        steps,
        avoid: cleanAvoid,
      };
    });

    cache.set(key, routes, 180);
    return routes;
  } catch (err) {
    const status = err.response?.status;
    const detail =
      err.response?.data?.error?.message ||
      JSON.stringify(err.response?.data) ||
      err.message;
    console.error('Google Routes error:', status, detail);
    const e = new Error(`Routing failed (${status || 'network'}): ${detail}`);
    e.statusCode = status === 401 || status === 403 ? status : 502;
    throw e;
  }
};

const parseDurationToSec = (d) => {
  // Google returns durations like "1234s"
  if (!d) return 0;
  if (typeof d === 'number') return d;
  return parseInt(String(d).replace('s', ''), 10) || 0;
};
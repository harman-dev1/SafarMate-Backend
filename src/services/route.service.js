import axios from 'axios';
import { ENV } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const ROUTES_API = 'https://routes.googleapis.com/directions/v2:computeRoutes';

const MODE_MAP = {
  driving:    'DRIVE',
  motorcycle: 'TWO_WHEELER',
  cycling:    'BICYCLE',
  walking:    'WALK',
};

// Only DRIVE and TWO_WHEELER support traffic-aware data
const supportsTraffic = (mode) => mode === 'DRIVE' || mode === 'TWO_WHEELER';

const parseDuration = (d) => {
  if (!d) return 0;
  if (typeof d === 'number') return d;
  const m = String(d).match(/^(\d+(?:\.\d+)?)s$/);
  return m ? parseFloat(m[1]) : 0;
};

// ── Inline Google-encoded polyline decoder (zero deps) ──
// Returns [[lat, lng], [lat, lng], ...]
const decodePolyline = (encoded) => {
  if (!encoded || typeof encoded !== 'string') return [];
  const coords = [];
  const len = encoded.length;
  let index = 0, lat = 0, lng = 0;

  while (index < len) {
    let b, shift = 0, result = 0;
    do {
      if (index >= len) return coords;
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;

    shift = 0; result = 0;
    do {
      if (index >= len) return coords;
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;

    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
};

// ── Main route function ──
// Accepts either named or positional shapes from any caller:
//   getRoute({ coordinates, mode, alternatives, avoidFeatures })
//   getRoute({ waypoints, transportMode, ... })  ← also tolerated
export const getRoute = async (input = {}) => {
  // Tolerant input parsing — works with whatever your controller passes
  const coordinates =
    input.coordinates ||
    input.waypoints ||
    [];
  const mode = input.mode || input.transportMode || input.travelMode || 'driving';
  const alternatives = input.alternatives !== undefined ? input.alternatives : true;
  const avoidFeatures = input.avoidFeatures || input.avoid || [];

  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new ApiError(400, 'At least origin and destination are required');
  }

  const googleMode = MODE_MAP[mode] || 'DRIVE';
  const trafficSupported = supportsTraffic(googleMode);

  const origin = {
    location: { latLng: { latitude: coordinates[0][1], longitude: coordinates[0][0] } },
  };
  const destination = {
    location: {
      latLng: {
        latitude:  coordinates[coordinates.length - 1][1],
        longitude: coordinates[coordinates.length - 1][0],
      },
    },
  };
  const intermediates = coordinates.slice(1, -1).map(([lng, lat]) => ({
    location: { latLng: { latitude: lat, longitude: lng } },
  }));

  const body = {
    origin,
    destination,
    intermediates,
    travelMode: googleMode,
    computeAlternativeRoutes: alternatives && intermediates.length === 0,
    polylineQuality: 'HIGH_QUALITY',
    polylineEncoding: 'ENCODED_POLYLINE',
    routeModifiers: {
      avoidHighways: avoidFeatures.includes('highways'),
      avoidTolls:    avoidFeatures.includes('tolls'),
      avoidFerries:  avoidFeatures.includes('ferries'),
    },
  };

  // ── Traffic-aware routing + per-segment traffic intervals ──
  if (trafficSupported) {
    body.routingPreference = 'TRAFFIC_AWARE';
    body.extraComputations  = ['TRAFFIC_ON_POLYLINE'];
  }

  const fieldMask = [
    'routes.duration',
    'routes.distanceMeters',
    'routes.polyline.encodedPolyline',
    'routes.legs.steps.navigationInstruction',
    'routes.legs.steps.distanceMeters',
    'routes.legs.steps.startLocation',
    'routes.legs.steps.endLocation',
    'routes.legs.steps.polyline.encodedPolyline',
    'routes.travelAdvisory.speedReadingIntervals',
  ].join(',');

  let res;
  try {
    res = await axios.post(ROUTES_API, body, {
      headers: {
        'Content-Type':     'application/json',
        'X-Goog-Api-Key':   ENV.GOOGLE_MAPS_KEY,
        'X-Goog-FieldMask': fieldMask,
      },
      timeout: 15000,
    });
  } catch (err) {
    const upstream = err.response?.data || err.message;
    console.error('Routes API error:', JSON.stringify(upstream).slice(0, 500));
    throw new ApiError(err.response?.status || 502, 'Failed to compute routes', upstream);
  }

  const routes = res.data?.routes;
  if (!routes?.length) return [];

  return routes.map((r) => {
    const encoded = r.polyline?.encodedPolyline;
    const decoded = decodePolyline(encoded);
    const geometry = {
      type: 'LineString',
      coordinates: decoded.map(([lat, lng]) => [lng, lat]),
    };

    const steps = (r.legs || []).flatMap((leg) =>
      (leg.steps || []).map((step) => ({
        instruction: step.navigationInstruction?.instructions || '',
        maneuver:    step.navigationInstruction?.maneuver     || '',
        distance:    step.distanceMeters || 0,
        location: step.startLocation?.latLng
          ? [step.startLocation.latLng.longitude, step.startLocation.latLng.latitude]
          : null,
      }))
    );

    const speedReadingIntervals = (r.travelAdvisory?.speedReadingIntervals || []).map((iv) => ({
      startPolylinePointIndex: iv.startPolylinePointIndex ?? 0,
      endPolylinePointIndex:   iv.endPolylinePointIndex   ?? 0,
      speed: iv.speed || 'SPEED_UNSPECIFIED',
    }));

    return {
      distance: r.distanceMeters || 0,
      duration: parseDuration(r.duration),
      geometry,
      steps,
      speedReadingIntervals,
    };
  });
};

// ── Backwards-compatible alias ──
// Whatever name anything in your codebase imports — both work.
export const computeRoute = getRoute;
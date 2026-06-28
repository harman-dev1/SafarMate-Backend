import RoadSegment from '../models/RoadSegment.model.js';
import Incident from '../models/Incident.model.js';

// ────────── Geometry helpers (same approach as incident.service.js / weather.service.js) ──────────
const EARTH_R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
const distMeters = (a, b) => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

// Samples a route polyline every `intervalMeters`, same spacing approach
// used by weather.service.js's samplePolyline, so the safety layer and the
// weather layer divide the route up the same way.
const sampleRoute = (coords, intervalMeters = 500) => {
  if (!coords || coords.length < 2) return [];
  const samples = [{ lat: coords[0][1], lng: coords[0][0], distFromStart: 0 }];
  let cumDist = 0;
  let nextSampleAt = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const a = { lat: coords[i][1], lng: coords[i][0] };
    const b = { lat: coords[i + 1][1], lng: coords[i + 1][0] };
    const segLen = distMeters(a, b);
    while (nextSampleAt + intervalMeters < cumDist + segLen) {
      nextSampleAt += intervalMeters;
      const t = (nextSampleAt - cumDist) / segLen;
      samples.push({
        lat: a.lat + t * (b.lat - a.lat),
        lng: a.lng + t * (b.lng - a.lng),
        distFromStart: nextSampleAt,
      });
    }
    cumDist += segLen;
  }
  const last = coords[coords.length - 1];
  samples.push({ lat: last[1], lng: last[0], distFromStart: cumDist });
  return samples;
};

const bandOf = (score) => {
  if (score >= 75) return 'safe';
  if (score >= 50) return 'moderate';
  if (score >= 30) return 'risky';
  return 'dangerous';
};

const SEVERITY_WEIGHT = { low: 1, medium: 2, high: 3 };
const LIVE_ADJUST_RADIUS_M = 250; // how far an active incident reaches to affect a segment's score
const MAX_LIVE_PENALTY = 20;       // cap so a single/few incidents can't zero out the baseline score

/**
 * Looks at currently-active incidents near a segment's midpoint and
 * subtracts a small, capped penalty from the offline-trained baseline
 * score. This is a deliberately simple, rule-based adjustment layer —
 * NOT a retrained model — so the score reacts to live community reports
 * without needing a live ML service. The baseline (from
 * train_safety_model.py) still does the heavy lifting from road-quality
 * and historical-accident signals.
 */
const applyLiveAdjustment = async (segment) => {
  const [lng, lat] = segment.midpoint.coordinates;
  const nearbyActive = await Incident.find({
    status: 'active',
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [lng, lat] },
        $maxDistance: LIVE_ADJUST_RADIUS_M,
      },
    },
  })
    .select('severity type')
    .limit(20)
    .lean();

  const penalty = Math.min(
    MAX_LIVE_PENALTY,
    nearbyActive.reduce((sum, inc) => sum + (SEVERITY_WEIGHT[inc.severity] || 1) * 2, 0)
  );

  const liveScore = Math.max(0, Math.min(100, segment.safetyScore - penalty));

  return {
    segmentId: segment.segmentId,
    roadName: segment.roadName,
    zoneType: segment.zoneType,
    geometry: segment.geometry,
    midpoint: segment.midpoint,
    baseScore: segment.safetyScore,
    baseBand: segment.safetyBand,
    liveScore: Math.round(liveScore * 10) / 10,
    liveBand: bandOf(liveScore),
    activeNearbyIncidents: nearbyActive.length,
    factors: segment.factors,
    lastScored: segment.lastScored,
  };
};

// ────────── GET segments within a map bounding box ──────────
export const getSegmentsInBbox = async ({ minLng, minLat, maxLng, maxLat }) => {
  const segments = await RoadSegment.find({
    midpoint: {
      $geoWithin: { $box: [[minLng, minLat], [maxLng, maxLat]] },
    },
  })
    .limit(800)
    .lean();

  return Promise.all(segments.map(applyLiveAdjustment));
};

// ────────── POST segments near a route polyline ──────────
export const getSafetyAlongRoute = async ({ coordinates, bufferMeters = 400 }) => {
  const samples = sampleRoute(coordinates, 500);

  const seen = new Map();
  for (const s of samples) {
    const nearest = await RoadSegment.findOne({
      midpoint: {
        $near: {
          $geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
          $maxDistance: bufferMeters,
        },
      },
    }).lean();
    if (nearest && !seen.has(nearest.segmentId)) {
      seen.set(nearest.segmentId, { ...nearest, distFromStart: s.distFromStart });
    }
  }

  const matched = Array.from(seen.values()).sort((a, b) => a.distFromStart - b.distFromStart);
  const adjusted = await Promise.all(matched.map(applyLiveAdjustment));

  const withDist = adjusted.map((seg, i) => ({ ...seg, distFromStart: matched[i].distFromStart }));

  const scores = withDist.map((s) => s.liveScore);
  const summary = scores.length
    ? {
        segmentCount: scores.length,
        averageScore: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
        worstScore: Math.min(...scores),
        worstBand: bandOf(Math.min(...scores)),
        riskySegmentCount: withDist.filter((s) => s.liveBand === 'risky' || s.liveBand === 'dangerous').length,
      }
    : { segmentCount: 0, averageScore: null, worstScore: null, worstBand: null, riskySegmentCount: 0 };

  return { samples: withDist, summary };
};

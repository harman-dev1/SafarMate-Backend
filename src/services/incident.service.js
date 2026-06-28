import Incident, { TTL_BY_TYPE, DENIAL_THRESHOLD_BY_SEVERITY, INCIDENT_TYPES } from '../models/Incident.model.js';
import User from '../models/User.model.js';
import ApiError from '../utils/ApiError.js';
import IncidentArchive from '../models/IncidentArchive.model.js';


// Never let an archive-logging failure break the actual incident flow.
const archiveReport = async (incident) => {
try {
await IncidentArchive.create({
sourceIncidentId: incident._id,
type: incident.type,
severity: incident.severity,
location: incident.location,
reporter: incident.reporter,
reporterTrustAtReport: incident.reporterTrustAtReport,
createdAt: incident.createdAt,
});
} catch (err) {
console.error('IncidentArchive write failed (non-fatal):', err.message);
}
};

// ──────────── Geometry helpers ────────────
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

// ──────────── Rate limit checks ────────────
const checkRateLimits = async (userId, lat, lng) => {
  const now = Date.now();
  const oneHourAgo = new Date(now - 3600_000);
  const oneDayAgo  = new Date(now - 86400_000);
  const thirtyMinAgo = new Date(now - 1800_000);

  const lastHourCount = await Incident.countDocuments({ reporter: userId, createdAt: { $gte: oneHourAgo } });
  if (lastHourCount >= 5) {
    throw new ApiError(429, 'You have reached the 5-reports-per-hour limit. Try again later.');
  }

  const lastDayCount = await Incident.countDocuments({ reporter: userId, createdAt: { $gte: oneDayAgo } });
  if (lastDayCount >= 20) {
    throw new ApiError(429, 'You have reached the 20-reports-per-day limit.');
  }

  // No duplicate within 200m + 30 minutes (any reporter)
  const nearby = await Incident.findOne({
    status: 'active',
    createdAt: { $gte: thirtyMinAgo },
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [lng, lat] },
        $maxDistance: 200,
      },
    },
  });
  if (nearby) {
    throw new ApiError(409, 'An incident was already reported here in the last 30 minutes.');
  }
};

// ──────────── Compute expiresAt with trust bonus ────────────
const computeExpiry = (type, reporterTrust) => {
  let ttl = TTL_BY_TYPE[type];
  if (reporterTrust >= 80) ttl *= 2; // high-trust users get 2x lifetime
  return new Date(Date.now() + ttl * 1000);
};

// ──────────── CREATE INCIDENT ────────────
export const createIncident = async ({ userId, userLat, userLng, type, lat, lng, severity, note, imageUrl }) => {
  if (!INCIDENT_TYPES.includes(type)) {
    throw new ApiError(400, `Invalid incident type. Must be one of: ${INCIDENT_TYPES.join(', ')}`);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ApiError(400, 'Invalid location coordinates.');
  }

  // LAYER 1: Geo-fencing — reporter must be within 200m of incident
  if (Number.isFinite(userLat) && Number.isFinite(userLng)) {
    const distance = distMeters({ lat: userLat, lng: userLng }, { lat, lng });
    if (distance > 200) {
      throw new ApiError(403, `You must be within 200m of the incident location (you are ~${Math.round(distance)}m away).`);
    }
  } else {
    throw new ApiError(400, 'Your current location is required to verify presence.');
  }

  // LAYER 2: Rate limits
  await checkRateLimits(userId, lat, lng);

  // LAYER 4: Fetch reporter trust
  const user = await User.findById(userId).select('trustScore').lean();
  const trust = user?.trustScore ?? 50;

  // Low-trust users (<10) get rejected silently to admin queue (not shown publicly)
  if (trust < 10) {
    // Persist for audit but flagged
    const flagged = await Incident.create({
type, severity: severity || 'medium', note: note || '', imageUrl: imageUrl || null,
location: { type: 'Point', coordinates: [lng, lat] },
reporter: userId, reporterTrustAtReport: trust,
status: 'removed_by_community', // hidden
expiresAt: new Date(Date.now() + 3600_000),
});
await archiveReport(flagged);
return { flagged: true, incident: flagged };
  }

  const incident = await Incident.create({
type,
severity: severity || 'medium',
note: note || '',
imageUrl: imageUrl || null,
location: { type: 'Point', coordinates: [lng, lat] },
reporter: userId,
reporterTrustAtReport: trust,
expiresAt: computeExpiry(type, trust),
});
await archiveReport(incident);
return { flagged: false, incident };
};

// ──────────── LIST INCIDENTS in bounding box ────────────
export const listIncidentsInBbox = async ({ minLng, minLat, maxLng, maxLat }) => {
  if (
    !Number.isFinite(minLng) || !Number.isFinite(minLat) ||
    !Number.isFinite(maxLng) || !Number.isFinite(maxLat)
  ) {
    throw new ApiError(400, 'Invalid bbox parameters.');
  }
  return Incident.find({
    status: 'active',
    location: {
      $geoWithin: {
        $box: [[minLng, minLat], [maxLng, maxLat]],
      },
    },
  })
    .populate('reporter', 'displayName')
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
};

// ──────────── LIST INCIDENTS near a route polyline ────────────
export const listIncidentsNearRoute = async ({ coordinates, bufferMeters = 500 }) => {
  // Build a bounding box around the polyline + buffer
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coordinates) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  // Expand bbox by ~bufferMeters (rough degree conversion)
  const degBuf = bufferMeters / 111000;
  return Incident.find({
    status: 'active',
    location: {
      $geoWithin: {
        $box: [[minLng - degBuf, minLat - degBuf], [maxLng + degBuf, maxLat + degBuf]],
      },
    },
  })
    .populate('reporter', 'displayName')
    .lean();
};

// ──────────── VERIFY (confirm or deny) ────────────
export const verifyIncident = async ({ userId, userLat, userLng, incidentId, action }) => {
  if (!['confirm', 'deny'].includes(action)) {
    throw new ApiError(400, 'action must be "confirm" or "deny"');
  }

  const incident = await Incident.findById(incidentId);
  if (!incident || incident.status !== 'active') {
    throw new ApiError(404, 'Incident not found or no longer active.');
  }

  // Self-verification is not allowed
  if (String(incident.reporter) === String(userId)) {
    throw new ApiError(403, 'You cannot verify your own report.');
  }

  // Already voted?
  if (incident.confirmedBy.some((id) => String(id) === String(userId))) {
    throw new ApiError(409, 'You already confirmed this report.');
  }
  if (incident.deniedBy.some((id) => String(id) === String(userId))) {
    throw new ApiError(409, 'You already denied this report.');
  }

  // LAYER 1 (for verification): must be within 100m of incident
  if (Number.isFinite(userLat) && Number.isFinite(userLng)) {
    const [lng, lat] = incident.location.coordinates;
    const distance = distMeters({ lat: userLat, lng: userLng }, { lat, lng });
    if (distance > 150) {
      throw new ApiError(403, `You must be within 150m to verify this incident (you are ~${Math.round(distance)}m away).`);
    }
  }

  // LAYER 4: trust-weighted vote
  const voter = await User.findById(userId).select('trustScore').lean();
  const voterTrust = voter?.trustScore ?? 50;
  const weight = Math.max(0, Math.min(2, voterTrust / 50));

  if (action === 'confirm') {
    incident.confirmations += weight;
    incident.confirmedBy.push(userId);
    // Extend lifetime by +6h, capped at +72h beyond creation
    const maxExpiry = new Date(incident.createdAt.getTime() + 72 * 3600_000);
    const extended = new Date(incident.expiresAt.getTime() + 6 * 3600_000);
    incident.expiresAt = extended < maxExpiry ? extended : maxExpiry;

    // Reward reporter trust
    await User.updateOne(
      { _id: incident.reporter },
      { $inc: { trustScore: 5 } }
    );
  } else {
    incident.denials += weight;
    incident.deniedBy.push(userId);

    const threshold = DENIAL_THRESHOLD_BY_SEVERITY[incident.severity] || 3;
    if (incident.denials >= threshold) {
      incident.status = 'removed_by_community';
      // Penalize reporter trust
      await User.updateOne(
        { _id: incident.reporter },
        { $inc: { trustScore: -10 } }
      );
    }
  }

  await incident.save();
try {
await IncidentArchive.updateOne(
{ sourceIncidentId: incident._id },
{
$set: {
finalConfirmations: incident.confirmations,
finalDenials: incident.denials,
...(incident.status === 'removed_by_community'
? { finalStatus: 'removed_by_community', resolvedAt: new Date() }
: {}),
},
}
);
} catch (err) {
console.error('IncidentArchive update failed (non-fatal):', err.message);
}
return incident;
};

// ──────────── REMOVE BY REPORTER ────────────
export const removeIncidentByReporter = async ({ userId, incidentId }) => {
  const incident = await Incident.findById(incidentId);
  if (!incident) throw new ApiError(404, 'Incident not found.');
  if (String(incident.reporter) !== String(userId)) {
    throw new ApiError(403, 'Only the original reporter can remove this incident.');
  }
  if (incident.status !== 'active') {
    throw new ApiError(400, 'Incident is no longer active.');
  }
  incident.status = 'removed_by_reporter';
incident.expiresAt = new Date(); // makes TTL purge it within 60s
await incident.save();
try {
await IncidentArchive.updateOne(
{ sourceIncidentId: incident._id },
{ $set: { finalStatus: 'removed_by_reporter', resolvedAt: new Date() } }
);
} catch (err) {
console.error('IncidentArchive update failed (non-fatal):', err.message);
}
return incident;

};
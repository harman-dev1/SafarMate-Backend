import {
  createIncident,
  listIncidentsInBbox,
  listIncidentsNearRoute,
  verifyIncident,
  removeIncidentByReporter,
} from '../services/incident.service.js';
import ApiResponse from '../utils/ApiResponse.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { broadcastIncident, broadcastIncidentUpdate, broadcastIncidentRemoved } from '../sockets/index.js';

export const reportIncident = asyncHandler(async (req, res) => {
  const { type, lat, lng, severity, note, imageUrl, userLat, userLng } = req.body;

  const result = await createIncident({
    userId: req.user._id,
    userLat: Number(userLat),
    userLng: Number(userLng),
    type,
    lat: Number(lat),
    lng: Number(lng),
    severity,
    note,
    imageUrl,
  });

  if (!result.flagged) {
    // Broadcast to nearby users in real-time
    const incidentToSend = result.incident.toObject();
    incidentToSend.reporter = { _id: req.user._id, displayName: req.user.displayName };
    broadcastIncident(incidentToSend);
  }

  res.status(201).json(new ApiResponse(201, result.incident));
});

export const getIncidentsInBbox = asyncHandler(async (req, res) => {
  const { minLng, minLat, maxLng, maxLat } = req.query;
  const incidents = await listIncidentsInBbox({
    minLng: Number(minLng), minLat: Number(minLat),
    maxLng: Number(maxLng), maxLat: Number(maxLat),
  });
  res.json(new ApiResponse(200, incidents));
});

export const getIncidentsNearRoute = asyncHandler(async (req, res) => {
  const { coordinates, bufferMeters } = req.body;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new ApiError(400, 'coordinates (LineString) required.');
  }
  const incidents = await listIncidentsNearRoute({
    coordinates,
    bufferMeters: Number(bufferMeters) || 500,
  });
  res.json(new ApiResponse(200, incidents));
});

export const verifyIncidentCtrl = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { action, userLat, userLng } = req.body;
  const updated = await verifyIncident({
    userId: req.user._id,
    userLat: Number(userLat),
    userLng: Number(userLng),
    incidentId: id,
    action,
  });

  if (updated.status === 'active') {
    broadcastIncidentUpdate(updated.toObject());
  } else {
    broadcastIncidentRemoved(String(updated._id));
  }

  res.json(new ApiResponse(200, updated));
});

export const removeIncidentCtrl = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updated = await removeIncidentByReporter({
    userId: req.user._id,
    incidentId: id,
  });
  broadcastIncidentRemoved(String(updated._id));
  res.json(new ApiResponse(200, { removed: true }));
});
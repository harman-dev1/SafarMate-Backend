import { getSegmentsInBbox, getSafetyAlongRoute } from '../services/safetyScore.service.js';
import ApiResponse from '../utils/ApiResponse.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// GET /api/safety/segments?minLng=&minLat=&maxLng=&maxLat=
export const getSafetySegmentsInBbox = asyncHandler(async (req, res) => {
  const { minLng, minLat, maxLng, maxLat } = req.query;
  if ([minLng, minLat, maxLng, maxLat].some((v) => v === undefined || Number.isNaN(Number(v)))) {
    throw new ApiError(400, 'minLng, minLat, maxLng, maxLat are required.');
  }

  const segments = await getSegmentsInBbox({
    minLng: Number(minLng), minLat: Number(minLat),
    maxLng: Number(maxLng), maxLat: Number(maxLat),
  });

  res.json(new ApiResponse(200, segments));
});

// POST /api/safety/along-route   body: { coordinates }
export const safetyAlongRoute = asyncHandler(async (req, res) => {
  const { coordinates, bufferMeters } = req.body;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new ApiError(400, 'coordinates (LineString) required.');
  }

  const result = await getSafetyAlongRoute({
    coordinates,
    bufferMeters: Number(bufferMeters) || 400,
  });

  res.json(new ApiResponse(200, result));
});

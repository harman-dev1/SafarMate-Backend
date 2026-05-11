import { findNearby } from '../services/nearby.service.js';
import ApiResponse from '../utils/ApiResponse.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getNearby = asyncHandler(async (req, res) => {
  const { lat, lng, category = 'hospital', radius = 5000 } = req.query;
  if (!lat || !lng) throw new ApiError(400, 'lat & lng required');

  const r = Math.min(Math.max(+radius || 5000, 500), 15000); // clamp 0.5–15 km
  const places = await findNearby({
    lat: +lat,
    lng: +lng,
    category,
    radius: r,
  });
  res.json(new ApiResponse(200, places));
});
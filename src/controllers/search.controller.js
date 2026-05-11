import { searchPlaces, reverseGeocode } from '../services/search.service.js';
import ApiResponse from '../utils/ApiResponse.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const autocomplete = asyncHandler(async (req, res) => {
  const { q, lat, lng, limit } = req.query;
  if (!q || q.length < 2) return res.json(new ApiResponse(200, []));
  const results = await searchPlaces(q, { lat, lng, limit: +limit || 8 });
  res.json(new ApiResponse(200, results));
});

export const reverse = asyncHandler(async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) throw new ApiError(400, 'lat & lng required');
  const place = await reverseGeocode(+lat, +lng);
  res.json(new ApiResponse(200, place));
});
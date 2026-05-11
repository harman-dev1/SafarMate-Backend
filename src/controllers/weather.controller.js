import { getWeatherAlongRoute } from '../services/weather.service.js';
import ApiResponse from '../utils/ApiResponse.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const weatherAlongRoute = asyncHandler(async (req, res) => {
  const {
    coordinates,
    totalDistance,
    totalDuration,
    departAt,
  } = req.body;

  if (!Array.isArray(coordinates) || coordinates.length < 2)
    throw new ApiError(400, 'coordinates required (LineString)');
  if (!totalDistance || !totalDuration)
    throw new ApiError(400, 'totalDistance and totalDuration required');

  const startMs = departAt ? new Date(departAt).getTime() : Date.now();

  const result = await getWeatherAlongRoute({
    coordinates,
    totalDistance,
    totalDuration,
    startMs,
  });

  res.json(new ApiResponse(200, result));
});
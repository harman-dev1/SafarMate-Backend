import { getRoute } from '../services/route.service.js';
import RouteHistory from '../models/RouteHistory.model.js';
import ApiResponse from '../utils/ApiResponse.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const computeRoute = asyncHandler(async (req, res) => {
  const {
    coordinates,
    mode = 'driving',
    alternatives = true,
    avoidFeatures = [],
    avoidPolygons = null,
  } = req.body;

  if (!Array.isArray(coordinates) || coordinates.length < 2)
    throw new ApiError(400, 'Provide at least 2 [lng,lat] coordinates');

  const routes = await getRoute({
    coordinates,
    mode,
    alternatives,
    avoidFeatures,
    avoidPolygons,
  });

  if (req.user && routes[0]) {
    RouteHistory.create({
      user: req.user._id,
      origin: { coordinates: coordinates[0] },
      destination: { coordinates: coordinates[coordinates.length - 1] },
      waypoints: coordinates.slice(1, -1).map((c) => ({ coordinates: c })),
      distance: routes[0].distance,
      duration: routes[0].duration,
      transportMode: mode,
    }).catch(() => {});
  }

  res.json(new ApiResponse(200, routes));
});
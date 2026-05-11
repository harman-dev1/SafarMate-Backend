import User from '../models/User.model.js';
import ApiResponse from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const updateMe = asyncHandler(async (req, res) => {
  const allowed = ['displayName', 'preferences', 'currentLocation'];
  const update = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );
  const user = await User.findByIdAndUpdate(req.user._id, update, { new: true });
  res.json(new ApiResponse(200, user, 'Profile updated'));
});

export const addSavedPlace = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $push: { savedPlaces: req.body } },
    { new: true }
  );
  res.json(new ApiResponse(200, user.savedPlaces));
});

export const removeSavedPlace = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $pull: { savedPlaces: { _id: req.params.id } } },
    { new: true }
  );
  res.json(new ApiResponse(200, user.savedPlaces));
});
import jwt from 'jsonwebtoken';
import admin from '../config/firebase.js';
import User from '../models/User.model.js';
import ApiError from '../utils/ApiError.js';
import ApiResponse from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ENV } from '../config/env.js';

const signJwt = (id) => jwt.sign({ id }, ENV.JWT_SECRET, { expiresIn: ENV.JWT_EXPIRES_IN });

export const googleSignIn = asyncHandler(async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) throw new ApiError(400, 'idToken is required');

  const decoded = await admin.auth().verifyIdToken(idToken);
  const { uid, email, name, picture } = decoded;

  let user = await User.findOne({ googleId: uid });
  if (!user) {
    user = await User.create({
      googleId: uid,
      email,
      displayName: name || email.split('@')[0],
      profilePicture: picture || '',
    });
  } else {
    user.displayName = name || user.displayName;
    user.profilePicture = picture || user.profilePicture;
    await user.save();
  }

  const token = signJwt(user._id);
  res.json(new ApiResponse(200, { user, token }, 'Login successful'));
});

export const me = asyncHandler(async (req, res) => {
  res.json(new ApiResponse(200, req.user));
});

export const logout = asyncHandler(async (_req, res) => {
  res.json(new ApiResponse(200, null, 'Logged out'));
});
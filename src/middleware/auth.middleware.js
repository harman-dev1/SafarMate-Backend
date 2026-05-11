import jwt from 'jsonwebtoken';
import admin from '../config/firebase.js';
import User from '../models/User.model.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ENV } from '../config/env.js';

export const verifyJwt = asyncHandler(async (req, _res, next) => {
  const token =
    req.cookies?.accessToken ||
    req.headers.authorization?.replace('Bearer ', '');

  if (!token) throw new ApiError(401, 'Unauthorized: token missing');

  const decoded = jwt.verify(token, ENV.JWT_SECRET);
  const user = await User.findById(decoded.id).select('-__v');
  if (!user) throw new ApiError(401, 'User no longer exists');

  req.user = user;
  next();
});

export const verifyFirebaseToken = asyncHandler(async (req, _res, next) => {
  const idToken = req.headers.authorization?.replace('Bearer ', '');
  if (!idToken) throw new ApiError(401, 'Firebase ID token missing');
  req.firebaseUser = await admin.auth().verifyIdToken(idToken);
  next();
});
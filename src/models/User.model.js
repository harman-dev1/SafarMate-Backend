import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    profilePicture: { type: String, default: '' },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    currentLocation: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
    },
    savedPlaces: [
      {
        label: String,
        address: String,
        coordinates: [Number],
        category: { type: String, enum: ['home', 'work', 'favorite', 'other'], default: 'other' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    preferences: {
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
      mapStyle: { type: String, enum: ['default', 'satellite', 'dark'], default: 'default' },
      units: { type: String, enum: ['metric', 'imperial'], default: 'metric' },
    },
    trustScore: { type: Number, default: 50, min: 0, max: 100 },
  },
  { timestamps: true }
);

userSchema.index({ currentLocation: '2dsphere' });

export default mongoose.model('User', userSchema);
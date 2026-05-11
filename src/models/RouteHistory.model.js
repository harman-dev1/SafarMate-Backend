import mongoose from 'mongoose';

const routeHistorySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    origin: { name: String, coordinates: [Number] },
    destination: { name: String, coordinates: [Number] },
    waypoints: [{ name: String, coordinates: [Number] }],
    distance: Number, // meters
    duration: Number, // seconds
    transportMode: { type: String, enum: ['driving', 'walking', 'cycling'], default: 'driving' },
  },
  { timestamps: true }
);

export default mongoose.model('RouteHistory', routeHistorySchema);
import mongoose from 'mongoose';

const incidentSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: {
      type: String,
      enum: ['accident', 'pothole', 'roadblock', 'construction', 'flooding', 'other'],
      required: true,
    },
    description: String,
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    severity: { type: Number, min: 1, max: 5, default: 1 },
    status: { type: String, enum: ['open', 'verified', 'closed'], default: 'open' },
    images: [String],
  },
  { timestamps: true }
);

incidentSchema.index({ location: '2dsphere' });

export default mongoose.model('Incident', incidentSchema);
import mongoose from 'mongoose';

const INCIDENT_TYPES = ['pothole', 'roadblock', 'construction', 'flooding', 'checkpoint', 'obstacle'];

// Type-specific TTL in seconds — backend auto-deletes expired docs via TTL index
export const TTL_BY_TYPE = {
  pothole:      24 * 3600,   // 24 hours
  roadblock:     4 * 3600,   //  4 hours
  construction:  7 * 24 * 3600, //  7 days
  flooding:      6 * 3600,   //  6 hours
  checkpoint:    2 * 3600,   //  2 hours
  obstacle:      2 * 3600,   //  2 hours
};

// Denial thresholds — higher severity needs more denials before auto-remove
export const DENIAL_THRESHOLD_BY_SEVERITY = {
  low: 3,
  medium: 4,
  high: 5,
};

const IncidentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: INCIDENT_TYPES, required: true, index: true },
    severity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    note: { type: String, maxlength: 200, default: '' },
    imageUrl: { type: String, default: null },

    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    locality: { type: String, default: null }, // optional reverse-geocoded name

    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reporterTrustAtReport: { type: Number, default: 50 },

    confirmations: { type: Number, default: 0 },
    denials: { type: Number, default: 0 },
    confirmedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    deniedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    status: {
      type: String,
      enum: ['active', 'removed_by_reporter', 'removed_by_community'],
      default: 'active',
      index: true,
    },

    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

// 2dsphere index for geo queries
IncidentSchema.index({ location: '2dsphere' });

// TTL index — MongoDB auto-deletes when expiresAt < now (checks every 60s)
IncidentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for "active incidents in bbox" queries
IncidentSchema.index({ status: 1, expiresAt: 1 });

export default mongoose.model('Incident', IncidentSchema);
export { INCIDENT_TYPES };
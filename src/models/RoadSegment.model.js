import mongoose from 'mongoose';

const SAFETY_BANDS = ['safe', 'moderate', 'risky', 'dangerous'];

const RoadSegmentSchema = new mongoose.Schema(
  {
    segmentId: { type: String, required: true, unique: true, index: true },
    roadName: { type: String, required: true },
    zoneType: { type: String, default: null },
    lengthMeters: { type: Number, default: null },

    // Full geometry, used to draw the coloured line on the map.
    geometry: {
      type: { type: String, enum: ['LineString'], default: 'LineString' },
      coordinates: { type: [[Number]], required: true }, // [[lng,lat], [lng,lat]]
    },

    // Midpoint, used for fast $near / $geoWithin proximity queries —
    // mirrors the same pattern Incident.model.js uses for `location`.
    midpoint: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },

    // Baseline score produced offline by train_safety_model.py.
    safetyScore: { type: Number, required: true, min: 0, max: 100 },
    safetyBand: { type: String, enum: SAFETY_BANDS, required: true },

    // Contributing factors, kept for transparency on the map (info card)
    // and for retraining/debugging later.
    factors: {
      roadQualityIndex: Number,
      accidentHistoryIndex: Number,
      potholeDensityPerKm: Number,
      surfaceRating: Number,
      lightingQuality: String,
      encroachmentLevel: String,
      drainageQuality: String,
      accidentCount12mo: Number,
      fatalAccidentCount12mo: Number,
      avgAccidentSeverity: Number,
    },

    modelBackend: { type: String, default: null }, // 'xgboost' | 'sklearn-hgbt'
    lastScored: { type: Date, default: Date.now }, // when the offline model produced this baseline
  },
  { timestamps: true }
);

// Geospatial indexes — LineString for rendering/queries, Point for cheap proximity lookups.
RoadSegmentSchema.index({ geometry: '2dsphere' });
RoadSegmentSchema.index({ midpoint: '2dsphere' });

export default mongoose.model('RoadSegment', RoadSegmentSchema);
export { SAFETY_BANDS };

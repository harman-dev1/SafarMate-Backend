import mongoose from 'mongoose';

/**
 * IncidentArchive.model.js
 * ---------------------------------------------------------------------
 * The live `Incident` collection is intentionally short-lived: every
 * document is auto-deleted by its TTL index once expiresAt passes
 * (Incident.model.js: expireAfterSeconds: 0), which is correct for
 * keeping the map showing only current hazards. The side effect is that
 * NOTHING is retained once a report expires, gets confirmed away, or is
 * removed by the community — so there is no history to train the safety
 * scoring model on, no matter how many real reports accumulate.
 *
 * This collection fixes that. It has NO TTL index — documents are never
 * auto-deleted. One row is written here at the moment a report is
 * created (mirroring the live Incident), and the same row is updated
 * with the report's final outcome when the live Incident is later
 * confirmed, denied/removed, withdrawn, or expires. export_real_
 * training_data.js reads ONLY from this collection (never from the live
 * Incident collection, which by design won't have old data).
 * ---------------------------------------------------------------------
 */

const IncidentArchiveSchema = new mongoose.Schema(
  {
    // Mirrors the originating live Incident's _id, so the two can be
    // cross-referenced while the live one still exists.
    sourceIncidentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

    type: { type: String, required: true, index: true },
    severity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },

    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },

    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reporterTrustAtReport: { type: Number, default: 50 },

    createdAt: { type: Date, required: true, index: true },

    // Filled in / updated as the live incident's lifecycle plays out.
    // Stays null until the report is resolved one way or another.
    finalStatus: {
      type: String,
      enum: ['active', 'removed_by_reporter', 'removed_by_community', 'expired', null],
      default: null,
    },
    finalConfirmations: { type: Number, default: 0 },
    finalDenials: { type: Number, default: 0 },
    resolvedAt: { type: Date, default: null },

    // Which road segment this report fell nearest to, filled in by
    // export_real_training_data.js the first time it processes this
    // row (cached so repeated export runs don't re-do the geo lookup).
    nearestSegmentId: { type: String, default: null, index: true },
  },
  { timestamps: true }
);

IncidentArchiveSchema.index({ location: '2dsphere' });

export default mongoose.model('IncidentArchive', IncidentArchiveSchema);

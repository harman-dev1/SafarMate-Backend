import mongoose from 'mongoose';

/**
 * SOSEvent.model.js
 * ---------------------------------------------------------------------
 * STUB / FORWARD SCHEMA — write this now, wire it up when you build the
 * SOS module. It does not need to be mounted in any route yet. Its only
 * job right now is to give export_real_training_data.js something
 * concrete to query, so that the moment SOS goes live and starts
 * collecting real triggers, the safety-score retraining pipeline picks
 * up real accident data automatically — no further plumbing required.
 *
 * When you build the real SOS feature, an SOSEvent document should be
 * created every time a user triggers SOS, and updated once the event is
 * resolved (most SOS triggers will NOT be road accidents — false alarms,
 * medical issues, etc. — hence isRoadAccident, which is what the export
 * script actually filters on).
 * ---------------------------------------------------------------------
 */

const SOSEventSchema = new mongoose.Schema(
  {
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },

    triggeredAt: { type: Date, default: Date.now, index: true },

    status: {
      type: String,
      enum: ['active', 'resolved', 'false_alarm'],
      default: 'active',
      index: true,
    },

    // The fields the safety-scoring export actually cares about.
    isRoadAccident: { type: Boolean, default: false, index: true },
    accidentSeverity: { type: Number, min: 1, max: 5, default: null }, // 1=minor .. 5=fatal/major
    casualtyCount: { type: Number, default: 0 },   // non-fatal injuries
    fatalityCount: { type: Number, default: 0 },

    resolvedAt: { type: Date, default: null },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

SOSEventSchema.index({ location: '2dsphere' });

export default mongoose.model('SOSEvent', SOSEventSchema);

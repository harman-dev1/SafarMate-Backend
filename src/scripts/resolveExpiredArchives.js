/**
 * resolveExpiredArchives.js
 * ---------------------------------------------------------------------
 * MongoDB's TTL index deletes expired Incident documents silently in
 * the background — there is no application hook that fires when it
 * happens. So we can't catch "this incident just expired" the moment
 * it occurs. Instead, this script periodically reconciles: any
 * IncidentArchive row that's still finalStatus=null, but whose source
 * Incident document is gone AND enough time has passed that it could
 * only have disappeared via TTL expiry (not an in-flight request), is
 * marked finalStatus='expired'.
 *
 * Run this on a daily cron (or however often you like — it's cheap and
 * idempotent). It does not affect the live Incident collection at all.
 *
 *   node src/scripts/resolveExpiredArchives.js
 * ---------------------------------------------------------------------
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { ENV } from '../config/env.js';
import Incident from '../models/Incident.model.js';
import IncidentArchive from '../models/IncidentArchive.model.js';

// Longest TTL in the system is construction at 7 days; add a safety
// margin so we never mark something expired while it might still be
// legitimately active or mid-resolution.
const SAFETY_MARGIN_DAYS = 8;

async function run() {
  await mongoose.connect(ENV.MONGO_URI);

  const cutoff = new Date(Date.now() - SAFETY_MARGIN_DAYS * 24 * 3600 * 1000);
  const candidates = await IncidentArchive.find({
    finalStatus: null,
    createdAt: { $lte: cutoff },
  }).select('sourceIncidentId').lean();

  console.log(`Checking ${candidates.length} unresolved archive rows older than ${SAFETY_MARGIN_DAYS} days...`);

  let resolved = 0;
  for (const row of candidates) {
    const stillLive = await Incident.exists({ _id: row.sourceIncidentId });
    if (!stillLive) {
      await IncidentArchive.updateOne(
        { _id: row._id },
        { $set: { finalStatus: 'expired', resolvedAt: new Date() } }
      );
      resolved += 1;
    }
  }

  console.log(`Marked ${resolved} archive rows as expired.`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('resolveExpiredArchives failed:', err);
  process.exit(1);
});

/**
 * seedRoadSegments.js
 * ---------------------------------------------------------------------
 * One-off / re-runnable script that loads the scored output of
 * train_safety_model.py (lahore_segments_scored.json) into the
 * RoadSegment collection. Safe to re-run: it upserts by segmentId, so
 * re-scoring and re-seeding after retraining just refreshes existing
 * documents instead of duplicating them.
 *
 * Usage (from the backend project root):
 *   node src/scripts/seedRoadSegments.js [path/to/lahore_segments_scored.json]
 *
 * Defaults to ./ml/safety_score/lahore_segments_scored.json if no path
 * is given (see the deployment guide for the recommended folder layout).
 * ---------------------------------------------------------------------
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { ENV } from '../config/env.js';
import RoadSegment from '../models/RoadSegment.model.js';

const DEFAULT_PATH = path.resolve('ml/safety_score/lahore_segments_scored.json');

const run = async () => {
  const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_PATH;

  if (!fs.existsSync(inputPath)) {
    console.error(`Scored segments file not found: ${inputPath}`);
    console.error('Run generate_lahore_dataset.py and train_safety_model.py first,');
    console.error('or pass the path explicitly: node src/scripts/seedRoadSegments.js <path>');
    process.exit(1);
  }

  const records = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  console.log(`Loaded ${records.length} scored segments from ${inputPath}`);

  console.log('Connecting to MongoDB...');
  await mongoose.connect(ENV.MONGO_URI);
  console.log('Connected. Upserting segments...');

  let upserted = 0;
  for (const r of records) {
    await RoadSegment.updateOne(
      { segmentId: r.segmentId },
      {
        $set: {
          roadName: r.roadName,
          zoneType: r.zoneType,
          lengthMeters: r.lengthMeters,
          geometry: r.geometry,
          midpoint: r.midpoint,
          safetyScore: r.safetyScore,
          safetyBand: r.safetyBand,
          factors: r.factors,
          modelBackend: r.modelBackend,
          lastScored: new Date(),
        },
      },
      { upsert: true }
    );
    upserted += 1;
    if (upserted % 100 === 0) console.log(`  ...${upserted}/${records.length}`);
  }

  console.log(`Done. Upserted ${upserted} road segments.`);
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});

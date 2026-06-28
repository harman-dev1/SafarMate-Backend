/**
 * export_real_training_data.js
 * ---------------------------------------------------------------------
 * Builds a CSV in EXACTLY the same column schema as
 * lahore_road_safety_dataset.csv, but populated from REAL data:
 *   - pothole reports and flooding reports from IncidentArchive
 *     (the permanent log — see IncidentArchive.model.js — NOT the live
 *     Incident collection, which deletes itself via TTL)
 *   - road-accident data from SOSEvent, once the SOS module exists and
 *     has collected some
 *
 * Run train_safety_model.py against this file's output exactly as you
 * would against the synthetic CSV — nothing else changes.
 *
 * HONEST LIMITATION, READ THIS:
 * Not every feature the model expects has a real data source yet.
 * Three groups of features behave differently here:
 *
 *   REAL, derived from app data:
 *     - pothole_density_per_km   (from IncidentArchive type='pothole')
 *     - drainage_quality         (from IncidentArchive type='flooding')
 *     - accident_count_12mo, fatal_accident_count_12mo,
 *       injury_count_12mo, avg_accident_severity
 *                                (from SOSEvent, isRoadAccident=true —
 *                                 will be all zeros until SOS exists
 *                                 and has collected real triggers)
 *
 *   APPROXIMATED, not independently measured:
 *     - surface_rating  (derived FROM pothole_density_per_km via a
 *       formula — there is no separate "rate this road's surface"
 *       report type in the app, so this is not a true independent
 *       measurement, just a reasonable proxy)
 *
 *   STILL CARRIED FORWARD FROM THE LAST KNOWN BASELINE (no real source
 *   exists in the app yet for these — see the guide, section "Closing
 *   the remaining data gaps", for how to add one):
 *     - lighting_quality, encroachment_level
 *     - road_class, lane_count, speed_limit_kmh, avg_traffic_volume
 *
 * Every output row carries a `dataSource` breakdown so you always know,
 * per segment, which fields are real and which are carried forward.
 * ---------------------------------------------------------------------
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { ENV } from '../config/env.js';
import RoadSegment from '../models/RoadSegment.model.js';
import IncidentArchive from '../models/IncidentArchive.model.js';
import SOSEvent from '../models/SOSEvent.model.js';

const LOOKBACK_DAYS = Number(process.argv[3]) || 365;
const SEARCH_RADIUS_M = 150; // how far a report can be from a segment's midpoint to count toward it
const OUT_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve('ml/safety_score/lahore_road_safety_dataset_real.csv');

const CSV_COLUMNS = [
  'segment_id', 'road_name', 'zone_type', 'segment_index',
  'start_lat', 'start_lng', 'end_lat', 'end_lng', 'mid_lat', 'mid_lng', 'length_m',
  'road_class', 'lane_count', 'speed_limit_kmh', 'avg_traffic_volume',
  'pothole_density_per_km', 'surface_rating', 'lighting_quality',
  'encroachment_level', 'drainage_quality', 'has_footpath',
  'accident_count_12mo', 'fatal_accident_count_12mo', 'injury_count_12mo',
  'avg_accident_severity', 'road_quality_index', 'accident_history_index',
  'safety_score', 'safety_band',
  // extra, informational only — drop this column before training if your
  // CSV reader complains about an unexpected column; train_safety_model.py
  // only reads the columns above, so leaving it in is also fine.
  'dataSource',
];

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

const bandOf = (score) => {
  if (score >= 75) return 'safe';
  if (score >= 50) return 'moderate';
  if (score >= 30) return 'risky';
  return 'dangerous';
};

const csvEscape = (v) => {
  const s = String(v ?? '');
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function run() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(ENV.MONGO_URI);

  const segments = await RoadSegment.find({}).lean();
  if (!segments.length) {
    console.error('No RoadSegment documents found. Seed the synthetic baseline first (seedRoadSegments.js).');
    process.exit(1);
  }
  console.log(`Found ${segments.length} road segments. Aggregating real reports per segment (last ${LOOKBACK_DAYS} days, ${SEARCH_RADIUS_M}m radius)...`);

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000);
  const rows = [];
  let realPotholeSignals = 0;
  let realAccidentSignals = 0;

  for (const seg of segments) {
    const [lng, lat] = seg.midpoint.coordinates;
    const lengthKm = Math.max(0.05, (seg.lengthMeters || 600) / 1000);

    const nearbyReports = await IncidentArchive.find({
      createdAt: { $gte: since },
      location: {
        $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: SEARCH_RADIUS_M },
      },
    }).lean();

    const potholeCount = nearbyReports.filter((r) => r.type === 'pothole').length;
    const floodingCount = nearbyReports.filter((r) => r.type === 'flooding').length;

    const haveRealPotholeData = nearbyReports.length > 0;
    if (haveRealPotholeData) realPotholeSignals += 1;

    // ---- REAL (or approximated-from-real) road-quality features ----
    const potholeDensityPerKm = haveRealPotholeData
      ? Math.round((potholeCount / lengthKm) * 100) / 100
      : seg.factors?.potholeDensityPerKm ?? 0;

    const surfaceRating = haveRealPotholeData
      ? Math.round(clamp(5 - potholeDensityPerKm * 0.25, 1, 5) * 100) / 100
      : seg.factors?.surfaceRating ?? 3;

    const drainageQuality = haveRealPotholeData || floodingCount > 0
      ? (floodingCount >= 3 ? 'poor' : floodingCount >= 1 ? 'moderate' : 'good')
      : seg.factors?.drainageQuality ?? 'moderate';

    // ---- Not yet derivable from any app data source — carried forward ----
    const lightingQuality = seg.factors?.lightingQuality ?? 'moderate';
    const encroachmentLevel = seg.factors?.encroachmentLevel ?? 'moderate';
    const roadClass = seg.roadClass ?? 'collector';
    const laneCount = seg.laneCount ?? 2;
    const speedLimitKmh = seg.speedLimitKmh ?? 40;
    const avgTrafficVolume = seg.avgTrafficVolume ?? 1500;
    const hasFootpath = seg.hasFootpath ?? 1;

    // ---- Accident history — from SOSEvent, once it exists and has data ----
    const nearbySos = await SOSEvent.find({
      isRoadAccident: true,
      triggeredAt: { $gte: since },
      location: {
        $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: SEARCH_RADIUS_M },
      },
    }).lean();

    const haveRealAccidentData = nearbySos.length > 0;
    if (haveRealAccidentData) realAccidentSignals += 1;

    const accidentCount12mo = haveRealAccidentData ? nearbySos.length : seg.factors?.accidentCount12mo ?? 0;
    const fatalAccidentCount12mo = haveRealAccidentData
      ? nearbySos.filter((s) => s.fatalityCount > 0).length
      : seg.factors?.fatalAccidentCount12mo ?? 0;
    const injuryCount12mo = haveRealAccidentData
      ? nearbySos.reduce((sum, s) => sum + (s.casualtyCount || 0), 0)
      : 0;
    const avgAccidentSeverity = haveRealAccidentData
      ? Math.round((nearbySos.reduce((sum, s) => sum + (s.accidentSeverity || 3), 0) / nearbySos.length) * 100) / 100
      : seg.factors?.avgAccidentSeverity ?? 0;

    // ---- Recompute the two indices + label from these (mixed real/carried-forward) values ----
    const potholeTerm = 1 - clamp(potholeDensityPerKm / 16, 0, 1);
    const surfaceTerm = clamp((surfaceRating - 1) / 4, 0, 1);
    const lightingTerm = { poor: 0, moderate: 0.5, good: 1 }[lightingQuality] ?? 0.5;
    const encroachmentTerm = 1 - ({ none: 0, moderate: 0.5, severe: 1 }[encroachmentLevel] ?? 0.5);
    const drainageTerm = { poor: 0, moderate: 0.5, good: 1 }[drainageQuality] ?? 0.5;
    const footpathTerm = hasFootpath ? 1 : 0.4;
    const rqi = 0.30 * potholeTerm + 0.25 * surfaceTerm + 0.15 * lightingTerm +
                0.15 * encroachmentTerm + 0.10 * drainageTerm + 0.05 * footpathTerm;

    const accidentTerm = 1 - clamp(accidentCount12mo / 12, 0, 1);
    const fatalTerm = 1 - clamp(fatalAccidentCount12mo / 4, 0, 1);
    const injuryTerm = 1 - clamp(injuryCount12mo / 18, 0, 1);
    const severityTerm = 1 - clamp(avgAccidentSeverity / 5, 0, 1);
    const ahi = 0.35 * accidentTerm + 0.30 * fatalTerm + 0.20 * injuryTerm + 0.15 * severityTerm;

    const safetyScore = Math.round(clamp(100 * (0.5 * rqi + 0.5 * ahi), 0, 100) * 10) / 10;

    rows.push({
      segment_id: seg.segmentId, road_name: seg.roadName, zone_type: seg.zoneType, segment_index: 0,
      start_lat: seg.geometry.coordinates[0][1], start_lng: seg.geometry.coordinates[0][0],
      end_lat: seg.geometry.coordinates[1][1], end_lng: seg.geometry.coordinates[1][0],
      mid_lat: lat, mid_lng: lng, length_m: seg.lengthMeters,
      road_class: roadClass, lane_count: laneCount, speed_limit_kmh: speedLimitKmh,
      avg_traffic_volume: avgTrafficVolume,
      pothole_density_per_km: potholeDensityPerKm, surface_rating: surfaceRating,
      lighting_quality: lightingQuality, encroachment_level: encroachmentLevel,
      drainage_quality: drainageQuality, has_footpath: hasFootpath ? 1 : 0,
      accident_count_12mo: accidentCount12mo, fatal_accident_count_12mo: fatalAccidentCount12mo,
      injury_count_12mo: injuryCount12mo, avg_accident_severity: avgAccidentSeverity,
      road_quality_index: Math.round(rqi * 10000) / 10000,
      accident_history_index: Math.round(ahi * 10000) / 10000,
      safety_score: safetyScore, safety_band: bandOf(safetyScore),
      dataSource: `pothole/flooding:${haveRealPotholeData ? 'real' : 'carried-forward'};accident:${haveRealAccidentData ? 'real' : 'carried-forward'}`,
    });
  }

  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvEscape(r[c])).join(','));
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, lines.join('\n'));

  console.log(`\nWrote ${rows.length} rows -> ${OUT_PATH}`);
  console.log(`Segments with REAL pothole/flooding signal: ${realPotholeSignals}/${rows.length}`);
  console.log(`Segments with REAL accident (SOS) signal:   ${realAccidentSignals}/${rows.length}`);
  if (realAccidentSignals === 0) {
    console.log('(0 is expected until the SOS module is built and has logged isRoadAccident=true events.)');
  }
  console.log('\nNext: python3 train_safety_model.py --data ' + OUT_PATH);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('Export failed:', err);
  process.exit(1);
});

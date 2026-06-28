"""
generate_lahore_dataset.py
---------------------------------------------------------------------------
Generates a SYNTHETIC road-safety dataset for SafarMate's road safety
scoring module, laid out along real Lahore road corridors.

IMPORTANT - read this before you trust a single number in the output:
  * The road names and approximate waypoints below are real, well-known
    Lahore corridors/landmarks, used so that the generated segments sit on
    a realistic city layout instead of random points in the sea.
  * The per-segment coordinates are INTERPOLATED between a handful of
    hand-picked waypoints per road. They are NOT survey-grade GPS and will
    not line up lane-for-lane with the real road. Treat them as
    "approximately along this corridor", good enough to demo a working,
    map-renderable safety layer end to end.
  * Every feature value (potholes, accidents, lighting, etc.) is SAMPLED
    from a hand-tuned statistical profile per zone type (e.g. "old city",
    "industrial", "affluent residential"), not measured from the real
    world. The whole point of this script is to give the ML pipeline
    something realistic-shaped to learn from until real incident +
    road-condition data has accumulated (see Appendix / thesis Ch.4 & 7).
  * Re-run with a different --seed to get a different (but equally
    synthetic) sample.

Output: lahore_road_safety_dataset.csv  (one row per road segment, ~600m each)
---------------------------------------------------------------------------
"""

import argparse
import csv
import math
import random
import os

# ───────────────────────── Geometry helpers (mirrors backend's distMeters) ─────────────────────────
EARTH_R = 6371000.0


def to_rad(d):
    return d * math.pi / 180.0


def dist_meters(a, b):
    """Great-circle distance in metres between (lat,lng) tuples a, b."""
    d_lat = to_rad(b[0] - a[0])
    d_lng = to_rad(b[1] - a[1])
    x = (math.sin(d_lat / 2) ** 2 +
         math.cos(to_rad(a[0])) * math.cos(to_rad(b[0])) * math.sin(d_lng / 2) ** 2)
    return EARTH_R * 2 * math.atan2(math.sqrt(x), math.sqrt(1 - x))


def interpolate(a, b, t):
    return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))


def walk_segments(waypoints, seg_len_m=600.0):
    """
    Walks a polyline (list of (lat,lng) waypoints) and cuts it into
    consecutive segments of approximately seg_len_m metres each.
    Returns a list of (start_point, end_point) tuples.
    Mirrors the spacing logic of samplePolyline() in weather.service.js,
    applied here to cut fixed-length segments instead of sample points.
    """
    segments = []
    carry = 0.0
    cursor = waypoints[0]

    for i in range(len(waypoints) - 1):
        a, b = waypoints[i], waypoints[i + 1]
        seg_total = dist_meters(a, b)
        if seg_total == 0:
            continue
        walked = 0.0
        local_start = a
        while True:
            remaining_in_leg = seg_total - walked
            need = seg_len_m - carry
            if need < remaining_in_leg:
                walked += need
                t = walked / seg_total
                end_point = interpolate(a, b, t)
                segments.append((cursor, end_point))
                cursor = end_point
                carry = 0.0
            else:
                carry += remaining_in_leg
                cursor = b
                break
    return segments


# ───────────────────────── Real Lahore road corridors ─────────────────────────
# Waypoints are approximate (lat, lng), picked at well-known landmarks/junctions
# along each corridor. zone drives the synthetic feature distribution below.
ROADS = [
    # ---- Arterial / highway-grade roads ----
    {"name": "Ferozepur Road", "zone": "arterial_highway", "waypoints": [
        (31.5497, 74.3433), (31.5135, 74.3429), (31.4925, 74.2879), (31.4554, 74.2638)]},
    {"name": "Multan Road", "zone": "arterial_highway", "waypoints": [
        (31.5400, 74.3100), (31.4925, 74.2879), (31.4600, 74.2500), (31.4000, 74.2100)]},
    {"name": "Canal Bank Road", "zone": "arterial_highway", "waypoints": [
        (31.5550, 74.3550), (31.5285, 74.3424), (31.4950, 74.3300), (31.4450, 74.2700)]},
    {"name": "Ring Road (Babu Sabu - Shahdara section)", "zone": "arterial_highway", "waypoints": [
        (31.5550, 74.2450), (31.5850, 74.2800), (31.6300, 74.3500)]},
    {"name": "Ring Road (Harbanspura - Bedian section)", "zone": "arterial_highway", "waypoints": [
        (31.5750, 74.3700), (31.5300, 74.4200), (31.4900, 74.4450)]},
    {"name": "Lahore-Sialkot Motorway Link (GT Road towards Shahdara)", "zone": "arterial_highway", "waypoints": [
        (31.6020, 74.3270), (31.6100, 74.3500), (31.6193, 74.2934)]},
    {"name": "GT Road towards Wagah", "zone": "arterial_highway", "waypoints": [
        (31.5700, 74.4000), (31.5750, 74.4600), (31.6044, 74.5728)]},
    {"name": "Raiwind Road (outer)", "zone": "arterial_highway", "waypoints": [
        (31.4200, 74.2200), (31.3600, 74.2200), (31.3000, 74.2000)]},

    # ---- Urban commercial / arterial-but-busy roads ----
    {"name": "Mall Road", "zone": "urban_commercial", "waypoints": [
        (31.5778, 74.3294), (31.5650, 74.3360), (31.5497, 74.3433)]},
    {"name": "Jail Road", "zone": "urban_commercial", "waypoints": [
        (31.5497, 74.3433), (31.5285, 74.3424), (31.5095, 74.3434)]},
    {"name": "MM Alam Road", "zone": "urban_commercial", "waypoints": [
        (31.5210, 74.3480), (31.5160, 74.3500), (31.5095, 74.3434)]},
    {"name": "Main Boulevard Gulberg", "zone": "urban_commercial", "waypoints": [
        (31.5210, 74.3380), (31.5135, 74.3429), (31.5037, 74.3294)]},
    {"name": "Liberty - Kalma Chowk Link", "zone": "urban_commercial", "waypoints": [
        (31.5095, 74.3434), (31.5037, 74.3294)]},
    {"name": "Davis Road", "zone": "urban_commercial", "waypoints": [
        (31.5600, 74.3320), (31.5560, 74.3360), (31.5497, 74.3433)]},
    {"name": "Empress Road", "zone": "urban_commercial", "waypoints": [
        (31.5640, 74.3280), (31.5560, 74.3320), (31.5497, 74.3433)]},
    {"name": "Allama Iqbal Road", "zone": "urban_commercial", "waypoints": [
        (31.5550, 74.3200), (31.5400, 74.3150), (31.5300, 74.3150)]},
    {"name": "Wahdat Road", "zone": "urban_commercial", "waypoints": [
        (31.5050, 74.3030), (31.4950, 74.2960), (31.4858, 74.3084)]},
    {"name": "Airport Road", "zone": "urban_commercial", "waypoints": [
        (31.5216, 74.4036), (31.5050, 74.3850), (31.4950, 74.3700)]},

    # ---- Affluent residential ----
    {"name": "Defence (DHA) Main Boulevard", "zone": "affluent_residential", "waypoints": [
        (31.4710, 74.4090), (31.4600, 74.4200), (31.4500, 74.4350)]},
    {"name": "Model Town Main Boulevard", "zone": "affluent_residential", "waypoints": [
        (31.4847, 74.3247), (31.4800, 74.3200), (31.4750, 74.3150)]},
    {"name": "Cantt - Askari Road", "zone": "affluent_residential", "waypoints": [
        (31.4850, 74.3700), (31.4900, 74.3800), (31.4950, 74.3900)]},
    {"name": "Faisal Town Main Boulevard", "zone": "affluent_residential", "waypoints": [
        (31.4858, 74.3084), (31.4800, 74.3030), (31.4750, 74.2980)]},

    # ---- Dense old-city ----
    {"name": "Circular Road", "zone": "old_city_dense", "waypoints": [
        (31.5820, 74.3140), (31.5900, 74.3200), (31.5950, 74.3280)]},
    {"name": "McLeod Road", "zone": "old_city_dense", "waypoints": [
        (31.5650, 74.3220), (31.5700, 74.3160), (31.5750, 74.3120)]},
    {"name": "Anarkali - Lakshmi Chowk", "zone": "old_city_dense", "waypoints": [
        (31.5600, 74.3100), (31.5650, 74.3150)]},
    {"name": "Badami Bagh", "zone": "old_city_dense", "waypoints": [
        (31.6020, 74.3270), (31.5950, 74.3300), (31.5900, 74.3320)]},
    {"name": "Shahdara Town Roads", "zone": "old_city_dense", "waypoints": [
        (31.6193, 74.2934), (31.6150, 74.2980), (31.6100, 74.3030)]},
    {"name": "Mughalpura - Baghbanpura", "zone": "old_city_dense", "waypoints": [
        (31.5650, 74.3550), (31.5750, 74.3450), (31.5860, 74.3380)]},

    # ---- Industrial belts ----
    {"name": "Multan Road Industrial Belt", "zone": "industrial", "waypoints": [
        (31.4600, 74.2500), (31.4300, 74.2350), (31.4150, 74.2300)]},
    {"name": "Sundar Industrial Estate Road", "zone": "industrial", "waypoints": [
        (31.4150, 74.2300), (31.3850, 74.2250), (31.3600, 74.2200)]},
    {"name": "Quaid-e-Azam Industrial Estate Road", "zone": "industrial", "waypoints": [
        (31.4400, 74.2400), (31.4250, 74.2350), (31.4150, 74.2300)]},
    {"name": "Walton Road", "zone": "industrial", "waypoints": [
        (31.5050, 74.3650), (31.5000, 74.3750), (31.4950, 74.3850)]},

    # ---- Mixed residential / suburban ----
    {"name": "Johar Town Main Boulevard", "zone": "mixed_residential", "waypoints": [
        (31.4697, 74.2728), (31.4750, 74.2800), (31.4800, 74.2870)]},
    {"name": "Township Main Boulevard", "zone": "mixed_residential", "waypoints": [
        (31.4441, 74.2965), (31.4550, 74.2950), (31.4650, 74.2920)]},
    {"name": "Iqbal Town Main Road", "zone": "mixed_residential", "waypoints": [
        (31.4950, 74.2900), (31.4900, 74.2850), (31.4858, 74.3084)]},
    {"name": "Samanabad Main Road", "zone": "mixed_residential", "waypoints": [
        (31.5300, 74.2950), (31.5250, 74.3000), (31.5200, 74.3050)]},
    {"name": "Garden Town Main Boulevard", "zone": "mixed_residential", "waypoints": [
        (31.5000, 74.3150), (31.4950, 74.3100), (31.4900, 74.3050)]},
    {"name": "Shadman Market Road", "zone": "mixed_residential", "waypoints": [
        (31.5380, 74.3280), (31.5330, 74.3250), (31.5285, 74.3424)]},
    {"name": "Ichhra Main Road", "zone": "mixed_residential", "waypoints": [
        (31.5300, 74.3150), (31.5250, 74.3100), (31.5210, 74.3480)]},
    {"name": "Garhi Shahu Road", "zone": "mixed_residential", "waypoints": [
        (31.5610, 74.3460), (31.5560, 74.3500), (31.5500, 74.3550)]},

    # ---- Outskirts / link roads ----
    {"name": "Bedian Road", "zone": "outskirts_link", "waypoints": [
        (31.4900, 74.4450), (31.4700, 74.4500), (31.4500, 74.4600)]},
    {"name": "Barki Road", "zone": "outskirts_link", "waypoints": [
        (31.5300, 74.4200), (31.5100, 74.4400), (31.5000, 74.4600)]},
    {"name": "Raiwind Road (far outer)", "zone": "outskirts_link", "waypoints": [
        (31.3000, 74.2000), (31.2600, 74.1900), (31.2200, 74.1800)]},
    {"name": "Shalimar Link Road", "zone": "outskirts_link", "waypoints": [
        (31.5750, 74.3450), (31.5800, 74.3550), (31.5850, 74.3650)]},
]

# ───────────────────────── Zone feature profiles ─────────────────────────
# Each profile gives (low, high) uniform ranges (pre-noise) used to sample
# raw features for every segment whose road belongs to that zone.
# Note the two factor groups the score is built from:
#   ROAD QUALITY  -> pothole_density, surface_rating, lighting, encroachment,
#                    drainage_quality, lane_count, has_footpath
#   ACCIDENT HISTORY -> accident_count_12mo, fatal_accident_count_12mo,
#                       injury_count_12mo, avg_accident_severity
ZONE_PROFILES = {
    "arterial_highway": dict(
        speed_limit=(80, 100), lanes=(4, 6), pothole=(2, 6), surface=(3, 4.5),
        lighting_p=dict(poor=0.15, moderate=0.45, good=0.40),
        encroachment_p=dict(none=0.55, moderate=0.40, severe=0.05),
        drainage_p=dict(poor=0.20, moderate=0.55, good=0.25),
        traffic=(3000, 6000), footpath_p=0.3,
        accidents=(3, 9), fatal=(0, 2), injuries=(2, 14), severity=(3.0, 4.3),
    ),
    "urban_commercial": dict(
        speed_limit=(40, 60), lanes=(3, 5), pothole=(3, 8), surface=(2.5, 4.2),
        lighting_p=dict(poor=0.05, moderate=0.30, good=0.65),
        encroachment_p=dict(none=0.20, moderate=0.55, severe=0.25),
        drainage_p=dict(poor=0.25, moderate=0.55, good=0.20),
        traffic=(2000, 5000), footpath_p=0.7,
        accidents=(2, 6), fatal=(0, 1), injuries=(1, 8), severity=(2.0, 3.3),
    ),
    "affluent_residential": dict(
        speed_limit=(30, 50), lanes=(2, 4), pothole=(0, 3), surface=(3.8, 5.0),
        lighting_p=dict(poor=0.02, moderate=0.18, good=0.80),
        encroachment_p=dict(none=0.85, moderate=0.14, severe=0.01),
        drainage_p=dict(poor=0.05, moderate=0.35, good=0.60),
        traffic=(500, 1800), footpath_p=0.9,
        accidents=(0, 2), fatal=(0, 0), injuries=(0, 2), severity=(1.0, 2.2),
    ),
    "old_city_dense": dict(
        speed_limit=(15, 30), lanes=(1, 2), pothole=(6, 14), surface=(1.0, 2.8),
        lighting_p=dict(poor=0.45, moderate=0.40, good=0.15),
        encroachment_p=dict(none=0.02, moderate=0.28, severe=0.70),
        drainage_p=dict(poor=0.60, moderate=0.32, good=0.08),
        traffic=(1500, 3500), footpath_p=0.15,
        accidents=(2, 7), fatal=(0, 1), injuries=(2, 10), severity=(2.0, 3.4),
    ),
    "industrial": dict(
        speed_limit=(40, 70), lanes=(2, 4), pothole=(7, 16), surface=(1.0, 2.8),
        lighting_p=dict(poor=0.55, moderate=0.35, good=0.10),
        encroachment_p=dict(none=0.35, moderate=0.50, severe=0.15),
        drainage_p=dict(poor=0.65, moderate=0.28, good=0.07),
        traffic=(1800, 4000), footpath_p=0.1,
        accidents=(3, 10), fatal=(1, 3), injuries=(3, 16), severity=(3.2, 4.6),
    ),
    "mixed_residential": dict(
        speed_limit=(30, 50), lanes=(2, 4), pothole=(2, 7), surface=(2.8, 4.2),
        lighting_p=dict(poor=0.15, moderate=0.45, good=0.40),
        encroachment_p=dict(none=0.40, moderate=0.50, severe=0.10),
        drainage_p=dict(poor=0.25, moderate=0.50, good=0.25),
        traffic=(800, 2500), footpath_p=0.55,
        accidents=(1, 4), fatal=(0, 1), injuries=(0, 5), severity=(1.6, 2.8),
    ),
    "outskirts_link": dict(
        speed_limit=(60, 100), lanes=(2, 4), pothole=(4, 12), surface=(1.5, 3.2),
        lighting_p=dict(poor=0.65, moderate=0.28, good=0.07),
        encroachment_p=dict(none=0.80, moderate=0.18, severe=0.02),
        drainage_p=dict(poor=0.45, moderate=0.40, good=0.15),
        traffic=(600, 2200), footpath_p=0.1,
        accidents=(1, 5), fatal=(0, 2), injuries=(1, 9), severity=(2.8, 4.4),
    ),
}

LIGHTING_LEVELS = {"poor": 0, "moderate": 1, "good": 2}
ENCROACHMENT_LEVELS = {"none": 0, "moderate": 1, "severe": 2}
DRAINAGE_LEVELS = {"poor": 0, "moderate": 1, "good": 2}


def sample_categorical(rng, prob_dict):
    keys = list(prob_dict.keys())
    weights = list(prob_dict.values())
    return rng.choices(keys, weights=weights, k=1)[0]


def road_class_for_zone(zone):
    return {
        "arterial_highway": "arterial",
        "urban_commercial": "arterial",
        "affluent_residential": "local",
        "old_city_dense": "local",
        "industrial": "collector",
        "mixed_residential": "collector",
        "outskirts_link": "highway",
    }[zone]


def gen_segment_features(rng, zone, road_bias):
    """
    Samples one segment's raw features from its zone profile.
    `road_bias` is a small per-road random offset (in [-1, 1]) applied to
    several features so that segments on the SAME road are correlated
    with each other rather than fully independent draws.
    """
    p = ZONE_PROFILES[zone]

    def jittered_uniform(rng_range, bias_scale=0.0):
        lo, hi = rng_range
        base = rng.uniform(lo, hi)
        if bias_scale:
            base += road_bias * bias_scale * (hi - lo)
        return base

    pothole_density = max(0.0, jittered_uniform(p["pothole"], 0.25))
    surface_rating = min(5.0, max(1.0, jittered_uniform(p["surface"], 0.2)))
    lighting_quality = sample_categorical(rng, p["lighting_p"])
    encroachment_level = sample_categorical(rng, p["encroachment_p"])
    drainage_quality = sample_categorical(rng, p["drainage_p"])
    lane_count = rng.randint(*p["lanes"])
    speed_limit_kmh = round(jittered_uniform(p["speed_limit"], 0.15) / 5) * 5
    avg_traffic_volume = round(jittered_uniform(p["traffic"], 0.3))
    has_footpath = rng.random() < p["footpath_p"]

    accident_count_12mo = max(0, round(jittered_uniform(p["accidents"], 0.3)))
    fatal_accident_count_12mo = max(0, round(jittered_uniform(p["fatal"], 0.3)))
    fatal_accident_count_12mo = min(fatal_accident_count_12mo, accident_count_12mo)
    injury_count_12mo = max(0, round(jittered_uniform(p["injuries"], 0.3)))
    avg_accident_severity = (
        round(min(5.0, max(1.0, jittered_uniform(p["severity"], 0.2))), 2)
        if accident_count_12mo > 0 else 0.0
    )

    return dict(
        road_class=road_class_for_zone(zone),
        lane_count=lane_count,
        speed_limit_kmh=speed_limit_kmh,
        avg_traffic_volume=avg_traffic_volume,
        pothole_density_per_km=round(pothole_density, 2),
        surface_rating=round(surface_rating, 2),
        lighting_quality=lighting_quality,
        encroachment_level=encroachment_level,
        drainage_quality=drainage_quality,
        has_footpath=int(has_footpath),
        accident_count_12mo=accident_count_12mo,
        fatal_accident_count_12mo=fatal_accident_count_12mo,
        injury_count_12mo=injury_count_12mo,
        avg_accident_severity=avg_accident_severity,
    )


def normalize(x, lo, hi):
    if hi == lo:
        return 0.5
    return max(0.0, min(1.0, (x - lo) / (hi - lo)))


def compute_indices_and_score(feat, rng):
    """
    Builds the two factor groups the thesis specifies, then blends them
    50/50 into the 0-100 safety_score label (higher = safer). A small
    amount of Gaussian noise is added so the label is not a deterministic,
    perfectly-learnable function of the inputs (more realistic for a model
    to be trained against).
    """
    # ---- Road Quality Index (RQI), 0 = worst, 1 = best ----
    pothole_term = 1 - normalize(feat["pothole_density_per_km"], 0, 16)
    surface_term = normalize(feat["surface_rating"], 1, 5)
    lighting_term = LIGHTING_LEVELS[feat["lighting_quality"]] / 2.0
    encroachment_term = 1 - (ENCROACHMENT_LEVELS[feat["encroachment_level"]] / 2.0)
    drainage_term = DRAINAGE_LEVELS[feat["drainage_quality"]] / 2.0
    footpath_term = 1.0 if feat["has_footpath"] else 0.4

    rqi = (
        0.30 * pothole_term +
        0.25 * surface_term +
        0.15 * lighting_term +
        0.15 * encroachment_term +
        0.10 * drainage_term +
        0.05 * footpath_term
    )

    # ---- Accident History Index (AHI), 0 = worst, 1 = safest ----
    accident_term = 1 - normalize(feat["accident_count_12mo"], 0, 12)
    fatal_term = 1 - normalize(feat["fatal_accident_count_12mo"], 0, 4)
    injury_term = 1 - normalize(feat["injury_count_12mo"], 0, 18)
    severity_term = 1 - normalize(feat["avg_accident_severity"], 0, 5)

    ahi = (
        0.35 * accident_term +
        0.30 * fatal_term +
        0.20 * injury_term +
        0.15 * severity_term
    )

    noise = rng.gauss(0, 4.0)
    raw_score = 100.0 * (0.5 * rqi + 0.5 * ahi) + noise
    safety_score = round(max(0.0, min(100.0, raw_score)), 1)

    if safety_score >= 75:
        band = "safe"
    elif safety_score >= 50:
        band = "moderate"
    elif safety_score >= 30:
        band = "risky"
    else:
        band = "dangerous"

    return round(rqi, 4), round(ahi, 4), safety_score, band


def main():
    parser = argparse.ArgumentParser(description="Generate the synthetic Lahore road-safety dataset.")
    parser.add_argument("--seed", type=int, default=42, help="Random seed (default: 42)")
    parser.add_argument("--seg-len", type=float, default=600.0, help="Target segment length in metres (default: 600)")
    parser.add_argument("--out", type=str, default="lahore_road_safety_dataset.csv", help="Output CSV path")
    args = parser.parse_args()

    rng = random.Random(args.seed)

    rows = []
    seg_id = 1
    for road in ROADS:
        road_bias = rng.uniform(-1, 1)
        segments = walk_segments(road["waypoints"], seg_len_m=args.seg_len)
        for idx, (start, end) in enumerate(segments):
            mid = ((start[0] + end[0]) / 2.0, (start[1] + end[1]) / 2.0)
            feat = gen_segment_features(rng, road["zone"], road_bias)
            rqi, ahi, score, band = compute_indices_and_score(feat, rng)

            rows.append(dict(
                segment_id=f"SEG-{seg_id:04d}",
                road_name=road["name"],
                zone_type=road["zone"],
                segment_index=idx,
                start_lat=round(start[0], 6), start_lng=round(start[1], 6),
                end_lat=round(end[0], 6), end_lng=round(end[1], 6),
                mid_lat=round(mid[0], 6), mid_lng=round(mid[1], 6),
                length_m=round(dist_meters(start, end), 1),
                **feat,
                road_quality_index=rqi,
                accident_history_index=ahi,
                safety_score=score,
                safety_band=band,
            ))
            seg_id += 1

    fieldnames = list(rows[0].keys())
    out_path = args.out
    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} segments across {len(ROADS)} roads -> {out_path}")
    print(f"Safety score range: {min(r['safety_score'] for r in rows)} - {max(r['safety_score'] for r in rows)}")
    band_counts = {}
    for r in rows:
        band_counts[r["safety_band"]] = band_counts.get(r["safety_band"], 0) + 1
    print("Band distribution:", band_counts)


if __name__ == "__main__":
    main()

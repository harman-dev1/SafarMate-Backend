"""
train_safety_model.py
---------------------------------------------------------------------------
Trains the road safety scoring model for SafarMate on the synthetic Lahore
dataset (see generate_lahore_dataset.py), evaluates it, and produces every
artifact needed to put live scores on the map:

  1. safety_model.joblib        - trained scikit-learn Pipeline (preprocessing + model)
  2. metrics.json                - test-set RMSE / MAE / R^2 + run metadata
  3. feature_importance.png      - bar chart of what drives the score
  4. lahore_segments_scored.json - every segment + predicted score, ready
                                    to be seeded into MongoDB by the backend
                                    seed script (seedRoadSegments.js)

Model choice: gradient-boosted decision trees, as specified in the thesis
(Chen & Guestrin, XGBoost, KDD 2016). If the `xgboost` package is installed
it is used directly. If not, the script automatically falls back to
scikit-learn's HistGradientBoostingRegressor, which is the same family of
algorithm (gradient-boosted trees) and lets this script still run end to
end on a machine where xgboost hasn't been installed yet. Install xgboost
(pip install xgboost) to use the exact model named in the thesis.

Usage:
    python train_safety_model.py --data lahore_road_safety_dataset.csv
---------------------------------------------------------------------------
"""

import argparse
import json
import sys
import time

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.inspection import permutation_importance
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

try:
    from xgboost import XGBRegressor
    MODEL_BACKEND = "xgboost"
except ImportError:
    from sklearn.ensemble import HistGradientBoostingRegressor
    MODEL_BACKEND = "sklearn-hgbt"

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# Raw features the model is allowed to see. Deliberately EXCLUDES
# road_quality_index / accident_history_index (those are the formula's
# intermediate sums used only to generate the synthetic label) so the
# model has to learn the relationship from primitive signals, the same
# signals real incident + road-condition data would give it later.
NUMERIC_FEATURES = [
    "lane_count", "speed_limit_kmh", "avg_traffic_volume",
    "pothole_density_per_km", "surface_rating", "has_footpath",
    "accident_count_12mo", "fatal_accident_count_12mo",
    "injury_count_12mo", "avg_accident_severity",
]
CATEGORICAL_FEATURES = [
    "road_class", "lighting_quality", "encroachment_level", "drainage_quality",
]
TARGET = "safety_score"


def build_pipeline():
    preprocessor = ColumnTransformer(transformers=[
        ("num", "passthrough", NUMERIC_FEATURES),
        ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
    ])

    if MODEL_BACKEND == "xgboost":
        model = XGBRegressor(
            n_estimators=300, max_depth=5, learning_rate=0.05,
            subsample=0.85, colsample_bytree=0.85,
            reg_lambda=1.0, random_state=42, n_jobs=-1,
        )
    else:
        model = HistGradientBoostingRegressor(
            max_depth=5, learning_rate=0.05, max_iter=300, random_state=42,
        )

    return Pipeline([("preprocess", preprocessor), ("model", model)])


def get_feature_importance(pipeline, X_test, y_test, seed=42):
    """
    Permutation importance on the held-out test set, computed against the
    ORIGINAL (pre-one-hot) columns by permuting each raw column and
    measuring the resulting drop in R^2 through the full pipeline. Works
    identically for both the xgboost and scikit-learn backends, and is
    more honest than training-set gain importance since it is measured on
    data the model did not see during fitting.
    """
    result = permutation_importance(
        pipeline, X_test, y_test, n_repeats=25, random_state=seed,
        scoring="r2", n_jobs=-1,
    )
    order = np.argsort(result.importances_mean)[::-1]
    names = list(X_test.columns)
    return [names[i] for i in order], result.importances_mean[order]


def main():
    parser = argparse.ArgumentParser(description="Train the SafarMate road safety scoring model.")
    parser.add_argument("--data", type=str, default="lahore_road_safety_dataset.csv")
    parser.add_argument("--model-out", type=str, default="safety_model.joblib")
    parser.add_argument("--metrics-out", type=str, default="metrics.json")
    parser.add_argument("--importance-plot", type=str, default="feature_importance.png")
    parser.add_argument("--scored-out", type=str, default="lahore_segments_scored.json")
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    print(f"[1/6] Loading dataset from {args.data} ...")
    df = pd.read_csv(args.data)
    print(f"      {len(df)} segments, model backend = {MODEL_BACKEND}")

    X = df[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
    y = df[TARGET]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=args.test_size, random_state=args.seed
    )
    print(f"[2/6] Split: {len(X_train)} train / {len(X_test)} test")

    print("[3/6] Training model ...")
    t0 = time.time()
    pipeline = build_pipeline()
    pipeline.fit(X_train, y_train)
    train_seconds = round(time.time() - t0, 2)
    print(f"      Done in {train_seconds}s")

    print("[4/6] Evaluating on the held-out test set ...")
    preds = pipeline.predict(X_test)
    rmse = float(np.sqrt(mean_squared_error(y_test, preds)))
    mae = float(mean_absolute_error(y_test, preds))
    r2 = float(r2_score(y_test, preds))
    print(f"      RMSE = {rmse:.2f}   MAE = {mae:.2f}   R^2 = {r2:.3f}")

    metrics = {
        "model_backend": MODEL_BACKEND,
        "n_segments_total": len(df),
        "n_train": len(X_train),
        "n_test": len(X_test),
        "rmse": round(rmse, 3),
        "mae": round(mae, 3),
        "r2": round(r2, 3),
        "train_seconds": train_seconds,
        "numeric_features": NUMERIC_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "target": TARGET,
        "random_seed": args.seed,
    }
    with open(args.metrics_out, "w") as f:
        json.dump(metrics, f, indent=2)
    print(f"      Metrics written -> {args.metrics_out}")

    print("[5/6] Feature importance (permutation, on held-out test set) ...")
    names, importances = get_feature_importance(pipeline, X_test, y_test, seed=args.seed)
    top_n = min(12, len(names))
    plt.figure(figsize=(8, 5))
    plt.barh(names[:top_n][::-1], importances[:top_n][::-1], color="#2563eb")
    plt.xlabel("Mean decrease in R$^2$ when shuffled")
    plt.title(f"What drives the safety score ({MODEL_BACKEND}, permutation importance)")
    plt.tight_layout()
    plt.savefig(args.importance_plot, dpi=150)
    plt.close()
    print(f"      Saved -> {args.importance_plot}")

    print("[6/6] Saving model + scoring every segment for the map ...")
    joblib.dump(pipeline, args.model_out)
    print(f"      Model saved -> {args.model_out}")

    df["predicted_safety_score"] = pipeline.predict(X).round(1).clip(0, 100)

    def band_of(score):
        if score >= 75:
            return "safe"
        if score >= 50:
            return "moderate"
        if score >= 30:
            return "risky"
        return "dangerous"

    df["predicted_band"] = df["predicted_safety_score"].apply(band_of)

    scored_records = []
    for _, row in df.iterrows():
        scored_records.append({
            "segmentId": row["segment_id"],
            "roadName": row["road_name"],
            "zoneType": row["zone_type"],
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [row["start_lng"], row["start_lat"]],
                    [row["end_lng"], row["end_lat"]],
                ],
            },
            "midpoint": {
                "type": "Point",
                "coordinates": [row["mid_lng"], row["mid_lat"]],
            },
            "lengthMeters": row["length_m"],
            "safetyScore": float(row["predicted_safety_score"]),
            "safetyBand": row["predicted_band"],
            "factors": {
                "roadQualityIndex": float(row["road_quality_index"]),
                "accidentHistoryIndex": float(row["accident_history_index"]),
                "potholeDensityPerKm": float(row["pothole_density_per_km"]),
                "surfaceRating": float(row["surface_rating"]),
                "lightingQuality": row["lighting_quality"],
                "encroachmentLevel": row["encroachment_level"],
                "drainageQuality": row["drainage_quality"],
                "accidentCount12mo": int(row["accident_count_12mo"]),
                "fatalAccidentCount12mo": int(row["fatal_accident_count_12mo"]),
                "avgAccidentSeverity": float(row["avg_accident_severity"]),
            },
            "modelBackend": MODEL_BACKEND,
        })

    with open(args.scored_out, "w") as f:
        json.dump(scored_records, f, indent=2)
    print(f"      Scored segments written -> {args.scored_out}  ({len(scored_records)} records)")

    print("\nDone. Next step: run the backend seed script against this JSON file")
    print("  (see seedRoadSegments.js / the deployment guide).")


if __name__ == "__main__":
    main()

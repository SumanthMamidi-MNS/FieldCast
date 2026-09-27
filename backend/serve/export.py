"""Export a region's serving bundle: everything the deployed API needs, precomputed.

Run (after training and evaluation):
    python -m backend.serve.export --region mh_ghats --region ka_ghats

Layout, under `serve_bundle/`:
    <region>/manifest.json          models' metadata, support model, calibration
    <region>/models.npz             flattened trees + occurrence calibrators
    <region>/blocks.json            blocks, block terrain stats, grid points
    <region>/panchayats/<block>.json  GeoJSON outlines + precomputed terrain
    <region>/history/<block>.json   block values per date, for replay
    reports/*.json                  evaluation reports

The bundle is committed so a Vercel deployment needs no training stack, no data
directory and no terrain download at request time.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import typer
from rich.console import Console
from shapely.geometry import mapping

from backend.config import (
    GEOGRAPHIC_CRS,
    PROCESSED_DIR,
    QUANTILES,
    REGIONS,
    REPORT_DIR,
    SERVE_DIR,
    TIERS,
    TRAINING_WINDOW,
    VARIABLES,
)
from backend.pipeline.models.downscaler import MODEL_VERSION, VariableDownscaler
from backend.pipeline.models.numerics import TERRAIN_COLUMNS
from backend.pipeline.models.uncertainty import SupportModel
from backend.serve.trees import TreeEnsemble

app = typer.Typer(add_completion=False)
console = Console()

# ~30 m simplification: invisible at block zoom, cuts GeoJSON size several-fold.
_SIMPLIFY_DEG = 0.0003
_COORD_DECIMALS = 5


def _round_coords(obj):
    if isinstance(obj, float):
        return round(obj, _COORD_DECIMALS)
    if isinstance(obj, list | tuple):
        return [_round_coords(o) for o in obj]
    if isinstance(obj, dict):
        return {k: _round_coords(v) for k, v in obj.items()}
    return obj


def _trained_months() -> list[int]:
    months: set[int] = set()
    for s in TRAINING_WINDOW.train_seasons:
        for d in pd.date_range(s.start, s.end, freq="D"):
            months.add(d.month)
    return sorted(months)


def write_models(
    out_dir: Path,
    models: dict[str, VariableDownscaler],
    support: SupportModel | None,
    scale_calibration: dict,
    region_key: str,
    policy: dict | None = None,
) -> dict:
    """models.npz plus the model half of manifest.json; returns the manifest dict."""
    arrays: dict[str, np.ndarray] = {}
    variables = {}
    for key, model in models.items():
        var = VARIABLES[key]
        for q, booster in model.quantile_models.items():
            arrays.update(TreeEnsemble.from_lightgbm(booster).to_arrays(f"{key}/q{q}"))
        has_occ = model.occurrence_model is not None
        if has_occ:
            arrays.update(TreeEnsemble.from_lightgbm(model.occurrence_model).to_arrays(f"{key}/occ"))
        cal = model.occurrence_calibrator
        if cal is not None:
            arrays[f"{key}/cal_x"] = np.asarray(cal.X_thresholds_, dtype=float)
            arrays[f"{key}/cal_y"] = np.asarray(cal.y_thresholds_, dtype=float)
        calib = scale_calibration.get(key)
        variables[key] = {
            "label": var.label,
            "unit": var.unit,
            "reconcile": var.reconcile,
            "feature_columns": list(model.feature_columns),
            "quantiles": sorted(model.quantile_models),
            "occurrence": has_occ,
            "calibrated_occurrence": cal is not None,
            "scale_factor": float(calib["factor"]) if calib else None,
            "point_is_block": bool((policy or {}).get(key, {}).get("point_is_block", False)),
        }
    out_dir.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out_dir / "models.npz", **arrays)

    region = REGIONS[region_key]
    return {
        "region": region_key,
        "state": region.state_name,
        "districts": list(region.districts),
        "model_version": MODEL_VERSION,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "quantiles": list(QUANTILES),
        "variables": variables,
        "support": None
        if support is None
        else {
            "mean": support.mean.tolist(),
            "inv_cov": support.inv_cov.tolist(),
            "columns": list(support.columns),
            "gauges": [] if support.gauge_coords is None else support.gauge_coords.tolist(),
        },
        "trained_months": _trained_months(),
        "tiers": TIERS,
    }


def write_geography(
    out_dir: Path,
    blocks: gpd.GeoDataFrame,
    panchayats: gpd.GeoDataFrame,
    terrain: pd.DataFrame,
    grid: pd.DataFrame,
    history: pd.DataFrame,
) -> dict:
    """blocks.json, per-block panchayat GeoJSON and history. Returns summary counts.

    `terrain` is indexed by panchayat_id with TERRAIN_COLUMNS. `history` has
    block_id, date, variable key columns. Only blocks that have grid points and
    panchayats are exported: a block the model cannot describe is not served.
    """
    (out_dir / "panchayats").mkdir(parents=True, exist_ok=True)
    (out_dir / "history").mkdir(parents=True, exist_ok=True)
    stats = grid.groupby("block_id").agg(
        mean_elevation_m=("elevation_m", "mean"),
        elevation_spread_m=("elevation_m", "std"),
        mean_exposure=("monsoon_exposure", "mean"),
    )
    stats["elevation_spread_m"] = stats["elevation_spread_m"].fillna(0.0)

    block_rows = []
    for _, b in blocks.iterrows():
        bid = b["block_id"]
        sub = panchayats[panchayats["block_id"] == bid]
        pts = grid[grid["block_id"] == bid]
        if sub.empty or pts.empty or bid not in stats.index:
            continue
        c = b.geometry.representative_point()
        block_rows.append(
            {
                "block_id": bid,
                "block_name": b["block_name"],
                "district": b["district"],
                "state": b["state"],
                "panchayat_count": len(sub),
                "centroid_lat": round(float(c.y), 5),
                "centroid_lon": round(float(c.x), 5),
                "stats": {k: float(v) for k, v in stats.loc[bid].items()},
                "grid": pts[["lat", "lon"]].round(5).to_numpy().tolist(),
            }
        )

        features = []
        for _, p in sub.iterrows():
            geom = p.geometry.simplify(_SIMPLIFY_DEG, preserve_topology=True)
            t = terrain.loc[p["panchayat_id"]]
            features.append(
                {
                    "type": "Feature",
                    "geometry": _round_coords(mapping(geom)),
                    "properties": {
                        "panchayat_id": p["panchayat_id"],
                        "name": str(p["name"]),
                        "unit_type": str(p.get("unit_type", "village_cluster")),
                        "area_km2": round(float(p["area_km2"]), 3),
                        "centroid_lat": round(float(p["centroid_lat"]), 5),
                        "centroid_lon": round(float(p["centroid_lon"]), 5),
                        "terrain": {c: float(t[c]) for c in TERRAIN_COLUMNS},
                    },
                }
            )
        (out_dir / "panchayats" / f"{bid}.json").write_text(
            json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8"
        )

        h = history[history["block_id"] == bid].sort_values("date")
        (out_dir / "history" / f"{bid}.json").write_text(
            json.dumps(
                {
                    "dates": h["date"].dt.strftime("%Y-%m-%d").tolist(),
                    "values": {
                        k: [None if pd.isna(v) else round(float(v), 3) for v in h[k]]
                        for k in VARIABLES
                        if k in h
                    },
                }
            ),
            encoding="utf-8",
        )

    (out_dir / "blocks.json").write_text(json.dumps(block_rows), encoding="utf-8")
    return {"blocks": len(block_rows), "panchayats": int(sum(r["panchayat_count"] for r in block_rows))}


def assign_grid_to_blocks(
    blocks: gpd.GeoDataFrame, grid: pd.DataFrame, k_nearest: int = 3
) -> pd.DataFrame:
    """Grid points describing each block: its own points, or the nearest few.

    Small blocks can fall between the ~16 km grid points. Rather than leave them
    unserved, they borrow their `k_nearest` closest points (by block centroid)
    for terrain statistics, live forecasts and replay history.
    """
    own = grid[["lat", "lon", "block_id", "elevation_m", "monsoon_exposure"]]
    have = set(own["block_id"])
    extra = []
    scale = np.cos(np.radians(grid["lat"].mean()))
    for _, b in blocks.iterrows():
        if b["block_id"] in have:
            continue
        c = b.geometry.representative_point()
        d = np.hypot(grid["lat"] - c.y, (grid["lon"] - c.x) * scale)
        near = own.iloc[np.argsort(d.to_numpy())[:k_nearest]].copy()
        near["block_id"] = b["block_id"]
        extra.append(near)
    return pd.concat([own, *extra], ignore_index=True) if extra else own.copy()


def _history_table(region_key: str, assigned: pd.DataFrame) -> pd.DataFrame:
    """Block value per (block, date): the mean of the block's assigned points."""
    frames = []
    keys = assigned[["lat", "lon", "block_id"]].copy()
    keys["_lat"] = keys["lat"].round(4)
    keys["_lon"] = keys["lon"].round(4)
    for key in VARIABLES:
        path = PROCESSED_DIR / f"features_{region_key}_{key}.parquet"
        if not path.exists():
            continue
        vals = pd.read_parquet(path, columns=["lat", "lon", "date", "local_value"])
        vals["_lat"] = vals["lat"].round(4)
        vals["_lon"] = vals["lon"].round(4)
        merged = vals.merge(keys[["_lat", "_lon", "block_id"]], on=["_lat", "_lon"])
        frames.append(merged.groupby(["block_id", "date"])["local_value"].mean().rename(key))
    if not frames:
        raise FileNotFoundError(f"no feature tables for {region_key}; train first")
    out = pd.concat(frames, axis=1).reset_index()
    out["date"] = pd.to_datetime(out["date"])
    return out


def export_region(region_key: str) -> dict:
    from backend.pipeline.geo.terrain import terrain_features
    from backend.pipeline.models.predictor import Predictor

    predictor = Predictor.load(region_key)
    out_dir = SERVE_DIR / region_key
    if out_dir.exists():
        shutil.rmtree(out_dir)

    manifest = write_models(
        out_dir,
        predictor.models,
        predictor.support,
        predictor.scale_calibration,
        region_key,
        predictor.policy,
    )

    blocks = gpd.read_parquet(PROCESSED_DIR / f"blocks_{region_key}.parquet").to_crs(GEOGRAPHIC_CRS)
    pch = gpd.read_parquet(PROCESSED_DIR / f"panchayats_{region_key}.parquet").to_crs(GEOGRAPHIC_CRS)
    console.print(f"  terrain for {len(pch)} panchayats (DEM tiles)...")
    terrain = terrain_features(pch["centroid_lat"].tolist(), pch["centroid_lon"].tolist())
    terrain.index = pch["panchayat_id"].to_numpy()

    assigned = assign_grid_to_blocks(blocks, predictor.grid)
    history = _history_table(region_key, assigned)
    counts = write_geography(out_dir, blocks, pch, terrain, assigned, history)
    manifest["history_range"] = [
        history["date"].min().strftime("%Y-%m-%d"),
        history["date"].max().strftime("%Y-%m-%d"),
    ]
    manifest["counts"] = counts
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return counts


def export_reports() -> int:
    dest = SERVE_DIR / "reports"
    dest.mkdir(parents=True, exist_ok=True)
    n = 0
    for path in REPORT_DIR.glob("evaluation_*.json"):
        shutil.copy2(path, dest / path.name)
        n += 1
    return n


@app.command()
def run(region: list[str] = typer.Option(["mh_ghats"], help="Regions to export")) -> None:
    for key in region:
        console.print(f"[bold]Exporting {key}[/bold]")
        counts = export_region(key)
        console.print(f"  [green]{counts}[/green]")
    console.print(f"reports copied: {export_reports()}")
    size = sum(p.stat().st_size for p in SERVE_DIR.rglob("*") if p.is_file())
    console.print(f"bundle size: {size / 1e6:.1f} MB at {SERVE_DIR}")


if __name__ == "__main__":
    app()

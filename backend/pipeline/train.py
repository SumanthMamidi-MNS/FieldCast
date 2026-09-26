"""Training orchestration: raw sources to persisted models.

Run:
    python -m backend.pipeline.train --region mh_ghats
    python -m backend.pipeline.train --region mh_ghats --quick   # smoke test

The `--quick` path uses a short window so the whole pipeline can be exercised
end-to-end in a couple of minutes. It is for wiring verification only; numbers
from a quick run are not reportable and the CLI says so on every run.
"""

from __future__ import annotations

import json
from datetime import datetime

import geopandas as gpd
import numpy as np
import pandas as pd
import typer
from rich.console import Console
from rich.table import Table

from backend.config import (
    ARTIFACT_DIR,
    GEOGRAPHIC_CRS,
    PROCESSED_DIR,
    REGIONS,
    TRAINING_WINDOW,
    VARIABLES,
    Region,
)
from backend.pipeline.features.build import (
    FEATURE_COLUMNS,
    TERRAIN_COLUMNS,
    add_block_context,
    add_temporal_features,
    assert_no_leakage,
    era5_grid_points,
    spatial_temporal_split,
)
from backend.pipeline.geo.terrain import compute_terrain, distance_to_coast_km
from backend.pipeline.models.downscaler import MODEL_VERSION, VariableDownscaler
from backend.pipeline.models.uncertainty import SupportModel
from backend.pipeline.sources.open_meteo import fetch_daily_weather, fetch_elevation

app = typer.Typer(add_completion=False)
console = Console()


# --------------------------------------------------------------------------
# Grid construction
# --------------------------------------------------------------------------
def build_grid_for_region(blocks: gpd.GeoDataFrame, step_deg: float = 0.1) -> pd.DataFrame:
    """ERA5-lattice points that fall inside the region's blocks.

    Points outside the block polygons are dropped: sampling the Arabian Sea would
    add rows with no terrain signal and drag every block mean toward a maritime
    value that no panchayat experiences.
    """
    lats, lons = era5_grid_points(tuple(blocks.total_bounds), step_deg=step_deg)
    pts = gpd.GeoDataFrame(
        {"lat": lats, "lon": lons},
        geometry=gpd.points_from_xy(lons, lats),
        crs=GEOGRAPHIC_CRS,
    )
    joined = gpd.sjoin(
        pts, blocks[["block_id", "block_name", "district", "geometry"]], how="inner", predicate="within"
    )
    out = pd.DataFrame(joined.drop(columns=["geometry", "index_right"]))
    return out.drop_duplicates(subset=["lat", "lon"]).reset_index(drop=True)


def attach_terrain(points: pd.DataFrame) -> pd.DataFrame:
    """Terrain covariates for every grid point, via the batched elevation API."""
    console.print(f"  sampling terrain for {len(points)} points ({len(points) * 9} lookups)...")

    def sampler(lats, lons):
        return fetch_elevation(list(lats), list(lons))["elevation_m"].to_numpy()

    terrain = compute_terrain(points["lat"].tolist(), points["lon"].tolist(), sampler)
    terrain["distance_to_coast_km"] = distance_to_coast_km(
        points["lat"].to_numpy(), points["lon"].to_numpy()
    )
    return pd.concat([points.reset_index(drop=True), terrain.reset_index(drop=True)], axis=1)


def fetch_weather_panel(
    points: pd.DataFrame, seasons: tuple[tuple[str, str], ...]
) -> pd.DataFrame:
    """Daily ERA5 for every grid point, one request series per season.

    Seasons are fetched separately so each caches independently: a run that hits
    the daily API budget part-way resumes from the cache on the next attempt.
    """
    daily_vars = [v.open_meteo_daily for v in VARIABLES.values()]
    frames = []
    for start, end in seasons:
        console.print(
            f"  fetching {len(daily_vars)} variables x {len(points)} points, {start} to {end}..."
        )
        frames.append(
            fetch_daily_weather(
                points["lat"].tolist(), points["lon"].tolist(), start, end, daily_vars=daily_vars
            )
        )
    return pd.concat(frames, ignore_index=True)


def assemble_panel(points_with_terrain: pd.DataFrame, weather: pd.DataFrame) -> pd.DataFrame:
    """Join weather onto terrain-bearing points, one row per (point, day, variable)."""
    pts = points_with_terrain.copy()
    pts["_lat_k"] = pts["lat"].round(3)
    pts["_lon_k"] = pts["lon"].round(3)

    wx = weather.copy()
    wx["_lat_k"] = wx["lat"].round(3)
    wx["_lon_k"] = wx["lon"].round(3)
    wx = wx.drop(columns=["lat", "lon"])

    merged = wx.merge(pts, on=["_lat_k", "_lon_k"], how="inner")
    if merged.empty:
        raise ValueError("weather and terrain point sets did not intersect")
    return merged.drop(columns=["_lat_k", "_lon_k"])


def variable_table(panel: pd.DataFrame, variable_key: str) -> pd.DataFrame:
    """Feature table for one variable, with block context and temporal features."""
    var = VARIABLES[variable_key]
    sub = panel[panel["variable"] == var.open_meteo_daily].copy()
    if sub.empty:
        raise ValueError(f"no rows for {var.open_meteo_daily}")

    sub = sub.rename(columns={"value": "local_value"}).dropna(subset=["local_value"])
    sub = add_block_context(sub)
    sub = add_temporal_features(sub)

    keep = ["date", "lat", "lon", "block_id", "local_value", *FEATURE_COLUMNS]
    return sub[keep].dropna(subset=FEATURE_COLUMNS).reset_index(drop=True)


# --------------------------------------------------------------------------
# Training
# --------------------------------------------------------------------------
def train_region(
    region: Region, seasons: tuple[tuple[str, str], ...], step_deg: float, quick: bool
) -> dict:
    blocks = gpd.read_parquet(PROCESSED_DIR / f"blocks_{region.key}.parquet")
    console.print(f"[bold]Region {region.key}[/bold]: {len(blocks)} blocks")

    points = build_grid_for_region(blocks, step_deg=step_deg)
    console.print(f"  {len(points)} ERA5 grid points inside the blocks")
    if len(points) < 30:
        raise ValueError(
            f"only {len(points)} grid points inside the region; too few to train on. "
            "Check the block geometry or reduce step_deg."
        )

    points = attach_terrain(points)
    weather = fetch_weather_panel(points, seasons)
    panel = assemble_panel(points, weather)
    console.print(f"  assembled panel: {len(panel):,} (point, day, variable) rows")

    artifact_root = ARTIFACT_DIR / region.key
    artifact_root.mkdir(parents=True, exist_ok=True)

    summary: dict = {
        "region": region.key,
        "model_version": MODEL_VERSION,
        "trained_at": datetime.now().isoformat(timespec="seconds"),
        "seasons": [list(s) for s in seasons],
        "quick_run": quick,
        "n_grid_points": len(points),
        "n_blocks": int(blocks["block_id"].nunique()),
        "variables": {},
    }

    for key in VARIABLES:
        console.print(f"\n[cyan]Training {key}[/cyan]")
        try:
            table = variable_table(panel, key)
        except ValueError as exc:
            console.print(f"  [yellow]skipped: {exc}[/yellow]")
            summary["variables"][key] = {"status": "skipped", "reason": str(exc)}
            continue

        train, valid, test = spatial_temporal_split(
            table, test_years=(() if quick else TRAINING_WINDOW.test_years)
        )
        if quick and len(test) == 0:
            # In a short window there may be no held-out year; carve the tail off
            # by date so the smoke run still exercises the evaluation path. Leave
            # an embargo gap, since adjacent days are strongly autocorrelated.
            cutoff = table["date"].quantile(0.8)
            embargo = pd.Timedelta(days=3)
            test = table[table["date"] > cutoff + embargo].copy()
            train = train[train["date"] <= cutoff]
            valid = valid[valid["date"] <= cutoff]

        if len(train) < 200 or len(valid) < 50:
            console.print(
                f"  [yellow]skipped: insufficient data (train={len(train)}, valid={len(valid)})[/yellow]"
            )
            summary["variables"][key] = {"status": "skipped", "reason": "insufficient data"}
            continue

        assert_no_leakage(train, valid, test)

        model = VariableDownscaler(VARIABLES[key])
        result = model.fit(train, valid, FEATURE_COLUMNS)
        model.save(artifact_root / key)

        console.print(
            f"  train={len(train):,} valid={len(valid):,} test={len(test):,}"
            + (f"  occurrence AUC={result.occurrence_auc:.3f}" if result.occurrence_auc else "")
        )
        for note in result.notes:
            console.print(f"  [yellow]note: {note}[/yellow]")

        summary["variables"][key] = {
            "status": "trained",
            "n_train": len(train),
            "n_valid": len(valid),
            "n_test": len(test),
            "occurrence_auc": result.occurrence_auc,
            "best_iterations": result.best_iterations,
            "notes": result.notes,
            "top_features": model.feature_importance().head(5).to_dict("records"),
        }

        table.to_parquet(PROCESSED_DIR / f"features_{region.key}_{key}.parquet", index=False)

    _fit_and_save_support(points, artifact_root)
    points.to_parquet(PROCESSED_DIR / f"grid_{region.key}.parquet", index=False)

    (artifact_root / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def build_features_only(
    region: Region, seasons: tuple[tuple[str, str], ...], step_deg: float
) -> dict[str, int]:
    """Grid, terrain and per-variable feature tables, with no model training.

    Used for the transfer region: Karnataka must be evaluated by models that
    never saw it, so we build its inputs and deliberately stop before fitting.
    """
    blocks = gpd.read_parquet(PROCESSED_DIR / f"blocks_{region.key}.parquet")
    points = attach_terrain(build_grid_for_region(blocks, step_deg=step_deg))
    panel = assemble_panel(points, fetch_weather_panel(points, seasons))
    points.to_parquet(PROCESSED_DIR / f"grid_{region.key}.parquet", index=False)
    counts = {}
    for key in VARIABLES:
        table = variable_table(panel, key)
        table.to_parquet(PROCESSED_DIR / f"features_{region.key}_{key}.parquet", index=False)
        counts[key] = len(table)
    return counts


def _fit_and_save_support(points: pd.DataFrame, artifact_root) -> None:
    """Fit the training-manifold description used for epistemic support scoring."""
    cols = [c for c in TERRAIN_COLUMNS if c in points.columns]
    feats = points[cols].to_numpy(dtype=float)
    feats = feats[np.isfinite(feats).all(axis=1)]
    if feats.shape[0] < 2:
        console.print("  [yellow]support model skipped: not enough complete terrain rows[/yellow]")
        return

    model = SupportModel.fit(feats, cols)
    np.savez(
        artifact_root / "support.npz",
        mean=model.mean,
        inv_cov=model.inv_cov,
        columns=np.array(cols, dtype=object),
    )


def load_support_model(region_key: str, gauge_coords: np.ndarray | None = None) -> SupportModel:
    data = np.load(ARTIFACT_DIR / region_key / "support.npz", allow_pickle=True)
    return SupportModel(
        mean=data["mean"],
        inv_cov=data["inv_cov"],
        columns=list(data["columns"]),
        gauge_coords=gauge_coords,
    )


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
@app.command()
def run(
    region: str = typer.Option("mh_ghats", help="Region key from config.REGIONS"),
    quick: bool = typer.Option(False, help="One-season smoke test; numbers are NOT reportable"),
    step_deg: float = typer.Option(
        TRAINING_WINDOW.grid_step_deg, help="Fine grid spacing in degrees"
    ),
) -> None:
    if region not in REGIONS:
        raise typer.BadParameter(f"unknown region {region!r}; have {sorted(REGIONS)}")

    cfg = REGIONS[region]
    if cfg.is_transfer:
        # Transfer regions are never trained on; only the test season is needed.
        test_seasons = tuple(
            s for s in TRAINING_WINDOW.seasons if int(s[0][:4]) in TRAINING_WINDOW.test_years
        )
        counts = build_features_only(cfg, test_seasons, step_deg)
        console.print(f"[green]transfer features built (no training):[/green] {counts}")
        return

    if quick:
        seasons: tuple[tuple[str, str], ...] = (("2022-06-01", "2022-09-30"),)
        console.print("[yellow]QUICK RUN — wiring verification only, numbers are not reportable[/yellow]")
    else:
        seasons = TRAINING_WINDOW.seasons

    summary = train_region(REGIONS[region], seasons, step_deg, quick)

    table = Table(title=f"Training summary — {region}")
    table.add_column("variable")
    table.add_column("status")
    table.add_column("train", justify="right")
    table.add_column("test", justify="right")
    table.add_column("occ. AUC", justify="right")
    for key, info in summary["variables"].items():
        table.add_row(
            key,
            info["status"],
            f"{info.get('n_train', 0):,}",
            f"{info.get('n_test', 0):,}",
            f"{info['occurrence_auc']:.3f}" if info.get("occurrence_auc") else "-",
        )
    console.print(table)
    console.print(f"artifacts: {ARTIFACT_DIR / region}")


if __name__ == "__main__":
    app()

"""Evaluation runner: model vs baselines, at T1 (dense field) and T2 (real gauges).

Run:
    python -m backend.pipeline.evaluate.run --region mh_ghats
    python -m backend.pipeline.evaluate.run --region ka_transfer --model-region mh_ghats

Reporting rules this module enforces:

- Every skill score comes with a cluster-bootstrap 90% interval (clusters are
  blocks at T1, stations at T2). With 9 gauges, a point estimate alone would
  overstate what the data can support.
- Losses are reported exactly like wins. If a variable does not beat the naive
  baseline, the report says so in the verdict column.
- The interval evaluated is the one the API publishes (support-inflated), not
  the raw quantile spread, so calibration numbers describe what users actually see.
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

from backend.app.schemas import Tier
from backend.config import (
    GEOGRAPHIC_CRS,
    PROCESSED_DIR,
    REGIONS,
    REPORT_DIR,
    TRAINING_WINDOW,
    VARIABLES,
    WET_DAY_THRESHOLD_MM,
)
from backend.pipeline.evaluate.baselines import idw_interpolation, lapse_rate_correction
from backend.pipeline.evaluate.metrics import (
    interval_coverage,
    occurrence_metrics,
    pit_uniformity,
    pit_values,
    point_metrics,
    skill_score,
)
from backend.pipeline.features.build import spatial_temporal_split
from backend.pipeline.geo.terrain import compute_terrain, distance_to_coast_km
from backend.pipeline.models.predictor import Predictor, build_target_features
from backend.pipeline.models.reconcile import reconcile

app = typer.Typer(add_completion=False)
console = Console()

_N_BOOT = 500
_TEMPERATURE_VARS = {"tmax", "tmin"}


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def cluster_bootstrap_skill(
    y: np.ndarray,
    model: np.ndarray,
    base: np.ndarray,
    clusters: np.ndarray,
    n_boot: int = _N_BOOT,
    seed: int = 0,
) -> tuple[float, float]:
    """90% interval on MAE skill, resampling whole clusters.

    Rows within a block (or at one gauge) are correlated, so resampling rows would
    give an interval far narrower than the evidence justifies.
    """
    rng = np.random.default_rng(seed)
    uniq = np.unique(clusters)
    if uniq.size < 3:
        return float("nan"), float("nan")

    err_m = np.abs(model - y)
    err_b = np.abs(base - y)
    df = pd.DataFrame({"c": clusters, "m": err_m, "b": err_b})
    sums = df.groupby("c").agg(m=("m", "sum"), b=("b", "sum"))

    m_arr, b_arr = sums["m"].to_numpy(), sums["b"].to_numpy()
    skills = []
    for _ in range(n_boot):
        idx = rng.integers(0, uniq.size, uniq.size)
        b = b_arr[idx].sum()
        if b > 0:
            skills.append(1.0 - m_arr[idx].sum() / b)
    if not skills:
        return float("nan"), float("nan")
    return float(np.percentile(skills, 5)), float(np.percentile(skills, 95))


def reconcile_by_group(
    values: np.ndarray, block_value: np.ndarray, groups: pd.Series, mode: str
) -> np.ndarray:
    """Apply block-mean reconciliation within each (block, day) group."""
    out = np.asarray(values, dtype=float).copy()
    for _, idx in groups.groupby(groups).groups.items():
        i = np.asarray(list(idx))
        out[i] = reconcile(out[i], np.ones(i.size), float(block_value[i[0]]), mode)
    return out


def _verdict(skill: float, lo: float) -> str:
    if not np.isfinite(skill):
        return "not evaluable"
    if skill > 0 and np.isfinite(lo) and lo > 0:
        return "beats naive (significant)"
    if skill > 0:
        return "beats naive (not significant)"
    return "does NOT beat naive"


def _variable_report(
    key: str,
    y: np.ndarray,
    pred: dict,
    block_value: np.ndarray,
    clusters: np.ndarray,
    extra_baselines: dict[str, np.ndarray],
    reconciled: np.ndarray | None = None,
) -> dict:
    var = VARIABLES[key]
    median = pred["median"]
    m = point_metrics(y, median)
    naive = point_metrics(y, block_value)
    s = skill_score(m.mae, naive.mae)
    lo, hi = cluster_bootstrap_skill(y, median, block_value, clusters)

    cov, width = interval_coverage(y, pred["lower"], pred["upper"])
    pit = pit_uniformity(pit_values(y, {0.1: pred["lower"], 0.5: median, 0.9: pred["upper"]}))

    out: dict = {
        "variable": key,
        "label": var.label,
        "unit": var.unit,
        "n": m.n,
        "n_clusters": int(np.unique(clusters).size),
        "model_mae": m.mae,
        "model_rmse": m.rmse,
        "model_bias": m.bias,
        "naive_mae": naive.mae,
        "naive_rmse": naive.rmse,
        "skill_vs_naive": s,
        "skill_ci90": [lo, hi],
        "verdict": _verdict(s, lo),
        "interval_coverage_80": cov,
        "interval_width": width,
        "pit_ks": pit,
        "mean_support": float(np.nanmean(pred["support_score"])),
        "baselines": {},
    }
    for name, values in extra_baselines.items():
        bm = point_metrics(y, values)
        out["baselines"][name] = {
            "mae": bm.mae,
            "model_skill_vs_this": skill_score(m.mae, bm.mae),
        }
    if reconciled is not None:
        rm = point_metrics(y, reconciled)
        out["reconciled_mae"] = rm.mae
        out["reconciled_skill_vs_naive"] = skill_score(rm.mae, naive.mae)

    if var.two_stage and pred.get("occurrence") is not None:
        wet = (y >= WET_DAY_THRESHOLD_MM).astype(float)
        occ = occurrence_metrics(wet, pred["occurrence"])
        # Naive occurrence: "it rains here iff the block value says it rained".
        naive_occ = (block_value >= WET_DAY_THRESHOLD_MM).astype(float)
        naive_brier = float(np.mean((naive_occ - wet) ** 2))
        out["occurrence"] = {
            "brier": occ.brier,
            "brier_skill_vs_climatology": occ.brier_skill,
            "brier_naive_block": naive_brier,
            "base_rate": occ.base_rate,
            "reliability": occ.reliability,
        }
    return out


# --------------------------------------------------------------------------
# T1: held-out season on the dense field
# --------------------------------------------------------------------------
def evaluate_t1(region_key: str, predictor: Predictor, transfer: bool) -> dict:
    grid = predictor.grid
    centroids = grid.groupby("block_id")[["lat", "lon"]].mean()
    results = {}

    for key in predictor.models:
        path = PROCESSED_DIR / f"features_{region_key}_{key}.parquet"
        if not path.exists():
            console.print(f"  [yellow]{key}: no feature table at {path.name}[/yellow]")
            continue
        table = pd.read_parquet(path)
        # On a transfer region every row is out-of-sample; otherwise the held-out season.
        test = table if transfer else spatial_temporal_split(table)[2]
        if test.empty:
            continue
        test = test.reset_index(drop=True)

        pred = predictor.predict_variable(key, test, Tier.T1)
        y = test["local_value"].to_numpy(dtype=float)
        bv = test["block_value"].to_numpy(dtype=float)

        # B1: IDW of block values located at block centroids, per day.
        idw = np.full(len(test), np.nan)
        day_blocks = test.groupby(["date", "block_id"])["block_value"].first().reset_index()
        for date, idx in test.groupby("date").groups.items():
            src = day_blocks[day_blocks["date"] == date].join(centroids, on="block_id")
            rows = np.asarray(list(idx))
            idw[rows] = idw_interpolation(
                test.loc[rows, "lat"].to_numpy(),
                test.loc[rows, "lon"].to_numpy(),
                src["lat"].to_numpy(),
                src["lon"].to_numpy(),
                src["block_value"].to_numpy(),
            )
        extra = {"B1_idw": idw}
        if key in _TEMPERATURE_VARS:
            extra["B2_lapse_rate"] = lapse_rate_correction(bv, test["elevation_anomaly_m"])

        groups = test["block_id"].astype(str) + "|" + test["date"].astype(str)
        reconciled = reconcile_by_group(pred["median"], bv, groups, VARIABLES[key].reconcile)

        results[key] = _variable_report(
            key, y, pred, bv, test["block_id"].to_numpy(), extra, reconciled
        )
        console.print(
            f"  T1 {key}: skill vs naive {results[key]['skill_vs_naive']:+.3f} "
            f"(n={results[key]['n']:,}, {results[key]['verdict']})"
        )
    return results


# --------------------------------------------------------------------------
# T2: real gauges
# --------------------------------------------------------------------------
def _station_terrain(stations: pd.DataFrame) -> pd.DataFrame:
    from backend.pipeline.sources.open_meteo import fetch_elevation

    def sampler(lats, lons):
        return fetch_elevation(list(lats), list(lons))["elevation_m"].to_numpy()

    terr = compute_terrain(stations["latitude"].tolist(), stations["longitude"].tolist(), sampler)
    terr["distance_to_coast_km"] = distance_to_coast_km(
        stations["latitude"].to_numpy(), stations["longitude"].to_numpy()
    )
    # Use DEM elevation, not the station inventory's surveyed value, so gauge
    # features are built exactly like the training grid's.
    base = stations.drop(columns=["elevation_m"], errors="ignore").reset_index(drop=True)
    return pd.concat([base, terr], axis=1)


def evaluate_t2(region_key: str, predictor: Predictor, test_only: bool = True) -> dict:
    from backend.pipeline.sources.ghcn import load_station_daily

    st_path = PROCESSED_DIR / f"stations_{region_key}.parquet"
    if not st_path.exists():
        console.print("  [yellow]no station index; T2 skipped[/yellow]")
        return {}
    stations = pd.read_parquet(st_path)
    blocks = gpd.read_parquet(PROCESSED_DIR / f"blocks_{region_key}.parquet")

    pts = gpd.GeoDataFrame(
        stations,
        geometry=gpd.points_from_xy(stations["longitude"], stations["latitude"]),
        crs=GEOGRAPHIC_CRS,
    )
    inside = gpd.sjoin(pts, blocks[["block_id", "geometry"]], how="inner", predicate="within")
    inside = pd.DataFrame(inside.drop(columns=["geometry", "index_right"]))
    inside = inside[~inside["station_id"].duplicated()]
    inside = inside[inside["block_id"].isin(predictor.stats.index)].reset_index(drop=True)
    if inside.empty:
        console.print("  [yellow]no gauges fall inside a modelled block; T2 skipped[/yellow]")
        return {}
    console.print(f"  {len(inside)} gauges inside modelled blocks")

    inside = _station_terrain(inside)

    seasons = TRAINING_WINDOW.seasons
    test_years = set(TRAINING_WINDOW.test_years)
    elements = sorted({v.ghcn_element for v in VARIABLES.values() if v.ghcn_element})
    obs = load_station_daily(
        inside["station_id"].tolist(), seasons[0][0], seasons[-1][1], elements=elements
    )
    obs["date"] = pd.to_datetime(obs["date"])
    obs = obs[obs["date"].dt.month.isin(TRAINING_WINDOW.months)]
    if test_only:
        obs = obs[obs["date"].dt.year.isin(test_years)]

    results = {}
    for key, var in VARIABLES.items():
        if var.ghcn_element is None or key not in predictor.models:
            continue
        table_path = PROCESSED_DIR / f"features_{region_key}_{key}.parquet"
        if not table_path.exists():
            continue
        bvals = (
            pd.read_parquet(table_path, columns=["block_id", "date", "block_value"])
            .groupby(["block_id", "date"])["block_value"]
            .first()
            .reset_index()
        )
        bvals["date"] = pd.to_datetime(bvals["date"])

        o = obs[obs["element"] == var.ghcn_element][["station_id", "date", "value"]]
        rows = o.merge(inside, on="station_id").merge(bvals, on=["block_id", "date"])
        rows = rows.dropna(subset=["value", "block_value"])
        if len(rows) < 30:
            console.print(f"  [yellow]T2 {key}: only {len(rows)} gauge-days; skipped[/yellow]")
            continue

        targets = rows.rename(columns={"latitude": "lat", "longitude": "lon"})
        feats = build_target_features(
            targets.drop(columns=["block_value", "date"]),
            predictor.stats,
            targets["block_value"].to_numpy(),
            targets["date"],
        )
        pred = predictor.predict_variable(key, feats, Tier.T2)
        y = rows["value"].to_numpy(dtype=float)
        bv = rows["block_value"].to_numpy(dtype=float)
        extra = {}
        if key in _TEMPERATURE_VARS:
            extra["B2_lapse_rate"] = lapse_rate_correction(bv, feats["elevation_anomaly_m"])
        results[key] = _variable_report(
            key, y, pred, bv, rows["station_id"].to_numpy(), extra
        )
        console.print(
            f"  T2 {key}: skill vs naive {results[key]['skill_vs_naive']:+.3f} "
            f"(n={results[key]['n']:,} gauge-days at {results[key]['n_clusters']} gauges, "
            f"{results[key]['verdict']})"
        )
    return results


# --------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------
def _fmt(x: float, nd: int = 3) -> str:
    return "-" if x is None or not np.isfinite(x) else f"{x:.{nd}f}"


def write_markdown(report: dict, path) -> None:
    lines = [
        f"# Evaluation — {report['region']}",
        "",
        f"Models trained on: `{report['model_region']}` · generated {report['generated_at']}",
        "",
        "Skill = 1 - MAE(model)/MAE(naive block copy). Positive beats naive. "
        "CI is a 90% cluster bootstrap (blocks at T1, gauges at T2). "
        "Coverage is for the published 80% interval (target ≈ 0.80).",
        "",
    ]
    for tier, title in (("T1", "T1 — held-out season, dense field (~16 km)"),
                        ("T2", "T2 — real GHCN rain gauges (never used in training)")):
        res = report.get(tier, {})
        lines += [f"## {title}", ""]
        if not res:
            lines += ["_Not evaluable for this region (no data)._", ""]
            continue
        lines += [
            "| Variable | n | MAE model | MAE naive | Skill | 90% CI | Coverage 80% | Verdict |",
            "|---|---:|---:|---:|---:|---|---:|---|",
        ]
        for r in res.values():
            ci = r["skill_ci90"]
            lines.append(
                f"| {r['label']} ({r['unit']}) | {r['n']:,} | {_fmt(r['model_mae'], 2)} | "
                f"{_fmt(r['naive_mae'], 2)} | {_fmt(r['skill_vs_naive'])} | "
                f"[{_fmt(ci[0])}, {_fmt(ci[1])}] | {_fmt(r['interval_coverage_80'], 2)} | "
                f"{r['verdict']} |"
            )
        lines.append("")
        other = [(r["label"], n, b) for r in res.values() for n, b in r["baselines"].items()]
        if other:
            lines += ["Other baselines (skill of the model against each):", ""]
            for label, name, b in other:
                lines.append(f"- {label} vs {name}: MAE {_fmt(b['mae'], 2)}, "
                             f"model skill {_fmt(b['model_skill_vs_this'])}")
            lines.append("")
        occ = [(r["label"], r["occurrence"]) for r in res.values() if "occurrence" in r]
        for label, o in occ:
            lines += [
                f"{label} occurrence: Brier {_fmt(o['brier'])} vs naive-block {_fmt(o['brier_naive_block'])}, "
                f"Brier skill vs climatology {_fmt(o['brier_skill_vs_climatology'])} "
                f"(wet-day base rate {_fmt(o['base_rate'], 2)}).",
                "",
            ]
    path.write_text("\n".join(lines), encoding="utf-8")


@app.command()
def run(
    region: str = typer.Option("mh_ghats"),
    model_region: str = typer.Option("", help="Region whose models to use (transfer test)"),
    all_seasons_t2: bool = typer.Option(False, help="Use every season at gauges, not just the test season"),
) -> None:
    if region not in REGIONS:
        raise typer.BadParameter(f"unknown region {region!r}")
    model_region = model_region or region
    transfer = model_region != region

    predictor = Predictor.load(region, model_region_key=model_region)
    console.print(f"[bold]Evaluating {region}[/bold] with models from {model_region}")

    report = {
        "region": region,
        "model_region": model_region,
        "transfer": transfer,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "T1": evaluate_t1(region, predictor, transfer),
        "T2": evaluate_t2(region, predictor, test_only=not all_seasons_t2),
    }

    stem = f"evaluation_{region}" + (f"_from_{model_region}" if transfer else "")
    (REPORT_DIR / f"{stem}.json").write_text(json.dumps(report, indent=2, default=float), encoding="utf-8")
    write_markdown(report, REPORT_DIR / f"{stem}.md")

    table = Table(title=f"Skill vs naive — {region}")
    for c in ("tier", "variable", "n", "skill", "90% CI", "coverage", "verdict"):
        table.add_column(c)
    for tier in ("T1", "T2"):
        for r in report[tier].values():
            table.add_row(
                tier, r["variable"], f"{r['n']:,}", _fmt(r["skill_vs_naive"]),
                f"[{_fmt(r['skill_ci90'][0])}, {_fmt(r['skill_ci90'][1])}]",
                _fmt(r["interval_coverage_80"], 2), r["verdict"],
            )
    console.print(table)
    console.print(f"report: {REPORT_DIR / (stem + '.md')}")


if __name__ == "__main__":
    app()

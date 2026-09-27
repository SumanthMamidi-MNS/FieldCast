"""Evaluation runner: model vs baselines, at T1 (dense field) and T2 (real gauges).

Run:
    python -m backend.pipeline.evaluate.run --region mh_ghats
    python -m backend.pipeline.evaluate.run --region ka_ghats --model-region mh_ghats

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
    ARTIFACT_DIR,
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
from backend.pipeline.geo.terrain import terrain_features
from backend.pipeline.models.downscaler import mixture_quantiles
from backend.pipeline.models.predictor import Predictor, build_target_features
from backend.pipeline.models.reconcile import reconcile, reconcile_two_stage

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


# Below this many independent clusters a bootstrap interval is not trustworthy,
# so we refuse to call a result significant however the interval looks.
_MIN_CLUSTERS_FOR_SIGNIFICANCE = 8


def _add_policy(report: dict, predictor: Predictor, key: str, y: np.ndarray, pred: dict) -> None:
    """Record the serving policy and the model's own (pre-policy) skill.

    When the policy serves the block value, the headline skill is exactly 0 by
    construction; the raw model skill shows what the model alone would have done.
    """
    policy = predictor.policy.get(key, {})
    report["point_is_block"] = bool(policy.get("point_is_block", False))
    report["validation_served_skill"] = policy.get("validation_served_skill")
    raw = pred.get("raw_quantiles", {}).get(0.5)
    if raw is not None:
        report["raw_model_skill_vs_naive"] = skill_score(point_metrics(y, raw).mae, report["naive_mae"])


def reconcile_two_stage_by_group(
    conditional: dict[float, np.ndarray],
    occurrence: np.ndarray,
    block_value: np.ndarray,
    groups: pd.Series,
) -> np.ndarray:
    """Served rainfall median after expected-value reconciliation, per (block, day)."""
    out = np.zeros(len(groups))
    for _, idx in groups.groupby(groups).groups.items():
        i = np.asarray(list(idx))
        cond = {q: v[i] for q, v in conditional.items()}
        cond = reconcile_two_stage(cond, occurrence[i], np.ones(i.size), float(block_value[i[0]]))
        out[i] = mixture_quantiles(cond, occurrence[i])[0.5]
    return out


def _verdict(skill: float, lo: float, n_clusters: int) -> str:
    if not np.isfinite(skill):
        return "not evaluable"
    if n_clusters < _MIN_CLUSTERS_FOR_SIGNIFICANCE:
        return (
            f"{'beats' if skill > 0 else 'does NOT beat'} naive "
            f"(only {n_clusters} gauges: significance not testable)"
        )
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
        "verdict": _verdict(s, lo, int(np.unique(clusters).size)),
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
        # Always the held-out test seasons, so a transfer run and the region's own
        # model are scored on exactly the same days.
        test = spatial_temporal_split(table)[2]
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
        if predictor.policy.get(key, {}).get("point_is_block"):
            reconciled = bv.copy()
        elif pred.get("conditional") is not None:
            reconciled = reconcile_two_stage_by_group(
                pred["conditional"], pred["occurrence"], bv, groups
            )
        else:
            reconciled = reconcile_by_group(pred["median"], bv, groups, VARIABLES[key].reconcile)

        results[key] = _variable_report(
            key, y, pred, bv, test["block_id"].to_numpy(), extra, reconciled
        )
        _add_policy(results[key], predictor, key, y, pred)
        console.print(
            f"  T1 {key}: skill vs naive {results[key]['skill_vs_naive']:+.3f} "
            f"(n={results[key]['n']:,}, {results[key]['verdict']})"
        )
    return results


# --------------------------------------------------------------------------
# T2: real gauges
# --------------------------------------------------------------------------
def _station_terrain(stations: pd.DataFrame) -> pd.DataFrame:
    terr = terrain_features(stations["latitude"].tolist(), stations["longitude"].tolist())
    # Use DEM elevation, not the station inventory's surveyed value, so gauge
    # features are built exactly like the training grid's.
    base = stations.drop(columns=["elevation_m"], errors="ignore").reset_index(drop=True)
    return pd.concat([base, terr], axis=1)


def _in_periods(dates: pd.Series, periods: tuple[tuple[str, str], ...]) -> pd.Series:
    mask = pd.Series(False, index=dates.index)
    for start, end in periods:
        mask |= (dates >= pd.Timestamp(start)) & (dates <= pd.Timestamp(end))
    return mask


def gauge_datasets(
    region_key: str, predictor: Predictor, periods: tuple[tuple[str, str], ...]
) -> dict[str, tuple[pd.DataFrame, pd.DataFrame]]:
    """(rows, features) per gauge-validated variable, for days inside `periods`.

    `rows` carries the observation (`value`), `block_value` and `station_id`;
    `features` is aligned row-for-row and built through the served code path.
    """
    from backend.pipeline.sources.ghcn import load_station_daily

    st_path = PROCESSED_DIR / f"stations_{region_key}.parquet"
    if not st_path.exists():
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
        return {}
    inside = _station_terrain(inside)

    elements = sorted({v.ghcn_element for v in VARIABLES.values() if v.ghcn_element})
    obs = load_station_daily(
        inside["station_id"].tolist(), TRAINING_WINDOW.start, TRAINING_WINDOW.end, elements=elements
    )
    obs["date"] = pd.to_datetime(obs["date"])
    obs = obs[_in_periods(obs["date"], periods)]

    out = {}
    for key, var in VARIABLES.items():
        if var.ghcn_element is None or key not in predictor.models:
            continue
        paths = [
            PROCESSED_DIR / f"features_{region_key}_{key}.parquet",
            PROCESSED_DIR / f"features_hist_{region_key}_{key}.parquet",
        ]
        paths = [p for p in paths if p.exists()]
        if not paths:
            continue
        bvals = (
            pd.concat(
                [pd.read_parquet(p, columns=["block_id", "date", "block_value"]) for p in paths]
            )
            .groupby(["block_id", "date"])["block_value"]
            .first()
            .reset_index()
        )
        bvals["date"] = pd.to_datetime(bvals["date"])
        o = obs[obs["element"] == var.ghcn_element][["station_id", "date", "value"]]
        rows = o.merge(inside, on="station_id").merge(bvals, on=["block_id", "date"])
        rows = rows.dropna(subset=["value", "block_value"]).reset_index(drop=True)
        if len(rows) < 30:
            console.print(f"  [yellow]gauges {key}: only {len(rows)} days; skipped[/yellow]")
            continue
        targets = rows.rename(columns={"latitude": "lat", "longitude": "lon"})
        feats = build_target_features(
            targets.drop(columns=["block_value", "date"]),
            predictor.stats,
            targets["block_value"].to_numpy(),
            targets["date"],
        )
        out[key] = (rows, feats)
    return out


def calibrate_point_scale(
    region_key: str, predictor: Predictor, periods: tuple[tuple[str, str], ...]
) -> dict:
    """Interval widening needed at point scale, fitted on gauge-days in `periods`.

    The model is trained to reproduce ~16 km grid values, whose spread is far
    smaller than a single rain gauge's. Left alone, the published 80% interval
    covered only ~40% of gauge observations, which is overconfidence. We find the
    factor k that restores 80% coverage on the training season's gauge-days (never
    used to fit the model) and evaluate it on the held-out season. The same factor
    applies to panchayat (T3) output, which sits between grid and point scale, so
    point scale is the conservative reference.
    """
    data = gauge_datasets(region_key, predictor, periods)
    calib = {}
    grid_k = np.round(np.arange(1.0, 10.01, 0.05), 2)
    for key, (rows, feats) in data.items():
        pred = predictor.predict_variable(key, feats, Tier.T2, apply_scale_calibration=False)
        y = rows["value"].to_numpy(dtype=float)
        m, lo, hi = pred["median"], pred["lower"], pred["upper"]
        k_best = float(grid_k[-1])
        for k in grid_k:
            lo_k, hi_k = m - k * (m - lo), m + k * (hi - m)
            if VARIABLES[key].reconcile == "multiplicative":
                lo_k = np.maximum(lo_k, 0.0)
            if np.mean((y >= lo_k) & (y <= hi_k)) >= 0.80:
                k_best = float(k)
                break
        calib[key] = {
            "factor": k_best,
            "n": len(rows),
            "n_gauges": int(rows["station_id"].nunique()),
            "periods": [list(p) for p in periods],
        }
        console.print(
            f"  point-scale calibration {key}: k={k_best:.2f} "
            f"({len(rows)} gauge-days, {calib[key]['n_gauges']} gauges)"
        )
    return calib


def evaluate_t2(
    region_key: str, predictor: Predictor, periods: tuple[tuple[str, str], ...]
) -> dict:
    data = gauge_datasets(region_key, predictor, periods)
    results = {}
    for key, (rows, feats) in data.items():
        pred = predictor.predict_variable(key, feats, Tier.T2)
        y = rows["value"].to_numpy(dtype=float)
        bv = rows["block_value"].to_numpy(dtype=float)
        extra = {}
        if key in _TEMPERATURE_VARS:
            extra["B2_lapse_rate"] = lapse_rate_correction(bv, feats["elevation_anomaly_m"])
        results[key] = _variable_report(key, y, pred, bv, rows["station_id"].to_numpy(), extra)
        _add_policy(results[key], predictor, key, y, pred)
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
    for tier, title in (
        ("T1", "T1 — held-out seasons, dense field (~16 km)"),
        ("T2", "T2 — real gauges, held-out 2022-23 seasons (never used in training)"),
        ("T2_hist", "T2 (historical) — real gauges, 1960 monsoon (~100 gauges, never used in training)"),
    ):
        res = report.get(tier, {})
        lines += [f"## {title}", ""]
        if not res:
            lines += ["_Not evaluable for this region (no data)._", ""]
            continue
        lines += [
            "| Variable | n | MAE model | MAE naive | Skill | 90% CI | Served skill* "
            "| Coverage 80% | Verdict |",
            "|---|---:|---:|---:|---:|---|---:|---:|---|",
        ]
        for r in res.values():
            ci = r["skill_ci90"]
            lines.append(
                f"| {r['label']} ({r['unit']}) | {r['n']:,} | {_fmt(r['model_mae'], 2)} | "
                f"{_fmt(r['naive_mae'], 2)} | {_fmt(r['skill_vs_naive'])} | "
                f"[{_fmt(ci[0])}, {_fmt(ci[1])}] | "
                f"{_fmt(r.get('reconciled_skill_vs_naive', float('nan')))} | "
                f"{_fmt(r['interval_coverage_80'], 2)} | {r['verdict']} |"
            )
        lines += [
            "",
            "*Served skill: after block-mean reconciliation, i.e. the value the API "
            "actually returns (T1 only; gauges are not a block).",
        ]
        for r in res.values():
            if r.get("point_is_block"):
                lines.append(
                    f"- **{r['label']}: block value served.** On validation data the served "
                    f"estimate did not beat the block value (skill "
                    f"{_fmt(r.get('validation_served_skill'))}), so FieldCast serves the official "
                    f"block value as the point estimate and uses the model for the range"
                    + (" and the rain chance." if r.get("occurrence") else ".")
                    + f" The model alone would have scored {_fmt(r.get('raw_model_skill_vs_naive'))} here."
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
    recalibrate: bool = typer.Option(True, help="Refit the point-scale interval factor"),
) -> None:
    if region not in REGIONS:
        raise typer.BadParameter(f"unknown region {region!r}")
    model_region = model_region or region
    transfer = model_region != region

    test_periods = TRAINING_WINDOW.test_periods
    hist_test = tuple((s.start, s.end) for s in TRAINING_WINDOW.gauge_test_seasons)
    # Calibrate on the historical gauge seasons (~100 gauges) when their block
    # values exist; fall back to the training seasons' few modern gauges.
    has_hist = any(PROCESSED_DIR.glob(f"features_hist_{region}_*.parquet"))
    calib_periods = (
        tuple((s.start, s.end) for s in TRAINING_WINDOW.gauge_calibration_seasons)
        if has_hist
        else tuple((s.start, s.end) for s in TRAINING_WINDOW.train_seasons)
    )
    calib_path = ARTIFACT_DIR / model_region / "scale_calibration.json"

    # Calibration is fitted only on the model's own region, on seasons outside the
    # test set, so the held-out evaluation below stays out-of-sample.
    if not transfer and recalibrate and calib_periods:
        console.print("[bold]Calibrating point-scale intervals[/bold] on training seasons")
        raw = Predictor.load(region, model_region_key=model_region)
        calib = calibrate_point_scale(region, raw, calib_periods)
        calib_path.write_text(json.dumps(calib, indent=2), encoding="utf-8")

    predictor = Predictor.load(region, model_region_key=model_region)
    console.print(f"[bold]Evaluating {region}[/bold] with models from {model_region}")

    report = {
        "region": region,
        "model_region": model_region,
        "transfer": transfer,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "scale_calibration": predictor.scale_calibration,
        "T1": evaluate_t1(region, predictor, transfer),
        "T2": evaluate_t2(region, predictor, test_periods),
        "T2_hist": evaluate_t2(region, predictor, hist_test) if has_hist else {},
    }

    stem = f"evaluation_{region}" + (f"_from_{model_region}" if transfer else "")
    (REPORT_DIR / f"{stem}.json").write_text(json.dumps(report, indent=2, default=float), encoding="utf-8")
    write_markdown(report, REPORT_DIR / f"{stem}.md")

    table = Table(title=f"Skill vs naive — {region}")
    for c in ("tier", "variable", "n", "skill", "90% CI", "coverage", "verdict"):
        table.add_column(c)
    for tier in ("T1", "T2", "T2_hist"):
        for r in report.get(tier, {}).values():
            table.add_row(
                tier, r["variable"], f"{r['n']:,}", _fmt(r["skill_vs_naive"]),
                f"[{_fmt(r['skill_ci90'][0])}, {_fmt(r['skill_ci90'][1])}]",
                _fmt(r["interval_coverage_80"], 2), r["verdict"],
            )
    console.print(table)
    console.print(f"report: {REPORT_DIR / (stem + '.md')}")


if __name__ == "__main__":
    app()

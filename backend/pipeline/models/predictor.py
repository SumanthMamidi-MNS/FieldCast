"""Inference for arbitrary target points inside a block.

Used by two callers that must behave identically:

- the gauge evaluation (T2), where target points are rain-gauge locations, and
- the API, where target points are panchayat centroids.

Sharing one code path is deliberate: if the evaluation and the served product
built features differently, the published skill numbers would describe a model
nobody is actually running.

Block context (mean elevation, exposure, spread) always comes from the training
grid points inside the block, never from the target points themselves. That keeps
"how does this spot differ from its block" defined the same way it was in training.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from backend.app.schemas import Tier
from backend.config import ARTIFACT_DIR, PROCESSED_DIR, QUANTILES, VARIABLES
from backend.pipeline.features.build import FEATURE_COLUMNS, add_temporal_features
from backend.pipeline.models.downscaler import VariableDownscaler, lapse_rate_prior
from backend.pipeline.models.reconcile import reconcile_quantiles
from backend.pipeline.models.uncertainty import (
    SupportModel,
    clamp_non_negative,
    inflate_interval,
    nearest_gauge_km,
    support_score,
)

TERRAIN_FOR_SUPPORT = [
    "elevation_m",
    "slope_deg",
    "monsoon_exposure",
    "ruggedness_m",
    "roughness_m",
    "local_relief_m",
    "distance_to_coast_km",
]


@dataclass
class BlockStats:
    mean_elevation_m: float
    elevation_spread_m: float
    mean_exposure: float


def block_stats(grid: pd.DataFrame) -> pd.DataFrame:
    """Per-block terrain summary from the training grid, indexed by block_id."""
    g = grid.groupby("block_id")
    return pd.DataFrame(
        {
            "block_mean_elevation_m": g["elevation_m"].mean(),
            "block_elevation_spread_m": g["elevation_m"].std().fillna(0.0),
            "block_mean_exposure": g["monsoon_exposure"].mean(),
        }
    )


def build_target_features(
    targets: pd.DataFrame,
    stats: pd.DataFrame,
    block_values: pd.Series | np.ndarray,
    dates: pd.Series,
) -> pd.DataFrame:
    """Feature rows for target points.

    `targets` must carry block_id plus the terrain columns. `block_values` and
    `dates` align row-for-row with `targets`.
    """
    out = targets.reset_index(drop=True).copy()
    out = out.join(stats, on="block_id")
    out["block_value"] = np.asarray(block_values, dtype=float)
    out["date"] = pd.to_datetime(pd.Series(dates).reset_index(drop=True))
    out["elevation_anomaly_m"] = out["elevation_m"] - out["block_mean_elevation_m"]
    out["exposure_anomaly"] = out["monsoon_exposure"] - out["block_mean_exposure"]
    out["lapse_prior_c"] = lapse_rate_prior(out["elevation_anomaly_m"].to_numpy())
    out = add_temporal_features(out)
    return out


class Predictor:
    """Loaded models for one region, plus what is needed to score support."""

    def __init__(
        self,
        region_key: str,
        models: dict[str, VariableDownscaler],
        support: SupportModel | None,
        grid: pd.DataFrame,
    ):
        self.region_key = region_key
        self.models = models
        self.support = support
        self.grid = grid
        self.stats = block_stats(grid)

    @classmethod
    def load(cls, region_key: str, model_region_key: str | None = None) -> Predictor:
        """Load models trained on `model_region_key` to serve `region_key`.

        The two differ only for the transfer test, where Karnataka is served by
        models that never saw Karnataka.
        """
        model_region_key = model_region_key or region_key
        root = ARTIFACT_DIR / model_region_key
        models = {}
        for key in VARIABLES:
            path = root / key
            if (path / "meta.json").exists():
                models[key] = VariableDownscaler.load(path)
        if not models:
            raise FileNotFoundError(f"no trained models under {root}")

        grid = pd.read_parquet(PROCESSED_DIR / f"grid_{region_key}.parquet")

        support = None
        support_path = root / "support.npz"
        if support_path.exists():
            data = np.load(support_path, allow_pickle=True)
            gauges = None
            stations_path = PROCESSED_DIR / f"stations_{region_key}.parquet"
            if stations_path.exists():
                st = pd.read_parquet(stations_path)
                gauges = st[["latitude", "longitude"]].to_numpy(dtype=float)
            support = SupportModel(
                mean=data["mean"],
                inv_cov=data["inv_cov"],
                columns=list(data["columns"]),
                gauge_coords=gauges,
            )
        return cls(region_key, models, support, grid)

    def predict_variable(
        self,
        key: str,
        features: pd.DataFrame,
        tier: Tier,
        weights: np.ndarray | None = None,
        reconcile_to: float | None = None,
    ) -> dict:
        """Quantiles (optionally reconciled), occurrence, and support for one variable.

        `reconcile_to` applies block-mean reconciliation, which only makes sense
        when all rows belong to the same block and day (the API case). The gauge
        evaluation leaves it off: a handful of gauges is not a block.
        """
        model = self.models[key]
        var = VARIABLES[key]
        block_value = features["block_value"].to_numpy(dtype=float)

        quantiles, occurrence = model.predict(features[FEATURE_COLUMNS], block_value)

        if reconcile_to is not None:
            w = np.ones(len(features)) if weights is None else np.asarray(weights, dtype=float)
            quantiles = reconcile_quantiles(quantiles, w, float(reconcile_to), var.reconcile)

        lats = features["lat"].to_numpy(dtype=float)
        lons = features["lon"].to_numpy(dtype=float)
        if self.support is not None:
            cols = self.support.columns
            score = support_score(features[cols].to_numpy(dtype=float), self.support, lats, lons, tier)
            gauge_km = nearest_gauge_km(lats, lons, self.support.gauge_coords)
        else:
            score = np.zeros(len(features))
            gauge_km = np.full(len(features), np.inf)

        lo_q, hi_q = min(QUANTILES), max(QUANTILES)
        lower, upper = inflate_interval(quantiles[lo_q], quantiles[0.5], quantiles[hi_q], score, tier)
        median = quantiles[0.5]
        if var.reconcile == "multiplicative":
            lower, median, upper = clamp_non_negative(lower, median, upper)

        return {
            "median": median,
            "lower": lower,
            "upper": upper,
            "raw_quantiles": quantiles,
            "occurrence": occurrence,
            "support_score": score,
            "nearest_gauge_km": gauge_km,
        }

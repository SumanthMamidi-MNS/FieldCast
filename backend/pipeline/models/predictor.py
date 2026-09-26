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

import json
from dataclasses import dataclass

import numpy as np
import pandas as pd

from backend.app.schemas import Tier
from backend.config import ARTIFACT_DIR, PROCESSED_DIR, VARIABLES
from backend.pipeline.models.downscaler import VariableDownscaler
from backend.pipeline.models.finalize import finalize_variable
from backend.pipeline.models.numerics import (
    FEATURE_COLUMNS,
    TERRAIN_COLUMNS,
    target_feature_columns,
)
from backend.pipeline.models.uncertainty import (
    SupportModel,
)


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
    """Feature rows for target points, via the same numpy code the API uses.

    `targets` must carry block_id plus the terrain columns. `block_values` and
    `dates` align row-for-row with `targets`.
    """
    out = targets.reset_index(drop=True).copy()
    joined = out.join(stats, on="block_id")
    when = pd.to_datetime(pd.Series(dates).reset_index(drop=True))
    cols = target_feature_columns(
        {c: joined[c].to_numpy() for c in TERRAIN_COLUMNS},
        joined["block_mean_elevation_m"].to_numpy(),
        joined["block_elevation_spread_m"].to_numpy(),
        joined["block_mean_exposure"].to_numpy(),
        np.asarray(block_values, dtype=float),
        when.dt.dayofyear.to_numpy(),
        when.dt.month.to_numpy(),
    )
    for name, values in cols.items():
        out[name] = values
    out["date"] = when
    return out


class Predictor:
    """Loaded models for one region, plus what is needed to score support."""

    def __init__(
        self,
        region_key: str,
        models: dict[str, VariableDownscaler],
        support: SupportModel | None,
        grid: pd.DataFrame,
        scale_calibration: dict | None = None,
    ):
        self.region_key = region_key
        # Per-variable interval factor fitted at gauges (see
        # evaluate.run.calibrate_point_scale). Applied below the grid scale only.
        self.scale_calibration = scale_calibration or {}
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
        calib_path = root / "scale_calibration.json"
        calib = json.loads(calib_path.read_text(encoding="utf-8")) if calib_path.exists() else None
        return cls(region_key, models, support, grid, calib)

    def predict_variable(
        self,
        key: str,
        features: pd.DataFrame,
        tier: Tier,
        weights: np.ndarray | None = None,
        reconcile_to: float | None = None,
        apply_scale_calibration: bool = True,
    ) -> dict:
        """Quantiles (optionally reconciled), occurrence, and support for one variable.

        `reconcile_to` applies block-mean reconciliation, which only makes sense
        when all rows belong to the same block and day (the API case). The gauge
        evaluation leaves it off: a handful of gauges is not a block.
        """
        model = self.models[key]
        block_value = features["block_value"].to_numpy(dtype=float)
        x = features[FEATURE_COLUMNS]
        occurrence = model.predict_occurrence(x)
        quantiles = model.predict_quantiles(x, block_value)

        calib = self.scale_calibration.get(key) if apply_scale_calibration else None
        support_features = (
            features[self.support.columns].to_numpy(dtype=float) if self.support is not None else None
        )
        return finalize_variable(
            quantiles=quantiles,
            occurrence=occurrence,
            reconcile_mode=VARIABLES[key].reconcile,
            support_features=support_features,
            support=self.support,
            lats=features["lat"].to_numpy(dtype=float),
            lons=features["lon"].to_numpy(dtype=float),
            tier=tier,
            weights=weights,
            reconcile_to=reconcile_to,
            scale_factor=float(calib["factor"]) if calib is not None else None,
        )

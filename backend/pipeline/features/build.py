"""Feature table construction.

## The training design, and why it is set up this way

The tempting approach is to train on gauge observations, since they are the real
ground truth. That would be a mistake: there are only a few dozen usable stations
in the pilot region, and if we train on them we have nothing independent left to
validate against. Every skill number would then be a statement about how well we
fit the data we fitted.

So the split is deliberate:

- **Train on the dense ERA5 field (T1).** Each ERA5 grid point inside a block is
  a "local" sample; the area-mean of the grid points in that block is the
  synthesised "block forecast". This is the perfect-prognosis coarsening protocol:
  we degrade a field we can see, then measure whether we can recover it. It gives
  tens of thousands of training rows and real terrain-driven variance.

- **Validate on real GHCN gauges (T2), which the model never sees in training.**
  This is the number that actually answers the success criteria (architecture.md §0). It is a true out-of-sample test
  against instruments, not against our own training signal.

## Leakage control

Two independent holdouts, both required:

- **Spatial:** whole blocks are held out, never random rows. Neighbouring ERA5
  cells are strongly correlated, so a random split would put a cell's neighbour in
  train and the cell itself in test, and report skill that evaporates in the field.
- **Temporal:** whole years are held out, because weather is autocorrelated within
  a season and adjacent days leak just as badly as adjacent cells.
"""

from __future__ import annotations

import hashlib

import numpy as np
import pandas as pd

from backend.config import (
    TRAINING_WINDOW,
    VARIABLES,
    Region,
)
from backend.pipeline.models.numerics import (
    CONTEXT_COLUMNS,
    FEATURE_COLUMNS,
    TERRAIN_COLUMNS,
    lapse_rate_prior,
    temporal_features,
)

# Column lists live in numerics so the deployed API shares them exactly.
__all__ = ["CONTEXT_COLUMNS", "FEATURE_COLUMNS", "TERRAIN_COLUMNS"]


def era5_grid_points(
    bounds: tuple[float, float, float, float], step_deg: float = 0.1
) -> tuple[np.ndarray, np.ndarray]:
    """Grid points on the ERA5-Land lattice covering a bounding box.

    Snapped to the actual 0.1-degree lattice so each query lands on a distinct
    grid cell. Querying off-lattice points would return duplicate values from the
    same cell and silently inflate the apparent sample size.
    """
    min_lon, min_lat, max_lon, max_lat = bounds

    def axis(lo: float, hi: float) -> np.ndarray:
        start = np.floor(lo / step_deg)
        stop = np.ceil(hi / step_deg)
        steps = np.arange(start, stop + 1)
        # Multiply integer lattice indices by the step and round, rather than
        # accumulating with arange. Accumulation drifts (74.5 becomes
        # 74.49999999999997), and these coordinates are used as join keys later,
        # so drift would silently drop rows from the feature table.
        return np.round(steps * step_deg, 6)

    lats = axis(min_lat, max_lat)
    lons = axis(min_lon, max_lon)
    grid_lat, grid_lon = np.meshgrid(lats, lons, indexing="ij")
    return grid_lat.ravel(), grid_lon.ravel()


def add_temporal_features(df: pd.DataFrame, date_col: str = "date") -> pd.DataFrame:
    """Day-of-year harmonics plus a monsoon flag.

    Harmonics rather than raw day-of-year so that 31 December sits next to
    1 January, which a tree split on an integer day cannot express.
    """
    out = df.copy()
    dates = pd.to_datetime(out[date_col])
    for name, values in temporal_features(
        dates.dt.dayofyear.to_numpy(), dates.dt.month.to_numpy()
    ).items():
        out[name] = values
    return out


def add_block_context(
    df: pd.DataFrame,
    value_col: str = "local_value",
    block_col: str = "block_id",
    date_col: str = "date",
) -> pd.DataFrame:
    """Synthesise the block-level forecast and every feature relative to it.

    The block value is the area-mean of the fine field inside the block — this is
    the coarsening step that creates the problem we are trying to invert. Terrain
    anomalies are computed against the same block so the model always sees "how
    does this spot differ from its block", which is exactly the quantity it must
    predict.
    """
    out = df.copy()
    grp = out.groupby([block_col, date_col])[value_col]
    out["block_value"] = grp.transform("mean")

    static = out.groupby(block_col)
    out["block_mean_elevation_m"] = static["elevation_m"].transform("mean")
    out["block_elevation_spread_m"] = static["elevation_m"].transform("std").fillna(0.0)
    out["block_mean_exposure"] = static["monsoon_exposure"].transform("mean")

    out["elevation_anomaly_m"] = out["elevation_m"] - out["block_mean_elevation_m"]
    out["exposure_anomaly"] = out["monsoon_exposure"] - out["block_mean_exposure"]
    out["lapse_prior_c"] = lapse_rate_prior(out["elevation_anomaly_m"].to_numpy())

    return out


def _block_hash(block_id: str) -> float:
    """Stable 0-1 hash of a block id.

    Used for the spatial split so the same blocks land in the same fold on every
    run and across machines — `hash()` is salted per process and would silently
    reshuffle the holdout between runs, making results irreproducible.
    """
    digest = hashlib.sha256(str(block_id).encode("utf-8")).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def spatial_temporal_split(
    df: pd.DataFrame,
    block_col: str = "block_id",
    date_col: str = "date",
    valid_fraction: float = 0.2,
    test_periods: tuple[tuple[str, str], ...] | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Split into train / validation / test with both holdouts applied.

    Test = held-out SEASONS, given as inclusive date ranges (temporal
    generalisation). Ranges rather than years, because the dry season runs
    October to May and crosses a year boundary.
    Validation = held-out BLOCKS outside the test periods (spatial
    generalisation, used for early stopping and probability calibration).
    Train = everything else.

    Returns (train, valid, test).
    """
    # `is None` rather than a falsy check: an empty tuple is a meaningful value
    # (no temporal holdout at all) and `or` would silently replace it with the
    # default, sending rows into the test split.
    if test_periods is None:
        test_periods = TRAINING_WINDOW.test_periods
    out = df.copy()
    dates = pd.to_datetime(out[date_col])

    is_test = np.zeros(len(out), dtype=bool)
    for start, end in test_periods:
        is_test |= ((dates >= pd.Timestamp(start)) & (dates <= pd.Timestamp(end))).to_numpy()

    block_score = out[block_col].map(_block_hash).to_numpy()
    is_valid_block = block_score < valid_fraction

    train = out[~is_test & ~is_valid_block]
    valid = out[~is_test & is_valid_block]
    test = out[is_test]

    return train.copy(), valid.copy(), test.copy()


def assert_no_leakage(
    train: pd.DataFrame,
    valid: pd.DataFrame,
    test: pd.DataFrame,
    block_col: str = "block_id",
    date_col: str = "date",
    embargo_days: int = 3,
) -> None:
    """Fail loudly if the holdouts are not actually held out.

    Called before every training run. A silent leak here would invalidate every
    number this project reports, and it is the kind of bug that makes results look
    better rather than worse — so it must be checked, not assumed.
    """
    train_blocks = set(train[block_col])
    valid_blocks = set(valid[block_col])
    overlap = train_blocks & valid_blocks
    if overlap:
        raise AssertionError(
            f"spatial leak: {len(overlap)} block(s) appear in both train and validation, "
            f"e.g. {sorted(overlap)[:3]}"
        )

    if len(test) == 0:
        return

    # Check dates, not years. Years are too coarse: a legitimate within-year
    # cutoff split (used by the quick run) shares a year without sharing a single
    # day, and would fail a year-level check for no reason.
    train_dates = set(pd.to_datetime(train[date_col]).unique())
    test_dates = set(pd.to_datetime(test[date_col]).unique())
    date_overlap = train_dates & test_dates
    if date_overlap:
        raise AssertionError(
            f"temporal leak: {len(date_overlap)} date(s) in both train and test, "
            f"e.g. {sorted(date_overlap)[:3]}"
        )

    # Weather is autocorrelated across adjacent days, so a test set starting the
    # morning after training ends still leaks. Require a gap.
    if train_dates:
        gap = (min(test_dates) - max(train_dates)).days
        if 0 < gap < embargo_days:
            raise AssertionError(
                f"temporal leak: only {gap} day(s) between the end of training and the "
                f"start of testing; {embargo_days} required because weather is "
                f"autocorrelated across adjacent days"
            )


def build_feature_table(
    weather_long: pd.DataFrame,
    terrain: pd.DataFrame,
    point_to_block: pd.DataFrame,
    variable_key: str,
) -> pd.DataFrame:
    """Assemble the modelling table for one variable.

    Args:
        weather_long: tidy (date, lat, lon, variable, value) from the source adapter.
        terrain: terrain features indexed to match `point_to_block` rows.
        point_to_block: (lat, lon, block_id) assignment for every fine point.
        variable_key: key into VARIABLES.

    Returns a frame with FEATURE_COLUMNS plus local_value, block_value, block_id,
    date, lat, lon.
    """
    if variable_key not in VARIABLES:
        raise ValueError(f"unknown variable {variable_key!r}")
    var = VARIABLES[variable_key]

    values = weather_long[weather_long["variable"] == var.open_meteo_daily]
    if values.empty:
        raise ValueError(
            f"no rows for {var.open_meteo_daily!r}; available: "
            f"{sorted(weather_long['variable'].unique())}"
        )

    base = point_to_block.reset_index(drop=True)
    extra = terrain.reset_index(drop=True)
    # Terrain may already carry columns the mapping has (a caller passing one
    # combined frame is a reasonable thing to do). Keep the mapping's copy rather
    # than failing on an overlap.
    extra = extra[[c for c in extra.columns if c not in base.columns]]
    points = base.join(extra)

    # Round coordinates before joining: float formatting differences between the
    # request and the API echo would otherwise silently drop every row.
    for frame in (values, points):
        frame["_lat_k"] = frame["lat"].round(3)
        frame["_lon_k"] = frame["lon"].round(3)

    merged = values.merge(points, on=["_lat_k", "_lon_k"], how="inner", suffixes=("", "_pt"))
    if merged.empty:
        raise ValueError("weather and terrain point sets did not intersect; check coordinates")

    merged = merged.rename(columns={"value": "local_value"})
    merged = merged.drop(columns=[c for c in merged.columns if c.endswith("_pt")])
    merged = merged.dropna(subset=["local_value"])

    merged = add_block_context(merged)
    merged = add_temporal_features(merged)

    keep = [
        "date",
        "lat",
        "lon",
        "block_id",
        "local_value",
        *FEATURE_COLUMNS,
    ]
    missing = [c for c in keep if c not in merged.columns]
    if missing:
        raise ValueError(f"feature table is missing columns: {missing}")

    return merged[keep].reset_index(drop=True)


def region_bounds(region: Region, blocks) -> tuple[float, float, float, float]:
    """Bounding box of a region's blocks, as (min_lon, min_lat, max_lon, max_lat)."""
    if blocks is None or len(blocks) == 0:
        raise ValueError(f"no blocks loaded for region {region.key}")
    minx, miny, maxx, maxy = blocks.total_bounds
    return float(minx), float(miny), float(maxx), float(maxy)

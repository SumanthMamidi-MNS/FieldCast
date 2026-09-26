"""Numpy-only model maths shared by the training pipeline and the deployed API.

The deployed function (Vercel) cannot carry the training stack (pandas,
LightGBM, GeoPandas). Everything the served forecast computes therefore lives
in numpy-only modules like this one, and the pipeline calls the same functions,
so what is evaluated and what is served cannot drift apart. A parity test
checks the two paths return identical numbers.
"""

from __future__ import annotations

import numpy as np

from backend.config import LAPSE_RATE_C_PER_M

# Terrain covariates attached to every location.
TERRAIN_COLUMNS = [
    "elevation_m",
    "slope_deg",
    "monsoon_exposure",
    "ruggedness_m",
    "roughness_m",
    "local_relief_m",
    "distance_to_coast_km",
    "upwind_barrier_m",
    "downwind_rise_m",
    "upwind_max_elev_m",
]

# Features derived per (location, day) relative to its block.
CONTEXT_COLUMNS = [
    "block_value",
    "elevation_anomaly_m",
    "block_mean_elevation_m",
    "block_elevation_spread_m",
    "exposure_anomaly",
    "block_mean_exposure",
    "lapse_prior_c",
    "doy_sin",
    "doy_cos",
    "is_monsoon",
]

FEATURE_COLUMNS = TERRAIN_COLUMNS + CONTEXT_COLUMNS


def lapse_rate_prior(elevation_anomaly_m: np.ndarray) -> np.ndarray:
    """Expected temperature offset from elevation alone.

    Given to the temperature models as a feature so they learn the *departure*
    from known physics rather than spending capacity rediscovering it.
    """
    return np.asarray(elevation_anomaly_m, dtype=float) * LAPSE_RATE_C_PER_M


def temporal_features(day_of_year: np.ndarray, month: np.ndarray) -> dict[str, np.ndarray]:
    """Day-of-year harmonics plus the SW-monsoon (Jun-Sep) flag."""
    doy = np.asarray(day_of_year, dtype=float)
    month = np.asarray(month)
    return {
        "doy_sin": np.sin(2 * np.pi * doy / 365.25),
        "doy_cos": np.cos(2 * np.pi * doy / 365.25),
        "is_monsoon": ((month >= 6) & (month <= 9)).astype(int),
    }


def target_feature_columns(
    terrain: dict[str, np.ndarray],
    block_mean_elevation_m: np.ndarray,
    block_elevation_spread_m: np.ndarray,
    block_mean_exposure: np.ndarray,
    block_value: np.ndarray,
    day_of_year: np.ndarray,
    month: np.ndarray,
) -> dict[str, np.ndarray]:
    """Every model feature for a set of target points, as named columns."""
    elev = np.asarray(terrain["elevation_m"], dtype=float)
    exposure = np.asarray(terrain["monsoon_exposure"], dtype=float)
    mean_elev = np.asarray(block_mean_elevation_m, dtype=float)
    out: dict[str, np.ndarray] = {c: np.asarray(terrain[c], dtype=float) for c in TERRAIN_COLUMNS}
    out["block_value"] = np.asarray(block_value, dtype=float)
    out["block_mean_elevation_m"] = mean_elev
    out["block_elevation_spread_m"] = np.asarray(block_elevation_spread_m, dtype=float)
    out["block_mean_exposure"] = np.asarray(block_mean_exposure, dtype=float)
    out["elevation_anomaly_m"] = elev - mean_elev
    out["exposure_anomaly"] = exposure - out["block_mean_exposure"]
    out["lapse_prior_c"] = lapse_rate_prior(out["elevation_anomaly_m"])
    out.update(temporal_features(day_of_year, month))
    return out


def feature_matrix(columns: dict[str, np.ndarray], order: list[str]) -> np.ndarray:
    """Stack named feature columns into a float matrix in the model's order."""
    return np.column_stack([np.asarray(columns[c], dtype=float) for c in order])


def invert_target(anomaly: np.ndarray, block_value: np.ndarray, reconcile_mode: str) -> np.ndarray:
    """Model output (anomaly) back to the variable's natural units.

    Multiplicative variables are modelled as log1p ratios, additive ones as
    plain differences from the block value.
    """
    anomaly = np.asarray(anomaly, dtype=float)
    block_value = np.asarray(block_value, dtype=float)
    if reconcile_mode == "multiplicative":
        return np.maximum(np.expm1(np.log1p(np.maximum(block_value, 0.0)) + anomaly), 0.0)
    return block_value + anomaly


def sort_quantiles(quantiles: dict[float, np.ndarray]) -> dict[float, np.ndarray]:
    """Repair crossing between independently fitted quantile models."""
    levels = sorted(quantiles)
    stacked = np.sort(np.vstack([np.asarray(quantiles[q], dtype=float) for q in levels]), axis=0)
    return {q: stacked[i] for i, q in enumerate(levels)}


def mixture_quantiles(
    conditional: dict[float, np.ndarray], occurrence: np.ndarray
) -> dict[float, np.ndarray]:
    """Quantiles of the dry/wet mixture from conditional (if-wet) quantiles.

    Below the dry probability the mixture quantile is zero. This reuses the
    fitted conditional levels rather than re-deriving (q - dry) / wet levels,
    which three fitted quantiles cannot supply; it is an approximation.
    """
    dry_prob = 1.0 - np.asarray(occurrence, dtype=float)
    return {q: np.where(q <= dry_prob, 0.0, v) for q, v in conditional.items()}

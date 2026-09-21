"""Baselines the downscaling model must beat.

B0 (naive block copy) is the one the PRD names, and it is a genuinely strong
baseline — that is the point. Block forecasts are skilful; the question is only
whether local refinement adds anything on top. Including B1-B3 guards against the
weaker claim "we beat the worst possible alternative": if our model beats B0 but
loses to a plain lapse-rate correction, we have built an expensive thermometer and
the evaluation should say so.
"""

from __future__ import annotations

import numpy as np

from backend.config import LAPSE_RATE_C_PER_M


def naive_block_copy(block_value: np.ndarray) -> np.ndarray:
    """B0: every panchayat gets the block value. The bar the success criteria (architecture.md §0) sets."""
    return np.asarray(block_value, dtype=float).copy()


def lapse_rate_correction(
    block_value: np.ndarray,
    elevation_anomaly_m: np.ndarray,
    lapse_rate: float = LAPSE_RATE_C_PER_M,
) -> np.ndarray:
    """B2: pure physics, no learning. Only meaningful for temperature.

    This is the honest competitor. Any agency can apply a lapse rate in a
    spreadsheet, so a machine-learning system that merely matches it has not
    earned its complexity.
    """
    block_value = np.asarray(block_value, dtype=float)
    elev = np.asarray(elevation_anomaly_m, dtype=float)
    return block_value + elev * lapse_rate


def idw_interpolation(
    target_lats: np.ndarray,
    target_lons: np.ndarray,
    source_lats: np.ndarray,
    source_lons: np.ndarray,
    source_values: np.ndarray,
    power: float = 2.0,
    k: int = 4,
    eps_km: float = 0.5,
) -> np.ndarray:
    """B1: inverse-distance weighting from neighbouring block centroids.

    This is the classical GIS answer to "make the coarse field finer", and it
    encodes precisely the smoothness assumption the core design tension (architecture.md §0) identifies as false for
    rainfall. It is included because it is what a reviewer will ask about, and
    because beating it on rainfall specifically is the interesting result.
    """
    tlat = np.asarray(target_lats, dtype=float)
    tlon = np.asarray(target_lons, dtype=float)
    slat = np.asarray(source_lats, dtype=float)
    slon = np.asarray(source_lons, dtype=float)
    svals = np.asarray(source_values, dtype=float)

    if slat.size == 0:
        return np.full(tlat.shape, np.nan)

    lat0 = float(np.mean(tlat)) if tlat.size else 0.0
    scale = np.cos(np.radians(lat0))

    out = np.empty(tlat.shape, dtype=float)
    for i in range(tlat.size):
        dlat = (slat - tlat[i]) * 111.32
        dlon = (slon - tlon[i]) * 111.32 * scale
        dist = np.sqrt(dlat**2 + dlon**2)

        valid = np.isfinite(dist) & np.isfinite(svals)
        if not valid.any():
            out[i] = np.nan
            continue

        d = dist[valid]
        v = svals[valid]

        # Exact hit: return the source value rather than dividing by zero.
        if np.any(d < eps_km):
            out[i] = float(v[np.argmin(d)])
            continue

        n_take = min(k, d.size)
        idx = np.argpartition(d, n_take - 1)[:n_take]
        w = 1.0 / np.power(d[idx], power)
        out[i] = float(np.sum(w * v[idx]) / np.sum(w))

    return out


def bilinear_from_grid(
    target_lats: np.ndarray,
    target_lons: np.ndarray,
    grid_lats: np.ndarray,
    grid_lons: np.ndarray,
    grid_values: np.ndarray,
) -> np.ndarray:
    """B3: standard bilinear regrid of the coarse field.

    `grid_lats` and `grid_lons` are the 1-D axes; `grid_values` is (n_lat, n_lon).
    Points outside the grid return NaN rather than an edge-clamped value, because
    silently extrapolating a regrid is how fake skill gets manufactured.
    """
    tlat = np.asarray(target_lats, dtype=float)
    tlon = np.asarray(target_lons, dtype=float)
    glat = np.asarray(grid_lats, dtype=float)
    glon = np.asarray(grid_lons, dtype=float)
    vals = np.asarray(grid_values, dtype=float)

    if vals.shape != (glat.size, glon.size):
        raise ValueError(
            f"grid_values shape {vals.shape} does not match axes ({glat.size}, {glon.size})"
        )

    out = np.full(tlat.shape, np.nan)
    for i in range(tlat.size):
        la, lo = tlat[i], tlon[i]
        if la < glat.min() or la > glat.max() or lo < glon.min() or lo > glon.max():
            continue

        j = int(np.clip(np.searchsorted(glat, la) - 1, 0, glat.size - 2))
        k = int(np.clip(np.searchsorted(glon, lo) - 1, 0, glon.size - 2))

        lat_span = glat[j + 1] - glat[j]
        lon_span = glon[k + 1] - glon[k]
        ty = 0.0 if lat_span == 0 else (la - glat[j]) / lat_span
        tx = 0.0 if lon_span == 0 else (lo - glon[k]) / lon_span

        v00, v01 = vals[j, k], vals[j, k + 1]
        v10, v11 = vals[j + 1, k], vals[j + 1, k + 1]
        if not np.isfinite([v00, v01, v10, v11]).all():
            continue

        out[i] = (
            v00 * (1 - tx) * (1 - ty)
            + v01 * tx * (1 - ty)
            + v10 * (1 - tx) * ty
            + v11 * tx * ty
        )
    return out

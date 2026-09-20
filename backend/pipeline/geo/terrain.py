"""Terrain covariates from a sampled elevation stencil.

Why a stencil rather than a downloaded DEM: we need slope, aspect and ruggedness
at a few thousand points, not a raster of an entire state. Sampling elevation on a
small cross around each point gives us the derivatives directly, in a handful of
batched API calls, with no multi-gigabyte download and no GDAL dependency.

The covariate that actually matters here is `monsoon_exposure`. The Western Ghats
rain-shadow gradient — roughly 3000mm to 500mm within 50km — is overwhelmingly a
windward/leeward effect. Elevation alone cannot express it: a 900m windward slope
and a 900m leeward slope have wildly different rainfall. Aspect scored against the
monsoon flow direction is the feature that separates them, and it is the single
reason this model can beat a naive elevation lapse-rate correction on rainfall.

The elevation sampler is injected rather than imported so this module is testable
without network access and decoupled from the source adapter's exact signature.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np
import pandas as pd

from backend.config import MONSOON_FLOW_DEG, TERRAIN_STENCIL_M

# A point and its four neighbours at +/- one stencil width, plus the four
# diagonals. Nine points gives us a proper finite-difference gradient and a
# usable ruggedness estimate; five would give gradient but a poor TRI.
_OFFSETS: tuple[tuple[int, int], ...] = (
    (0, 0),
    (-1, 0),
    (1, 0),
    (0, -1),
    (0, 1),
    (-1, -1),
    (-1, 1),
    (1, -1),
    (1, 1),
)

_M_PER_DEG_LAT = 111_320.0

ElevationSampler = Callable[[Sequence[float], Sequence[float]], Sequence[float]]


@dataclass(frozen=True)
class TerrainFeatures:
    elevation_m: float
    slope_deg: float
    aspect_deg: float          # compass direction the slope faces (downhill)
    monsoon_exposure: float    # +1 fully windward, -1 fully leeward
    ruggedness_m: float        # terrain ruggedness index (includes slope)
    roughness_m: float         # detrended roughness: terrain complexity minus slope
    local_relief_m: float      # max - min over the stencil


def _stencil_points(lat: float, lon: float, step_m: float) -> tuple[list[float], list[float]]:
    """Build the 9-point sampling cross around one location.

    Longitude spacing is scaled by cos(latitude) so the stencil stays square in
    metres rather than degrees — at 19°N that is a ~6% correction, which matters
    for aspect since aspect is an angle.
    """
    dlat = step_m / _M_PER_DEG_LAT
    dlon = step_m / (_M_PER_DEG_LAT * max(math.cos(math.radians(lat)), 1e-6))

    lats: list[float] = []
    lons: list[float] = []
    for di, dj in _OFFSETS:
        lats.append(lat + di * dlat)
        lons.append(lon + dj * dlon)
    return lats, lons


def _derive(elevations: np.ndarray, step_m: float) -> TerrainFeatures:
    """Compute terrain derivatives from the 9 stencil elevations.

    Order follows _OFFSETS: centre, then -dlat (south), +dlat (north),
    -dlon (west), +dlon (east), then the four diagonals.
    """
    centre = float(elevations[0])
    south, north = float(elevations[1]), float(elevations[2])
    west, east = float(elevations[3]), float(elevations[4])

    # Central differences. dz_dy is positive toward increasing latitude (north).
    dz_dx = (east - west) / (2.0 * step_m)
    dz_dy = (north - south) / (2.0 * step_m)

    slope_rad = math.atan(math.hypot(dz_dx, dz_dy))
    slope_deg = math.degrees(slope_rad)

    # Aspect = compass bearing the slope faces downhill. atan2 of the negative
    # gradient gives the downhill direction; convert from math convention
    # (CCW from east) to compass (CW from north).
    if abs(dz_dx) < 1e-12 and abs(dz_dy) < 1e-12:
        aspect_deg = float("nan")   # flat ground genuinely has no aspect
    else:
        aspect_math = math.atan2(-dz_dy, -dz_dx)
        aspect_deg = (90.0 - math.degrees(aspect_math)) % 360.0

    # Exposure to the monsoon. MONSOON_FLOW_DEG is the direction the wind comes
    # FROM, so a slope facing INTO that direction is windward. cos of the angle
    # between aspect and the source bearing is +1 when they coincide.
    if math.isnan(aspect_deg):
        monsoon_exposure = 0.0
    else:
        delta = math.radians(aspect_deg - MONSOON_FLOW_DEG)
        # Scale by sin(slope): a flat plain is neither windward nor leeward, so
        # exposure should decay to zero as the slope flattens.
        monsoon_exposure = math.cos(delta) * math.sin(slope_rad)

    # Terrain Ruggedness Index (Riley et al.): RMS elevation difference from the
    # centre. Note this deliberately INCLUDES the planar slope contribution, so a
    # smooth steep hillside scores high. That is the standard definition.
    diffs = elevations[1:] - centre
    ruggedness = float(np.sqrt(np.mean(diffs**2)))

    # Detrended roughness: RMS residual after removing the fitted plane. This is
    # the genuinely independent signal — it separates a smooth steep hillside
    # (low roughness) from dissected, gully-cut terrain (high roughness), which
    # TRI alone cannot do because TRI is dominated by slope. Both are given to
    # the model; they answer different questions.
    step_lat = np.array([o[0] for o in _OFFSETS], dtype=float) * step_m
    step_lon = np.array([o[1] for o in _OFFSETS], dtype=float) * step_m
    predicted = centre + dz_dx * step_lon + dz_dy * step_lat
    roughness = float(np.sqrt(np.mean((elevations - predicted) ** 2)))

    local_relief = float(np.max(elevations) - np.min(elevations))

    return TerrainFeatures(
        elevation_m=centre,
        slope_deg=slope_deg,
        aspect_deg=aspect_deg,
        monsoon_exposure=monsoon_exposure,
        ruggedness_m=ruggedness,
        roughness_m=roughness,
        local_relief_m=local_relief,
    )


def compute_terrain(
    lats: Sequence[float],
    lons: Sequence[float],
    sampler: ElevationSampler,
    step_m: float = TERRAIN_STENCIL_M,
) -> pd.DataFrame:
    """Terrain features for a set of points.

    All stencil points across all locations are flattened into one request list so
    the caller's sampler can batch them efficiently — for N points that is 9N
    elevation lookups, which the Open-Meteo elevation endpoint serves 100 at a time.
    """
    if len(lats) != len(lons):
        raise ValueError(f"lats/lons length mismatch: {len(lats)} vs {len(lons)}")
    if not lats:
        return pd.DataFrame(
            columns=[
                "elevation_m",
                "slope_deg",
                "aspect_deg",
                "monsoon_exposure",
                "ruggedness_m",
                "roughness_m",
                "local_relief_m",
            ]
        )

    all_lats: list[float] = []
    all_lons: list[float] = []
    for lat, lon in zip(lats, lons, strict=True):
        slat, slon = _stencil_points(float(lat), float(lon), step_m)
        all_lats.extend(slat)
        all_lons.extend(slon)

    sampled = np.asarray(sampler(all_lats, all_lons), dtype=float)
    expected = len(lats) * len(_OFFSETS)
    if sampled.size != expected:
        raise ValueError(
            f"elevation sampler returned {sampled.size} values, expected {expected}. "
            "The sampler must preserve input order and return one value per point."
        )

    grid = sampled.reshape(len(lats), len(_OFFSETS))

    rows = []
    for i in range(len(lats)):
        stencil = grid[i]
        if np.isnan(stencil).any():
            # A partial stencil cannot give a trustworthy gradient. Emit NaN
            # derivatives rather than a plausible-looking fabricated slope.
            rows.append(
                TerrainFeatures(
                    elevation_m=float(stencil[0]),
                    slope_deg=float("nan"),
                    aspect_deg=float("nan"),
                    monsoon_exposure=float("nan"),
                    ruggedness_m=float("nan"),
                    roughness_m=float("nan"),
                    local_relief_m=float("nan"),
                )
            )
        else:
            rows.append(_derive(stencil, step_m))

    return pd.DataFrame([r.__dict__ for r in rows], index=pd.RangeIndex(len(lats)))


def distance_to_coast_km(
    lats: Sequence[float],
    lons: Sequence[float],
    coastline_lons_by_lat: dict[int, float] | None = None,
) -> np.ndarray:
    """Approximate distance inland from the Arabian Sea coast.

    A deliberate simplification: for the peninsular west coast the coastline is
    close to meridional, so distance east of the coastal longitude at that
    latitude is a good proxy. This is a covariate, not a published measurement —
    precision here buys nothing, and pulling a full coastline geometry for it
    would add a dependency for no measurable gain.
    """
    # West-coast longitude by whole degree of latitude (Arabian Sea).
    default_coast = {
        8: 77.0, 9: 76.5, 10: 76.0, 11: 75.6, 12: 74.9, 13: 74.7, 14: 74.3,
        15: 73.9, 16: 73.5, 17: 73.3, 18: 72.9, 19: 72.8, 20: 72.8, 21: 72.7,
        22: 72.6, 23: 72.3,
    }
    table = coastline_lons_by_lat or default_coast

    out = np.empty(len(lats), dtype=float)
    for i, (lat, lon) in enumerate(zip(lats, lons, strict=True)):
        key = int(round(float(lat)))
        coast_lon = table.get(key)
        if coast_lon is None:
            nearest = min(table, key=lambda k: abs(k - key))
            coast_lon = table[nearest]
        dlon = float(lon) - coast_lon
        km_per_deg = 111.32 * math.cos(math.radians(float(lat)))
        out[i] = max(dlon * km_per_deg, 0.0)
    return out

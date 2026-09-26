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


# --------------------------------------------------------------------------
# Orographic (rain-shadow) features
# --------------------------------------------------------------------------
_EARTH_RADIUS_KM = 6371.0088


def _destination(
    lat: np.ndarray, lon: np.ndarray, bearing_deg: float, dist_km: float
) -> tuple[np.ndarray, np.ndarray]:
    """Great-circle destination point for each (lat, lon)."""
    phi1 = np.radians(lat)
    lam1 = np.radians(lon)
    theta = math.radians(bearing_deg)
    delta = dist_km / _EARTH_RADIUS_KM
    phi2 = np.arcsin(np.sin(phi1) * math.cos(delta) + np.cos(phi1) * math.sin(delta) * math.cos(theta))
    lam2 = lam1 + np.arctan2(
        math.sin(theta) * math.sin(delta) * np.cos(phi1),
        math.cos(delta) - np.sin(phi1) * np.sin(phi2),
    )
    return np.degrees(phi2), np.degrees(lam2)


def compute_orographic(
    lats: Sequence[float],
    lons: Sequence[float],
    sampler: ElevationSampler,
    flow_deg: float = MONSOON_FLOW_DEG,
    upwind_km: float = 40.0,
    downwind_km: float = 16.0,
    step_km: float = 2.0,
) -> pd.DataFrame:
    """Elevation profiles along the monsoon flow line through each point.

    The Western Ghats rain shadow is not a property of the local slope: a village
    on flat ground 30 km east of the crest is dry because of the ridge upwind of
    it. So we sample the terrain along the SW-monsoon direction:

    - `upwind_barrier_m`: how far the highest ground upwind (towards 245°, where
      the monsoon comes from) rises above this point. Large => rain shadow.
    - `downwind_rise_m`: how far terrain rises ahead of the point in the flow
      direction. Large => air is being forced up here (windward slope, heavy rain).
    - `upwind_max_elev_m`: the height of that upwind barrier itself.
    """
    lat = np.asarray(lats, dtype=float)
    lon = np.asarray(lons, dtype=float)
    if lat.shape != lon.shape:
        raise ValueError(f"lats/lons length mismatch: {lat.size} vs {lon.size}")
    cols = ["upwind_barrier_m", "downwind_rise_m", "upwind_max_elev_m"]
    if lat.size == 0:
        return pd.DataFrame(columns=cols)

    up_d = np.arange(step_km, upwind_km + 1e-9, step_km)
    down_d = np.arange(step_km, downwind_km + 1e-9, step_km)

    q_lat = [lat]
    q_lon = [lon]
    for d in up_d:
        a, b = _destination(lat, lon, flow_deg, float(d))
        q_lat.append(a)
        q_lon.append(b)
    for d in down_d:
        a, b = _destination(lat, lon, (flow_deg + 180.0) % 360.0, float(d))
        q_lat.append(a)
        q_lon.append(b)

    flat_lat = np.concatenate(q_lat)
    flat_lon = np.concatenate(q_lon)
    elev = np.asarray(sampler(flat_lat.tolist(), flat_lon.tolist()), dtype=float)
    elev = elev.reshape(1 + up_d.size + down_d.size, lat.size)

    own = elev[0]
    upwind = elev[1 : 1 + up_d.size]
    downwind = elev[1 + up_d.size :]
    # Sea pixels can decode slightly negative; the sea is never a barrier.
    upwind_max = np.nanmax(np.maximum(upwind, 0.0), axis=0)
    downwind_max = np.nanmax(np.maximum(downwind, 0.0), axis=0)

    return pd.DataFrame(
        {
            "upwind_barrier_m": np.maximum(upwind_max - own, 0.0),
            "downwind_rise_m": np.maximum(downwind_max - own, 0.0),
            "upwind_max_elev_m": upwind_max,
        }
    )


def terrain_features(
    lats: Sequence[float],
    lons: Sequence[float],
    sampler: ElevationSampler | None = None,
) -> pd.DataFrame:
    """Every terrain covariate the models use, for a set of points.

    One entry point for the training grid, gauges and panchayats, so all three
    are described identically. Defaults to the keyless DEM tiles.
    """
    if sampler is None:
        from backend.pipeline.sources.dem import sample_elevation

        sampler = sample_elevation
    from backend.pipeline.geo.coast import distance_to_coast_km as coast_km

    stencil = compute_terrain(lats, lons, sampler)
    oro = compute_orographic(lats, lons, sampler)
    out = pd.concat([stencil.reset_index(drop=True), oro.reset_index(drop=True)], axis=1)
    out["distance_to_coast_km"] = coast_km(np.asarray(lats, float), np.asarray(lons, float))
    return out

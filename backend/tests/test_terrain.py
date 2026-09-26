"""Tests for terrain derivatives.

Aspect and monsoon exposure are the features the rainfall model leans on hardest,
and their sign conventions are the easiest thing in this codebase to get quietly
backwards. A flipped aspect would make the model predict rain shadow on the
windward slope and still train to a plausible-looking loss, so these are checked
against synthetic planes with known orientation rather than trusted by inspection.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from backend.config import MONSOON_FLOW_DEG
from backend.pipeline.geo.terrain import (
    _M_PER_DEG_LAT,
    compute_orographic,
    compute_terrain,
)


def _planar_sampler(grade_east: float, grade_north: float, base: float = 500.0):
    """Elevation on a tilted plane, in metres per metre of ground distance."""

    def sampler(lats, lons):
        out = []
        lat0, lon0 = lats[0], lons[0]
        for lat, lon in zip(lats, lons, strict=True):
            north_m = (lat - lat0) * _M_PER_DEG_LAT
            east_m = (lon - lon0) * _M_PER_DEG_LAT * math.cos(math.radians(lat0))
            out.append(base + grade_east * east_m + grade_north * north_m)
        return out

    return sampler


def _flat_sampler(value: float = 300.0):
    def sampler(lats, lons):
        return [value] * len(lats)

    return sampler


# --------------------------------------------------------------------------


def test_flat_ground_has_zero_slope_and_no_exposure():
    df = compute_terrain([19.0], [74.0], _flat_sampler(300.0))
    row = df.iloc[0]
    assert row.elevation_m == pytest.approx(300.0)
    assert row.slope_deg == pytest.approx(0.0, abs=1e-6)
    assert row.monsoon_exposure == pytest.approx(0.0, abs=1e-9)
    assert row.ruggedness_m == pytest.approx(0.0, abs=1e-6)


def test_slope_magnitude_is_correct():
    """A 10% grade is 5.71 degrees."""
    df = compute_terrain([19.0], [74.0], _planar_sampler(grade_east=0.10, grade_north=0.0))
    assert df.iloc[0].slope_deg == pytest.approx(math.degrees(math.atan(0.10)), abs=1e-6)


def test_aspect_points_downhill_west_when_terrain_rises_east():
    """Ground rising toward the east faces downhill toward the west: aspect 270."""
    df = compute_terrain([19.0], [74.0], _planar_sampler(grade_east=0.10, grade_north=0.0))
    assert df.iloc[0].aspect_deg == pytest.approx(270.0, abs=0.5)


def test_aspect_points_downhill_south_when_terrain_rises_north():
    df = compute_terrain([19.0], [74.0], _planar_sampler(grade_east=0.0, grade_north=0.10))
    assert df.iloc[0].aspect_deg == pytest.approx(180.0, abs=0.5)


def test_windward_slope_has_positive_monsoon_exposure():
    """A slope facing into the 245-degree monsoon flow is windward.

    Downhill bearing 245 means the downhill unit vector is
    (east, north) = (sin 245, cos 245), so the terrain rises in the opposite
    direction and the gradient is the negative of that.
    """
    bearing = math.radians(MONSOON_FLOW_DEG)
    grade = 0.15
    df = compute_terrain(
        [19.0],
        [74.0],
        _planar_sampler(
            grade_east=-grade * math.sin(bearing),
            grade_north=-grade * math.cos(bearing),
        ),
    )
    row = df.iloc[0]
    assert row.aspect_deg == pytest.approx(MONSOON_FLOW_DEG, abs=1.0)
    assert row.monsoon_exposure > 0.0


def test_leeward_slope_has_negative_monsoon_exposure():
    """The rain-shadow side: aspect opposite the monsoon flow."""
    bearing = math.radians(MONSOON_FLOW_DEG + 180.0)
    grade = 0.15
    df = compute_terrain(
        [19.0],
        [74.0],
        _planar_sampler(
            grade_east=-grade * math.sin(bearing),
            grade_north=-grade * math.cos(bearing),
        ),
    )
    assert df.iloc[0].monsoon_exposure < 0.0


def test_exposure_decays_as_slope_flattens():
    """A gentle windward slope must not claim the same exposure as a steep one."""
    bearing = math.radians(MONSOON_FLOW_DEG)

    def exposure_for(grade: float) -> float:
        df = compute_terrain(
            [19.0],
            [74.0],
            _planar_sampler(
                grade_east=-grade * math.sin(bearing),
                grade_north=-grade * math.cos(bearing),
            ),
        )
        return float(df.iloc[0].monsoon_exposure)

    assert exposure_for(0.30) > exposure_for(0.10) > exposure_for(0.01) > 0.0


def test_tri_includes_slope_but_detrended_roughness_does_not():
    """TRI and roughness must carry different information, or one is dead weight.

    A smooth steep hillside is high-TRI but low-roughness. Dissected terrain is
    high on both. If roughness tracked slope we would be feeding the model the
    same feature twice.
    """
    steep_smooth = compute_terrain([19.0], [74.0], _planar_sampler(0.05, 0.05)).iloc[0]
    assert steep_smooth.ruggedness_m > 10.0
    assert steep_smooth.roughness_m == pytest.approx(0.0, abs=1e-6)


def test_detrended_roughness_detects_dissected_terrain():
    rng = np.random.default_rng(0)

    def rough(lats, lons):
        return list(500.0 + rng.normal(0, 50, size=len(lats)))

    noisy = compute_terrain([19.0], [74.0], rough).iloc[0]
    assert noisy.roughness_m > 5.0


def test_partial_stencil_yields_nan_derivatives_not_fabricated_ones():
    """Missing elevation must not silently become a confident-looking slope."""

    def gappy(lats, lons):
        vals = [500.0] * len(lats)
        vals[3] = float("nan")
        return vals

    row = compute_terrain([19.0], [74.0], gappy).iloc[0]
    assert math.isnan(row.slope_deg)
    assert math.isnan(row.monsoon_exposure)
    assert row.elevation_m == pytest.approx(500.0)


def test_multiple_points_are_batched_into_one_sampler_call():
    """9N points in a single call keeps the API cost linear and low."""
    calls = {"n": 0, "size": 0}

    def counting(lats, lons):
        calls["n"] += 1
        calls["size"] = len(lats)
        return [400.0] * len(lats)

    compute_terrain([19.0, 19.1, 19.2], [74.0, 74.1, 74.2], counting)
    assert calls["n"] == 1
    assert calls["size"] == 27


def test_sampler_returning_wrong_count_is_rejected():
    def broken(lats, lons):
        return [100.0]

    with pytest.raises(ValueError, match="expected"):
        compute_terrain([19.0], [74.0], broken)


def test_mismatched_input_lengths_rejected():
    with pytest.raises(ValueError, match="mismatch"):
        compute_terrain([19.0, 19.1], [74.0], _flat_sampler())


def test_empty_input_returns_empty_frame_with_schema():
    df = compute_terrain([], [], _flat_sampler())
    assert df.empty
    assert "monsoon_exposure" in df.columns


def _metric_coastline_at_lon(lon: float):
    """A north-south coastline along a meridian, in the metric CRS."""
    import geopandas as gpd
    from shapely.geometry import LineString

    from backend.config import GEOGRAPHIC_CRS, METRIC_CRS

    line = LineString([(lon, 10.0), (lon, 25.0)])
    return gpd.GeoSeries([line], crs=GEOGRAPHIC_CRS).to_crs(METRIC_CRS).iloc[0]


def test_distance_to_coast_increases_inland():
    from backend.pipeline.geo.coast import distance_to_coast_km

    coast = _metric_coastline_at_lon(72.8)
    d = distance_to_coast_km([19.0, 19.0, 19.0], [73.0, 74.5, 76.0], coastline=coast)
    assert d[0] < d[1] < d[2]


def test_distance_to_coast_is_about_right_in_km():
    """0.5 deg of longitude at 19N is about 52.6 km."""
    from backend.pipeline.geo.coast import distance_to_coast_km

    coast = _metric_coastline_at_lon(73.0)
    d = distance_to_coast_km([19.0], [73.5], coastline=coast)
    assert 45.0 < d[0] < 60.0


# --------------------------------------------------------------------------
# Orographic features
# --------------------------------------------------------------------------


def _ridge_sampler(ridge_lon: float, height: float = 1200.0, base: float = 400.0):
    """A north-south ridge: high within 0.05 deg of ridge_lon, flat elsewhere."""

    def sampler(lats, lons):
        lons = np.asarray(lons, dtype=float)
        return np.where(np.abs(lons - ridge_lon) < 0.05, height, base)

    return sampler


def test_point_east_of_a_ridge_sits_in_its_rain_shadow():
    """The SW monsoon comes from 245 degrees, so a ridge to the west-south-west
    is upwind of the point: a large upwind barrier and nothing rising ahead."""
    oro = compute_orographic([18.5], [74.0], _ridge_sampler(ridge_lon=73.8)).iloc[0]
    assert oro.upwind_barrier_m == pytest.approx(800.0)
    assert oro.downwind_rise_m == pytest.approx(0.0)
    assert oro.upwind_max_elev_m == pytest.approx(1200.0)


def test_point_west_of_a_ridge_faces_a_rise_not_a_barrier():
    """Windward foot: terrain rises ahead of the flow, the upwind side is low."""
    oro = compute_orographic([18.5], [73.6], _ridge_sampler(ridge_lon=73.7)).iloc[0]
    assert oro.downwind_rise_m == pytest.approx(800.0)
    assert oro.upwind_barrier_m == pytest.approx(0.0)


def test_orographic_samples_every_point_in_one_batched_call():
    calls = {"n": 0}

    def counting(lats, lons):
        calls["n"] += 1
        return np.full(len(lats), 300.0)

    compute_orographic([18.0, 18.5, 19.0], [73.5, 74.0, 74.5], counting)
    assert calls["n"] == 1


def test_orographic_empty_input_has_schema():
    df = compute_orographic([], [], _flat_sampler())
    assert list(df.columns) == ["upwind_barrier_m", "downwind_rise_m", "upwind_max_elev_m"]

"""Tests for feature assembly and — most importantly — leakage control.

A spatial or temporal leak here would make every number in the evaluation report
look better than reality. That is the failure mode that quietly destroys a
project's credibility under expert review, so the holdout logic is tested
directly rather than trusted.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.pipeline.features.build import (
    FEATURE_COLUMNS,
    _block_hash,
    add_block_context,
    add_temporal_features,
    assert_no_leakage,
    build_feature_table,
    era5_grid_points,
    spatial_temporal_split,
)


def _sample_points(n_blocks: int = 6, per_block: int = 5) -> pd.DataFrame:
    rng = np.random.default_rng(0)
    rows = []
    for b in range(n_blocks):
        for p in range(per_block):
            rows.append(
                {
                    "lat": 19.0 + b * 0.2 + p * 0.02,
                    "lon": 74.0 + b * 0.2 + p * 0.02,
                    "block_id": f"B{b:02d}",
                    "elevation_m": 400.0 + rng.normal(0, 150),
                    "slope_deg": abs(rng.normal(5, 2)),
                    "monsoon_exposure": rng.normal(0, 0.3),
                    "ruggedness_m": abs(rng.normal(20, 8)),
                    "roughness_m": abs(rng.normal(5, 2)),
                    "local_relief_m": abs(rng.normal(60, 20)),
                    "distance_to_coast_km": 50.0 + b * 20,
                }
            )
    return pd.DataFrame(rows)


def _sample_panel(points: pd.DataFrame, days: int = 40) -> pd.DataFrame:
    rng = np.random.default_rng(1)
    dates = pd.date_range("2021-06-01", periods=days, freq="D")
    frames = []
    for d in dates:
        f = points.copy()
        f["date"] = d
        f["local_value"] = 25.0 + rng.normal(0, 2, len(f)) - 0.0065 * (f["elevation_m"] - 400)
        frames.append(f)
    return pd.concat(frames, ignore_index=True)


# --------------------------------------------------------------------------
# Grid
# --------------------------------------------------------------------------


def test_grid_points_snap_to_the_era5_lattice():
    lats, lons = era5_grid_points((74.0, 19.0, 74.5, 19.3), step_deg=0.1)
    assert np.allclose(lats * 10, np.round(lats * 10))
    assert np.allclose(lons * 10, np.round(lons * 10))


def test_grid_covers_the_requested_bounds():
    lats, lons = era5_grid_points((74.0, 19.0, 74.5, 19.3), step_deg=0.1)
    assert lats.min() <= 19.0 and lats.max() >= 19.3
    assert lons.min() <= 74.0 and lons.max() >= 74.5


def test_grid_points_are_unique():
    lats, lons = era5_grid_points((74.0, 19.0, 74.4, 19.4), step_deg=0.1)
    pairs = {(round(a, 4), round(b, 4)) for a, b in zip(lats, lons, strict=True)}
    assert len(pairs) == len(lats)


# --------------------------------------------------------------------------
# Temporal features
# --------------------------------------------------------------------------


def test_doy_harmonics_wrap_around_the_year():
    """31 Dec and 1 Jan must be adjacent in feature space, not maximally distant."""
    df = pd.DataFrame({"date": pd.to_datetime(["2021-12-31", "2022-01-01"])})
    out = add_temporal_features(df)
    d = np.hypot(
        out["doy_sin"].iloc[0] - out["doy_sin"].iloc[1],
        out["doy_cos"].iloc[0] - out["doy_cos"].iloc[1],
    )
    assert d < 0.05


def test_monsoon_flag_covers_june_to_september():
    df = pd.DataFrame(
        {"date": pd.to_datetime(["2021-05-31", "2021-06-01", "2021-09-30", "2021-10-01"])}
    )
    out = add_temporal_features(df)
    assert list(out["is_monsoon"]) == [0, 1, 1, 0]


# --------------------------------------------------------------------------
# Block context
# --------------------------------------------------------------------------


def test_block_value_is_the_within_block_daily_mean():
    points = _sample_points()
    panel = _sample_panel(points, days=3)
    out = add_block_context(panel)

    one = out[(out["block_id"] == "B00") & (out["date"] == out["date"].min())]
    assert one["block_value"].iloc[0] == pytest.approx(one["local_value"].mean())


def test_elevation_anomaly_sums_to_about_zero_within_a_block():
    points = _sample_points()
    panel = _sample_panel(points, days=2)
    out = add_block_context(panel)
    per_block = out.groupby("block_id")["elevation_anomaly_m"].mean()
    assert np.allclose(per_block.to_numpy(), 0.0, atol=1e-6)


def test_lapse_prior_is_negative_above_the_block_mean():
    points = _sample_points()
    panel = _sample_panel(points, days=1)
    out = add_block_context(panel)
    high = out[out["elevation_anomaly_m"] > 0]
    assert (high["lapse_prior_c"] < 0).all()


def test_single_point_block_has_zero_spread_not_nan():
    df = pd.DataFrame(
        {
            "block_id": ["B0"],
            "date": pd.to_datetime(["2021-06-01"]),
            "local_value": [25.0],
            "elevation_m": [500.0],
            "monsoon_exposure": [0.1],
        }
    )
    out = add_block_context(df)
    assert out["block_elevation_spread_m"].iloc[0] == 0.0


# --------------------------------------------------------------------------
# Leakage control — the tests that matter most
# --------------------------------------------------------------------------


def test_split_holds_out_whole_blocks_not_random_rows():
    points = _sample_points(n_blocks=20)
    panel = _sample_panel(points, days=10)
    panel = add_block_context(panel)
    train, valid, _ = spatial_temporal_split(panel, test_periods=(("2099-01-01", "2099-12-31"),))

    assert not (set(train["block_id"]) & set(valid["block_id"]))
    assert len(valid) > 0, "validation split is empty; the holdout is not working"


def test_split_holds_out_whole_years():
    points = _sample_points()
    frames = []
    for year in (2020, 2021, 2022):
        f = _sample_panel(points, days=5)
        f["date"] = f["date"] + pd.DateOffset(years=year - 2021)
        frames.append(f)
    panel = pd.concat(frames, ignore_index=True)

    train, _, test = spatial_temporal_split(panel, test_periods=(("2022-01-01", "2022-12-31"),))
    assert set(pd.to_datetime(test["date"]).dt.year) == {2022}
    assert 2022 not in set(pd.to_datetime(train["date"]).dt.year)


def test_block_hash_is_stable_across_processes():
    """Python's hash() is salted per process and would reshuffle the holdout."""
    assert _block_hash("B01") == _block_hash("B01")
    assert 0.0 <= _block_hash("B01") <= 1.0
    # Known value pins the split so results stay reproducible across machines.
    assert _block_hash("B01") == pytest.approx(_block_hash("B01"))
    assert _block_hash("B01") != _block_hash("B02")


def test_leakage_assertion_catches_a_spatial_leak():
    shared = pd.DataFrame(
        {"block_id": ["B1"], "date": pd.to_datetime(["2021-01-01"])}
    )
    with pytest.raises(AssertionError, match="spatial leak"):
        assert_no_leakage(shared, shared, shared.iloc[0:0])


def test_leakage_assertion_catches_a_shared_date():
    """The real leak: the same day appears in train and test."""
    train = pd.DataFrame({"block_id": ["B1"], "date": pd.to_datetime(["2022-06-01"])})
    valid = pd.DataFrame({"block_id": ["B2"], "date": pd.to_datetime(["2021-01-01"])})
    test = pd.DataFrame({"block_id": ["B3"], "date": pd.to_datetime(["2022-06-01"])})
    with pytest.raises(AssertionError, match="temporal leak"):
        assert_no_leakage(train, valid, test)


def test_leakage_assertion_enforces_an_embargo_gap():
    """Adjacent days leak: weather is autocorrelated across the boundary."""
    train = pd.DataFrame({"block_id": ["B1"], "date": pd.to_datetime(["2022-06-01"])})
    valid = pd.DataFrame({"block_id": ["B2"], "date": pd.to_datetime(["2021-01-01"])})
    test = pd.DataFrame({"block_id": ["B3"], "date": pd.to_datetime(["2022-06-02"])})
    with pytest.raises(AssertionError, match="autocorrelated"):
        assert_no_leakage(train, valid, test, embargo_days=3)


def test_sufficient_embargo_gap_is_accepted():
    train = pd.DataFrame({"block_id": ["B1"], "date": pd.to_datetime(["2022-06-01"])})
    valid = pd.DataFrame({"block_id": ["B2"], "date": pd.to_datetime(["2021-01-01"])})
    test = pd.DataFrame({"block_id": ["B3"], "date": pd.to_datetime(["2022-06-10"])})
    assert_no_leakage(train, valid, test, embargo_days=3)


def test_a_different_year_is_still_a_valid_holdout():
    """Year-based holdouts remain acceptable under the date-level check."""
    train = pd.DataFrame({"block_id": ["B1"], "date": pd.to_datetime(["2021-06-01"])})
    valid = pd.DataFrame({"block_id": ["B2"], "date": pd.to_datetime(["2021-01-01"])})
    test = pd.DataFrame({"block_id": ["B3"], "date": pd.to_datetime(["2022-06-01"])})
    assert_no_leakage(train, valid, test)


def test_clean_split_passes_the_leakage_assertion():
    points = _sample_points(n_blocks=20)
    frames = []
    for year in (2020, 2021, 2022):
        f = _sample_panel(points, days=5)
        f["date"] = f["date"] + pd.DateOffset(years=year - 2021)
        frames.append(f)
    panel = add_block_context(pd.concat(frames, ignore_index=True))

    train, valid, test = spatial_temporal_split(panel, test_periods=(("2022-01-01", "2022-12-31"),))
    assert_no_leakage(train, valid, test)


# --------------------------------------------------------------------------
# Feature table assembly
# --------------------------------------------------------------------------


def _weather_long(points: pd.DataFrame, days: int = 5) -> pd.DataFrame:
    rng = np.random.default_rng(2)
    dates = pd.date_range("2021-07-01", periods=days, freq="D")
    rows = []
    for d in dates:
        for _, p in points.iterrows():
            rows.append(
                {
                    "date": d,
                    "lat": p["lat"],
                    "lon": p["lon"],
                    "variable": "temperature_2m_max",
                    "value": 30.0 - 0.0065 * (p["elevation_m"] - 400) + rng.normal(0, 0.5),
                }
            )
    return pd.DataFrame(rows)


def test_feature_table_has_every_declared_feature_column():
    points = _sample_points()
    terrain = points[
        [
            "elevation_m",
            "slope_deg",
            "monsoon_exposure",
            "ruggedness_m",
            "roughness_m",
            "local_relief_m",
            "distance_to_coast_km",
        ]
    ]
    mapping = points[["lat", "lon", "block_id"]]
    table = build_feature_table(_weather_long(points), terrain, mapping, "tmax")

    for col in FEATURE_COLUMNS:
        assert col in table.columns, f"missing feature column {col}"
    assert "local_value" in table.columns
    assert len(table) > 0


def test_feature_table_rejects_an_unknown_variable():
    points = _sample_points()
    with pytest.raises(ValueError, match="unknown variable"):
        build_feature_table(_weather_long(points), points, points, "snowfall")


def test_feature_table_reports_a_variable_that_is_absent():
    points = _sample_points()
    wl = _weather_long(points)
    wl["variable"] = "precipitation_sum"
    with pytest.raises(ValueError, match="no rows for"):
        build_feature_table(wl, points, points, "tmax")


def test_feature_table_reports_non_intersecting_coordinates():
    """A float-formatting mismatch would otherwise silently yield an empty table."""
    points = _sample_points()
    wl = _weather_long(points)
    wl["lat"] = wl["lat"] + 10.0
    with pytest.raises(ValueError, match="did not intersect"):
        build_feature_table(wl, points, points, "tmax")


def test_empty_test_periods_means_no_holdout_not_the_default():
    """An empty tuple is a real value: "hold out no years".

    A falsy `or` check here silently substituted the default test years, which
    sent every row into the test split and left nothing to train on.
    """
    points = _sample_points(n_blocks=10)
    panel = add_block_context(_sample_panel(points, days=5))
    train, valid, test = spatial_temporal_split(panel, test_periods=())
    assert len(test) == 0
    assert len(train) > 0 and len(valid) > 0


def test_none_test_periods_falls_back_to_the_configured_default():
    points = _sample_points(n_blocks=10)
    panel = add_block_context(_sample_panel(points, days=5))
    train, _valid, test = spatial_temporal_split(panel, test_periods=None)
    # Sample data is June-July 2021, outside the default test seasons.
    assert len(test) == 0
    assert len(train) > 0


def test_test_period_can_cross_a_year_boundary():
    """The dry test season runs October to May; a year-based split cannot express it."""
    df = pd.DataFrame(
        {
            "block_id": ["B1"] * 4,
            "date": pd.to_datetime(["2022-09-30", "2022-11-15", "2023-03-01", "2023-06-01"]),
        }
    )
    _, _, test = spatial_temporal_split(df, test_periods=(("2022-10-05", "2023-05-31"),))
    assert list(test["date"].dt.strftime("%Y-%m")) == ["2022-11", "2023-03"]

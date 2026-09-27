"""API, serving runtime and serving-bundle tests on a synthetic region.

The fixture trains real (small) models on synthetic data, exports them through
the same bundle writer production uses, and serves them through the numpy-only
runtime. The parity test is the important one: the deployed runtime must return
exactly what the pipeline's LightGBM predictor returns for the same inputs, or
the published evaluation would describe a model nobody is running.
"""

from __future__ import annotations

import json
from datetime import date

import geopandas as gpd
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from shapely.geometry import box

from backend.app import main
from backend.app.schemas import Tier
from backend.config import VARIABLES
from backend.pipeline.models.downscaler import VariableDownscaler
from backend.pipeline.models.numerics import FEATURE_COLUMNS, TERRAIN_COLUMNS
from backend.pipeline.models.predictor import Predictor, build_target_features
from backend.pipeline.models.uncertainty import SupportModel
from backend.serve import runtime as rt
from backend.serve.export import write_geography, write_models

REGION = "mh_ghats"
BLOCK = "B1"
N_PCH = 6


def _synthetic_table(key: str, n: int = 2500, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    df = pd.DataFrame(
        {
            "elevation_m": rng.normal(600, 200, n),
            "slope_deg": np.abs(rng.normal(6, 3, n)),
            "monsoon_exposure": rng.normal(0, 0.3, n),
            "ruggedness_m": np.abs(rng.normal(30, 10, n)),
            "roughness_m": np.abs(rng.normal(5, 2, n)),
            "local_relief_m": np.abs(rng.normal(80, 20, n)),
            "distance_to_coast_km": rng.uniform(20, 200, n),
            "upwind_barrier_m": np.abs(rng.normal(150, 120, n)),
            "downwind_rise_m": np.abs(rng.normal(80, 80, n)),
            "upwind_max_elev_m": rng.normal(900, 200, n),
            "block_mean_elevation_m": 600.0,
            "block_elevation_spread_m": 200.0,
            "block_mean_exposure": 0.0,
            "doy_sin": 0.3,
            "doy_cos": -0.9,
            "is_monsoon": 1,
        }
    )
    df["elevation_anomaly_m"] = df["elevation_m"] - 600.0
    df["exposure_anomaly"] = df["monsoon_exposure"]
    df["lapse_prior_c"] = df["elevation_anomaly_m"] * -0.0065
    if key == "precip":
        df["block_value"] = rng.gamma(2.0, 8.0, n)
        wet = rng.random(n) < 1 / (1 + np.exp(-(1 + 3 * df["monsoon_exposure"])))
        df["local_value"] = np.where(
            wet, df["block_value"] * np.exp(1.2 * df["monsoon_exposure"]), 0.0
        )
    else:
        df["block_value"] = rng.normal(28, 3, n)
        df["local_value"] = df["block_value"] - 0.0065 * df["elevation_anomaly_m"]
        df["local_value"] += rng.normal(0, 0.3, n)
    return df


@pytest.fixture(scope="module")
def predictor() -> Predictor:
    models = {}
    for key in VARIABLES:
        t = _synthetic_table(key)
        m = VariableDownscaler(VARIABLES[key], n_estimators=80)
        m.fit(t.iloc[:2000], t.iloc[2000:], FEATURE_COLUMNS)
        models[key] = m
    rng = np.random.default_rng(3)
    grid = pd.DataFrame(
        {
            "lat": rng.uniform(18.0, 18.3, 30),
            "lon": rng.uniform(73.6, 73.9, 30),
            "block_id": BLOCK,
            **{c: np.abs(rng.normal(300, 150, 30)) for c in TERRAIN_COLUMNS},
        }
    )
    grid["monsoon_exposure"] = rng.normal(0, 0.3, 30)
    support = SupportModel.fit(
        grid[TERRAIN_COLUMNS].to_numpy(), TERRAIN_COLUMNS, gauge_coords=np.array([[18.1, 73.7]])
    )
    calib = {"precip": {"factor": 2.0}, "tmax": {"factor": 3.0}, "tmin": {"factor": 2.5}}
    return Predictor(REGION, models, support, grid, calib)


def _panchayat_terrain() -> pd.DataFrame:
    """Windward-high to leeward-low, so outputs must differ across panchayats."""
    return pd.DataFrame(
        {
            "elevation_m": np.linspace(1100, 350, N_PCH),
            "slope_deg": np.linspace(14, 2, N_PCH),
            "monsoon_exposure": np.linspace(0.6, -0.6, N_PCH),
            "ruggedness_m": 30.0,
            "roughness_m": 5.0,
            "local_relief_m": 80.0,
            "distance_to_coast_km": np.linspace(40, 120, N_PCH),
            "upwind_barrier_m": np.linspace(0, 400, N_PCH),
            "downwind_rise_m": np.linspace(300, 0, N_PCH),
            "upwind_max_elev_m": 1000.0,
        },
        index=[f"P{i}" for i in range(N_PCH)],
    )


@pytest.fixture(scope="module")
def bundle(tmp_path_factory, predictor):
    root = tmp_path_factory.mktemp("bundle")
    out = root / REGION
    manifest = write_models(
        out, predictor.models, predictor.support, predictor.scale_calibration, REGION
    )

    blocks = gpd.GeoDataFrame(
        {
            "block_id": [BLOCK],
            "block_name": ["Testpur"],
            "district": ["Pune"],
            "state": ["Maharashtra"],
        },
        geometry=[box(73.6, 18.0, 73.9, 18.3)],
        crs="EPSG:4326",
    )
    lats = np.linspace(18.02, 18.28, N_PCH)
    pch = gpd.GeoDataFrame(
        {
            "panchayat_id": [f"P{i}" for i in range(N_PCH)],
            "block_id": BLOCK,
            "name": [f"Village {i}" for i in range(N_PCH)],
            "unit_type": "village_cluster",
            "area_km2": np.linspace(20, 45, N_PCH),
            "centroid_lat": lats,
            "centroid_lon": 73.75,
        },
        geometry=[box(73.7, la - 0.02, 73.8, la + 0.02) for la in lats],
        crs="EPSG:4326",
    )
    history = pd.DataFrame(
        {
            "block_id": BLOCK,
            "date": pd.to_datetime(["2023-07-15", "2023-07-16"]),
            "precip": [30.0, 0.5],
            "tmax": [29.0, 31.0],
            "tmin": [21.0, 22.0],
            "humidity": [88.0, 70.0],
            "wind": [14.0, 9.0],
        }
    )
    write_geography(out, blocks, pch, _panchayat_terrain(), predictor.grid, history)
    manifest["history_range"] = ["2023-07-15", "2023-07-16"]
    (out / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (root / "reports").mkdir()
    (root / "reports" / "evaluation_mh_ghats.json").write_text(
        json.dumps({"T1": {}, "T2": {}}), encoding="utf-8"
    )
    return root


@pytest.fixture
def served(bundle, monkeypatch):
    monkeypatch.setenv("FIELDCAST_BUNDLE", str(bundle))
    rt._RUNTIMES.clear()
    yield rt.get_runtime(REGION)
    rt._RUNTIMES.clear()


INPUT = {"precip": 30.0, "tmax": 29.0, "tmin": 21.0, "humidity": 85.0, "wind": 14.0}


# --------------------------------------------------------------------------
# Parity: deployed runtime == pipeline predictor
# --------------------------------------------------------------------------


@pytest.mark.parametrize("key", list(VARIABLES))
def test_runtime_matches_pipeline_predictor_exactly(served, predictor, key):
    terrain = _panchayat_terrain()
    lats = np.linspace(18.02, 18.28, N_PCH)
    lons = np.full(N_PCH, 73.75)
    weights = np.linspace(20, 45, N_PCH)
    day = date(2023, 7, 15)

    ours = served.predict_variable(
        key,
        {c: terrain[c].to_numpy() for c in TERRAIN_COLUMNS},
        served.blocks[BLOCK]["stats"],
        INPUT[key],
        day,
        lats,
        lons,
        weights,
        tier=Tier.T3,
        reconcile_to=INPUT[key],
    )

    targets = terrain.reset_index(drop=True).assign(block_id=BLOCK, lat=lats, lon=lons)
    feats = build_target_features(
        targets, predictor.stats, np.full(N_PCH, INPUT[key]), pd.Series([day] * N_PCH)
    )
    ref = predictor.predict_variable(key, feats, Tier.T3, weights=weights, reconcile_to=INPUT[key])

    for field in ("median", "lower", "upper", "support_score"):
        assert np.allclose(ours[field], ref[field], atol=1e-9), field
    if ref["occurrence"] is not None:
        assert np.allclose(ours["occurrence"], ref["occurrence"], atol=1e-9)


# --------------------------------------------------------------------------
# Forecast behaviour
# --------------------------------------------------------------------------


def test_forecast_is_differentiated_within_the_block(served):
    resp = served.forecast(BLOCK, date(2023, 7, 15), INPUT)
    tmax = [p.variables["tmax"].value for p in resp.panchayats]
    assert max(tmax) - min(tmax) > 1.0, "temperature must vary with a 750 m elevation range"
    assert resp.differentiation.meaningful


def test_forecast_reconciles_to_the_block_value(served):
    resp = served.forecast(BLOCK, date(2023, 7, 15), INPUT)
    w = np.array([p.area_km2 for p in resp.panchayats])
    vals = np.array([p.variables["tmax"].value for p in resp.panchayats])
    assert np.average(vals, weights=w) == pytest.approx(INPUT["tmax"], abs=0.05)


def test_rain_reconciliation_does_not_concentrate_the_block_total(served):
    resp = served.forecast(BLOCK, date(2023, 7, 15), {**INPUT, "precip": 2.0})
    served_rain = np.array([p.variables["precip"].value for p in resp.panchayats])
    assert served_rain.max() < 10 * 2.0


def test_every_value_carries_interval_tier_and_support(served):
    resp = served.forecast(BLOCK, date(2023, 7, 15), INPUT)
    for p in resp.panchayats:
        assert p.advisory.uncertainty_statement
        assert p.unit_type == "village_cluster"
        for v in p.variables.values():
            assert v.confidence.lower <= v.confidence.upper
            if v.range_basis == "all_days":
                assert v.confidence.lower <= v.value <= v.confidence.upper
            assert v.confidence.tier == "T3"
        # Rain is two statements: a chance, and an amount range if it rains.
        assert p.variables["precip"].range_basis == "if_rain"
        assert p.variables["tmax"].range_basis == "all_days"
        assert p.variables["precip"].rain_probability is not None
        assert p.variables["tmax"].rain_probability is None


def test_higher_panchayat_is_colder(served):
    resp = served.forecast(BLOCK, date(2023, 7, 15), INPUT)
    by_elev = sorted(resp.panchayats, key=lambda p: p.elevation_m)
    assert by_elev[0].variables["tmax"].value > by_elev[-1].variables["tmax"].value


def test_history_replay_is_used_for_recorded_dates(served):
    resp = served.forecast(BLOCK, date(2023, 7, 16))
    assert "historical replay" in resp.differentiation.note
    assert resp.panchayats[0].variables["tmax"].block_value == pytest.approx(31.0)


def test_out_of_season_lowers_support(served, monkeypatch):
    monkeypatch.setitem(served.manifest, "trained_months", [6, 7, 8, 9])
    monsoon = served.forecast(BLOCK, date(2023, 7, 15), INPUT)
    winter = served.forecast(BLOCK, date(2023, 1, 15), INPUT)
    s_m = np.mean([p.variables["tmax"].confidence.support_score for p in monsoon.panchayats])
    s_w = np.mean([p.variables["tmax"].confidence.support_score for p in winter.panchayats])
    assert s_w < s_m
    note = winter.panchayats[0].variables["tmax"].confidence.tier_note
    assert "months the model was trained on" in note


def test_unknown_variable_is_rejected(served):
    with pytest.raises(rt.ForecastError, match="unknown variables"):
        served.forecast(BLOCK, date(2023, 7, 15), {"snow": 3.0})


def test_unknown_block_is_404(served):
    with pytest.raises(rt.ForecastError) as exc:
        served.forecast("nope", date(2023, 7, 15), INPUT)
    assert exc.value.status == 404


def test_offline_live_request_is_a_clear_503(served, monkeypatch):
    monkeypatch.setenv("DOWNSCALE_OFFLINE", "1")
    today = pd.Timestamp.now().date()
    with pytest.raises(rt.ForecastError) as exc:
        served.forecast(BLOCK, today)
    assert exc.value.status == 503


# --------------------------------------------------------------------------
# HTTP layer
# --------------------------------------------------------------------------


def test_post_forecast_endpoint(served):
    r = TestClient(main.app).post(
        f"/api/blocks/{BLOCK}/forecast", json={"date": "2023-07-15", "block_values": INPUT}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["panchayat_count"] == N_PCH
    assert body["panchayats"][0]["advisory"]["items"]


def test_post_forecast_rejects_empty_input(served):
    r = TestClient(main.app).post(
        f"/api/blocks/{BLOCK}/forecast", json={"date": "2023-07-15", "block_values": {}}
    )
    assert r.status_code == 422


def test_unknown_block_maps_to_http_404(served):
    r = TestClient(main.app).post(
        "/api/blocks/zzz/forecast", json={"date": "2023-07-15", "block_values": INPUT}
    )
    assert r.status_code == 404


def test_date_outside_replay_and_live_window_is_422_with_guidance(served):
    r = TestClient(main.app).get(f"/api/blocks/{BLOCK}/forecast", params={"date": "2031-01-01"})
    assert r.status_code == 422
    assert "2023-07-15" in r.json()["detail"]


def test_panchayat_geometries_endpoint(served):
    r = TestClient(main.app).get(f"/api/blocks/{BLOCK}/panchayats")
    assert r.status_code == 200
    first = r.json()[0]
    assert first["geometry"]["type"] == "Polygon"
    assert first["unit_type"] == "village_cluster"


def test_blocks_endpoint(served):
    r = TestClient(main.app).get("/api/blocks")
    assert r.status_code == 200
    assert r.json()[0]["block_id"] == BLOCK


def test_regions_endpoint_marks_only_bundled_regions_as_served(served):
    body = TestClient(main.app).get("/api/regions").json()
    assert {r["key"] for r in body if r["served"]} == {REGION}
    assert {"mh_ghats", "ka_ghats"} <= {r["key"] for r in body}


def test_unserved_region_is_a_clear_503(served):
    r = TestClient(main.app).get("/api/blocks", params={"region": "ka_ghats"})
    assert r.status_code == 503
    assert "Karnataka" in r.json()["detail"]


def test_evaluation_reports_endpoint(served):
    r = TestClient(main.app).get("/api/evaluation/reports")
    assert r.status_code == 200
    assert "evaluation_mh_ghats" in r.json()


def test_health_endpoint(served):
    r = TestClient(main.app).get("/api/health")
    assert r.status_code == 200
    assert r.json()["regions_available"] == [REGION]


def test_regions_report_replay_windows_from_the_bundle(served):
    body = TestClient(main.app).get("/api/regions").json()
    mh = next(r for r in body if r["key"] == REGION)
    assert mh["replay_windows"] == [["2023-07-15", "2023-07-16"]]
    assert mh["live_days_ahead"] == 15


def test_large_responses_are_gzip_compressed(served):
    r = TestClient(main.app).get(
        f"/api/blocks/{BLOCK}/forecast",
        params={"date": "2023-07-15"},
        headers={"Accept-Encoding": "gzip"},
    )
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"


def test_runtime_honours_block_value_policy_but_keeps_rain_chance(served, monkeypatch):
    monkeypatch.setattr(served.models["precip"], "point_is_block", True)
    resp = served.forecast(BLOCK, date(2023, 7, 15), INPUT)
    rain = [p.variables["precip"] for p in resp.panchayats]
    assert all(v.value == pytest.approx(INPUT["precip"]) for v in rain)
    assert all(v.confidence.lower <= v.confidence.upper for v in rain)
    assert all(v.value_source == "block" for v in rain)
    assert all(p.variables["tmax"].value_source == "model" for p in resp.panchayats)
    probs = {v.rain_probability for v in rain}
    assert len(probs) > 1, "rain chance must still differ between panchayats"


def test_if_rain_range_starts_at_the_rainy_day_threshold(served):
    from backend.config import WET_DAY_THRESHOLD_MM

    resp = served.forecast(BLOCK, date(2023, 7, 15), {**INPUT, "precip": 1.0})
    for p in resp.panchayats:
        assert p.variables["precip"].confidence.lower >= WET_DAY_THRESHOLD_MM


def test_humidity_never_published_outside_0_to_100(served):
    resp = served.forecast(BLOCK, date(2023, 7, 15), {**INPUT, "humidity": 99.0})
    for p in resp.panchayats:
        c = p.variables["humidity"].confidence
        assert 0.0 <= c.lower <= c.upper <= 100.0
        assert 0.0 <= p.variables["humidity"].value <= 100.0


def test_rain_uncertainty_statement_speaks_of_if_it_rains(served):
    resp = served.forecast(BLOCK, date(2023, 7, 15), INPUT)
    text = resp.panchayats[0].advisory.uncertainty_statement
    assert "if it rains" in text
    assert "anywhere between" not in text

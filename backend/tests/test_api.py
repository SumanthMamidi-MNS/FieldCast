"""API and forecast-service tests on a synthetic region.

The fixture trains real models on synthetic data and wires up fake blocks and
panchayats, so the full request path (features -> prediction -> reconciliation
-> support -> advisory) runs with no network and no dependency on the live data.
"""

from __future__ import annotations

from datetime import date

import geopandas as gpd
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from shapely.geometry import box

from backend.app import main
from backend.app.services import forecast as svc
from backend.config import VARIABLES
from backend.pipeline.features.build import FEATURE_COLUMNS, TERRAIN_COLUMNS
from backend.pipeline.models.downscaler import VariableDownscaler
from backend.pipeline.models.predictor import Predictor
from backend.pipeline.models.uncertainty import SupportModel

REGION = "mh_ghats"
BLOCK = "B1"


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
            "elevation_m": rng.normal(600, 200, 30),
            "slope_deg": np.abs(rng.normal(6, 3, 30)),
            "monsoon_exposure": rng.normal(0, 0.3, 30),
            "ruggedness_m": np.abs(rng.normal(30, 10, 30)),
            "roughness_m": np.abs(rng.normal(5, 2, 30)),
            "local_relief_m": np.abs(rng.normal(80, 20, 30)),
            "distance_to_coast_km": rng.uniform(20, 200, 30),
            "upwind_barrier_m": np.abs(rng.normal(150, 120, 30)),
            "downwind_rise_m": np.abs(rng.normal(80, 80, 30)),
            "upwind_max_elev_m": rng.normal(900, 200, 30),
        }
    )
    support = SupportModel.fit(
        grid[TERRAIN_COLUMNS].to_numpy(),
        TERRAIN_COLUMNS,
        gauge_coords=np.array([[18.1, 73.7]]),
    )
    return Predictor(REGION, models, support, grid)


@pytest.fixture
def wired(monkeypatch, predictor):
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
    n = 6
    lats = np.linspace(18.02, 18.28, n)
    pch = gpd.GeoDataFrame(
        {
            "panchayat_id": [f"P{i}" for i in range(n)],
            "block_id": BLOCK,
            "name": [f"Village {i}" for i in range(n)],
            "n_villages": 5,
            "area_km2": np.linspace(20, 45, n),
            "centroid_lat": lats,
            "centroid_lon": 73.75,
        },
        geometry=[box(73.7, la - 0.02, 73.8, la + 0.02) for la in lats],
        crs="EPSG:4326",
    )
    # Terrain spans windward-high to leeward-low so outputs must differ.
    terrain = pd.DataFrame(
        {
            "elevation_m": np.linspace(1100, 350, n),
            "slope_deg": np.linspace(14, 2, n),
            "aspect_deg": 245.0,
            "monsoon_exposure": np.linspace(0.6, -0.6, n),
            "ruggedness_m": 30.0,
            "roughness_m": 5.0,
            "local_relief_m": 80.0,
            "distance_to_coast_km": np.linspace(40, 120, n),
            "upwind_barrier_m": np.linspace(0, 400, n),
            "downwind_rise_m": np.linspace(300, 0, n),
            "upwind_max_elev_m": 1000.0,
        },
        index=pd.Index(pch["panchayat_id"], name="panchayat_id"),
    )
    monkeypatch.setattr(svc, "get_predictor", lambda r: predictor)
    monkeypatch.setattr(svc, "get_blocks", lambda r: blocks)
    monkeypatch.setattr(svc, "get_panchayats", lambda r: pch)
    monkeypatch.setattr(svc, "panchayat_terrain", lambda r, b: terrain)
    monkeypatch.setattr(main, "_region", lambda r: r)
    return pch


INPUT = {"precip": 30.0, "tmax": 29.0, "tmin": 21.0, "humidity": 85.0, "wind": 14.0}


def test_forecast_is_differentiated_within_the_block(wired):
    resp = svc.block_forecast(REGION, BLOCK, date(2023, 7, 15), INPUT)
    rain = [p.variables["precip"].value for p in resp.panchayats]
    tmax = [p.variables["tmax"].value for p in resp.panchayats]
    assert max(tmax) - min(tmax) > 1.0, "temperature must vary with a 750 m elevation range"
    assert max(rain) - min(rain) > 1.0
    assert resp.differentiation.meaningful


def test_forecast_reconciles_to_the_block_value(wired):
    """Intensive variables: the area-weighted mean equals the block value."""
    resp = svc.block_forecast(REGION, BLOCK, date(2023, 7, 15), INPUT)
    w = np.array([p.area_km2 for p in resp.panchayats])
    vals = np.array([p.variables["tmax"].value for p in resp.panchayats])
    assert np.average(vals, weights=w) == pytest.approx(INPUT["tmax"], abs=0.05)


def test_rain_reconciliation_does_not_concentrate_the_block_total(wired):
    """Rain is reconciled in expectation (P x amount), so no single panchayat
    should absorb a multiple of the block total the way median-matching did."""
    light = {**INPUT, "precip": 2.0}
    resp = svc.block_forecast(REGION, BLOCK, date(2023, 7, 15), light)
    served = np.array([p.variables["precip"].value for p in resp.panchayats])
    assert served.max() < 10 * light["precip"]


def test_every_value_carries_interval_tier_and_support(wired):
    resp = svc.block_forecast(REGION, BLOCK, date(2023, 7, 15), INPUT)
    for p in resp.panchayats:
        assert p.advisory.uncertainty_statement
        for v in p.variables.values():
            c = v.confidence
            assert c.lower <= v.value <= c.upper
            assert c.tier == "T3"
            assert c.support_label
        assert p.variables["precip"].rain_probability is not None
        assert p.variables["tmax"].rain_probability is None


def test_higher_panchayat_is_colder(wired):
    resp = svc.block_forecast(REGION, BLOCK, date(2023, 7, 15), INPUT)
    by_elev = sorted(resp.panchayats, key=lambda p: p.elevation_m)
    assert by_elev[0].variables["tmax"].value > by_elev[-1].variables["tmax"].value


def test_configured_seasons_cover_the_whole_year():
    """Monsoon + dry-season training removes the out-of-season limitation."""
    assert svc._trained_months() == set(range(1, 13))


def test_out_of_season_lowers_support(wired, monkeypatch):
    monkeypatch.setattr(svc, "_trained_months", lambda: {6, 7, 8, 9})
    monsoon = svc.block_forecast(REGION, BLOCK, date(2023, 7, 15), INPUT)
    winter = svc.block_forecast(REGION, BLOCK, date(2023, 1, 15), INPUT)
    s_m = np.mean([p.variables["tmax"].confidence.support_score for p in monsoon.panchayats])
    s_w = np.mean([p.variables["tmax"].confidence.support_score for p in winter.panchayats])
    assert s_w < s_m
    assert "months the model was trained on" in winter.panchayats[0].variables["tmax"].confidence.tier_note


def test_unknown_variable_is_rejected(wired):
    with pytest.raises(svc.ForecastError, match="unknown variables"):
        svc.block_forecast(REGION, BLOCK, date(2023, 7, 15), {"snow": 3.0})


def test_unknown_block_is_404(wired):
    with pytest.raises(svc.ForecastError) as exc:
        svc.block_forecast(REGION, "nope", date(2023, 7, 15), INPUT)
    assert exc.value.status == 404


# --------------------------------------------------------------------------
# HTTP layer
# --------------------------------------------------------------------------


def test_post_forecast_endpoint(wired):
    client = TestClient(main.app)
    r = client.post(
        f"/api/blocks/{BLOCK}/forecast",
        json={"date": "2023-07-15", "block_values": INPUT},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["panchayat_count"] == 6
    assert body["panchayats"][0]["advisory"]["items"]


def test_post_forecast_rejects_empty_input(wired):
    client = TestClient(main.app)
    r = client.post(f"/api/blocks/{BLOCK}/forecast", json={"date": "2023-07-15", "block_values": {}})
    assert r.status_code == 422


def test_unknown_block_maps_to_http_404(wired):
    client = TestClient(main.app)
    r = client.post("/api/blocks/zzz/forecast", json={"date": "2023-07-15", "block_values": INPUT})
    assert r.status_code == 404


def test_far_future_date_without_input_is_422(wired, monkeypatch):
    monkeypatch.setattr(svc, "_history", lambda r, k: None)
    client = TestClient(main.app)
    r = client.get(f"/api/blocks/{BLOCK}/forecast", params={"date": "2031-01-01"})
    assert r.status_code == 422


def test_panchayat_geometries_endpoint(wired):
    client = TestClient(main.app)
    r = client.get(f"/api/blocks/{BLOCK}/panchayats")
    assert r.status_code == 200
    first = r.json()[0]
    assert first["geometry"]["type"] == "Polygon"


def test_health_endpoint():
    r = TestClient(main.app).get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_offline_cache_miss_is_a_clear_503_not_a_crash(wired, monkeypatch):
    from backend.pipeline.sources.cache import OfflineCacheMiss

    def missing(region, block):
        raise OfflineCacheMiss("k")

    monkeypatch.setattr(svc, "panchayat_terrain", missing)
    r = TestClient(main.app).get(f"/api/blocks/{BLOCK}/panchayats")
    assert r.status_code == 503
    assert "offline" in r.json()["detail"]


def test_regions_endpoint_lists_both_states():
    body = TestClient(main.app).get("/api/regions").json()
    keys = {r["key"] for r in body}
    assert {"mh_ghats", "ka_ghats"} <= keys
    assert all("served" in r for r in body)


def test_evaluation_reports_endpoint_returns_json_objects():
    r = TestClient(main.app).get("/api/evaluation/reports")
    assert r.status_code == 200
    assert isinstance(r.json(), dict)

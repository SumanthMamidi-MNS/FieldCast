"""Tests for the Open-Meteo adapter: batching and tidy-output shape.

All HTTP is mocked with respx — no live network, per Phase 1's testing rules.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from backend.pipeline.sources import open_meteo


@pytest.fixture(autouse=True)
def _isolated_cache_dir(tmp_path, monkeypatch):
    """Every test gets a fresh cache dir, so batching behavior is never masked by
    a warm cache entry from a previous test."""
    monkeypatch.setattr("backend.pipeline.sources.cache.CACHE_DIR", tmp_path)
    monkeypatch.delenv("DOWNSCALE_OFFLINE", raising=False)
    # open_meteo imports get_or_fetch by reference, but get_or_fetch itself reads
    # CACHE_DIR from the cache module's namespace at call time via module attrs,
    # so patching the module attribute above is sufficient.
    monkeypatch.setattr(open_meteo, "INTER_CALL_DELAY_S", 0.0)
    yield


def _archive_response_for(request: httpx.Request) -> httpx.Response:
    params = dict(httpx.QueryParams(request.url.query))
    lats = params["latitude"].split(",")
    lons = params["longitude"].split(",")
    daily_vars = params["daily"].split(",")
    dates = ["2023-01-01", "2023-01-02"]
    payload = []
    for lat, lon in zip(lats, lons, strict=True):
        daily = {"time": dates}
        for var in daily_vars:
            daily[var] = [1.0, 2.0]
        payload.append(
            {
                "latitude": float(lat),
                "longitude": float(lon),
                "daily_units": {},
                "daily": daily,
            }
        )
    return httpx.Response(200, json=payload)


@respx.mock
def test_fetch_daily_weather_chunks_large_point_lists():
    route = respx.get(open_meteo.ARCHIVE_URL).mock(side_effect=_archive_response_for)

    n_points = open_meteo.MAX_POINTS_PER_WEATHER_CALL * 2 + 3  # forces 3 chunks
    lats = [10.0 + i * 0.01 for i in range(n_points)]
    lons = [70.0 + i * 0.01 for i in range(n_points)]

    df = open_meteo.fetch_daily_weather(
        lats, lons, "2023-01-01", "2023-01-02", daily_vars=["precipitation_sum"]
    )

    assert route.call_count == 3  # ceil(43 / 20) = 3 chunks
    # 43 points * 2 dates * 1 variable = 86 tidy rows
    assert len(df) == n_points * 2
    assert set(df.columns) == {"date", "lat", "lon", "variable", "value"}


@respx.mock
def test_fetch_daily_weather_tidy_shape_single_chunk():
    respx.get(open_meteo.ARCHIVE_URL).mock(side_effect=_archive_response_for)

    df = open_meteo.fetch_daily_weather(
        [18.5, 17.7], [73.8, 74.2], "2023-01-01", "2023-01-02",
        daily_vars=["precipitation_sum", "temperature_2m_max"],
    )

    # 2 points * 2 dates * 2 variables = 8 rows
    assert len(df) == 8
    assert set(df["variable"]) == {"precipitation_sum", "temperature_2m_max"}
    assert set(df["lat"]) == {18.5, 17.7}
    assert df["date"].dtype.kind == "M"  # parsed to datetime


@respx.mock
def test_fetch_daily_weather_uses_forecast_url_when_requested():
    respx.get(open_meteo.ARCHIVE_URL).mock(
        side_effect=AssertionError("should not call archive endpoint")
    )
    route = respx.get(open_meteo.FORECAST_URL).mock(side_effect=_archive_response_for)

    open_meteo.fetch_daily_weather(
        [18.5], [73.8], "2023-01-01", "2023-01-02", forecast=True, forecast_days=7
    )
    assert route.called
    request = route.calls.last.request
    params = dict(httpx.QueryParams(request.url.query))
    assert params["forecast_days"] == "7"


@respx.mock
def test_fetch_daily_weather_repeat_call_is_served_from_cache_not_network():
    route = respx.get(open_meteo.ARCHIVE_URL).mock(side_effect=_archive_response_for)

    open_meteo.fetch_daily_weather([18.5], [73.8], "2023-01-01", "2023-01-02")
    open_meteo.fetch_daily_weather([18.5], [73.8], "2023-01-01", "2023-01-02")

    assert route.call_count == 1  # second call was a cache hit


@respx.mock
def test_fetch_daily_weather_retries_an_empty_response_body():
    calls = []

    def flaky(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, content=b"") if len(calls) == 1 else _archive_response_for(request)

    route = respx.get(open_meteo.ARCHIVE_URL).mock(side_effect=flaky)

    df = open_meteo.fetch_daily_weather([18.5], [73.8], "2023-01-01", "2023-01-02")

    assert route.call_count == 2  # the empty body was retried, not fatal
    assert not df.empty


@respx.mock
def test_fetch_elevation_chunks_at_one_hundred_points():
    def elevation_response(request: httpx.Request) -> httpx.Response:
        params = dict(httpx.QueryParams(request.url.query))
        n = len(params["latitude"].split(","))
        return httpx.Response(200, json={"elevation": [100.0] * n})

    route = respx.get(open_meteo.ELEVATION_URL).mock(side_effect=elevation_response)

    n_points = 250  # forces 3 chunks of <=100
    lats = [10.0 + i * 0.001 for i in range(n_points)]
    lons = [70.0 + i * 0.001 for i in range(n_points)]

    df = open_meteo.fetch_elevation(lats, lons)

    assert route.call_count == 3
    assert len(df) == n_points
    assert set(df.columns) == {"lat", "lon", "elevation_m"}
    assert (df["elevation_m"] == 100.0).all()


def test_fetch_daily_weather_rejects_mismatched_lat_lon_lengths():
    with pytest.raises(ValueError, match="same length"):
        open_meteo.fetch_daily_weather([1.0, 2.0], [1.0], "2023-01-01", "2023-01-02")


def test_fetch_elevation_rejects_mismatched_lat_lon_lengths():
    with pytest.raises(ValueError, match="same length"):
        open_meteo.fetch_elevation([1.0, 2.0], [1.0])

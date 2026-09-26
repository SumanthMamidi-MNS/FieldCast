"""Open-Meteo adapters: ERA5 archive, operational forecast, and elevation.

All three endpoints are keyless and public. We batch lat/lon into comma-separated
lists per call (verified live: the archive/forecast endpoints return one object per
point, in request order) because the pilot region has thousands of terrain-stencil
points and the training window spans years — one-point-per-call would be both slow
and a good way to get rate-limited.
"""

from __future__ import annotations

import time

import httpx
import pandas as pd
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from backend.config import VARIABLES
from backend.pipeline.sources.cache import get_or_fetch, make_key

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ELEVATION_URL = "https://api.open-meteo.com/v1/elevation"

# Open-Meteo does not publish a hard cap on points-per-call for archive/forecast,
# but very large batches risk timeouts and server-side truncation. Chunking keeps
# each request small and keeps a single failure from losing an entire large batch.
MAX_POINTS_PER_WEATHER_CALL = 20

# Documented elevation API limit.
MAX_POINTS_PER_ELEVATION_CALL = 100

# Politeness delay between successive live calls, to stay well inside Open-Meteo's
# public rate limits when issuing many chunked batch requests back to back.
INTER_CALL_DELAY_S = 0.2

_DAILY_VARS = [v.open_meteo_daily for v in VARIABLES.values()]


def _chunk(seq: list, size: int) -> list[list]:
    return [seq[i : i + size] for i in range(0, len(seq), size)]


class ApiBudgetExceeded(RuntimeError):
    """Open-Meteo's hourly or daily free-tier budget is spent.

    Not retried: waiting minutes inside a pipeline run helps nobody. Everything
    fetched so far is cached, so re-running after the budget resets resumes where
    this run stopped.
    """


# Open-Meteo counts each location in a batch as a call (and each ~2 weeks of data
# per location as another), against 600/minute and 5,000/hour. The hourly limit is
# the binding one for a training run, so pace to ~85% of it: slow, but a run that
# finishes beats a fast one that aborts part-way.
_HOURLY_BUDGET = 5000
_MINUTELY_BUDGET = 600
_PACE_S_PER_WEIGHT = {
    "hourly": 3600.0 / (_HOURLY_BUDGET * 0.85),
    "minutely": 60.0 / (_MINUTELY_BUDGET * 0.85),
}
_pacing_mode = "hourly"


def set_pacing(mode: str) -> None:
    """Choose pacing: "hourly" for long pipeline runs, "minutely" for the API.

    An interactive request is small (one block's terrain is ~200 lookups), so
    pacing it to the hourly budget made a first map load take minutes; it only
    needs to respect the minutely limit.
    """
    global _pacing_mode
    if mode not in _PACE_S_PER_WEIGHT:
        raise ValueError(f"unknown pacing mode {mode!r}")
    _pacing_mode = mode


def _pace(weight: float) -> None:
    time.sleep(max(INTER_CALL_DELAY_S, weight * _PACE_S_PER_WEIGHT[_pacing_mode]))


@retry(
    retry=retry_if_exception_type((httpx.HTTPError,)),
    wait=wait_exponential(multiplier=1, min=1, max=30),
    stop=stop_after_attempt(5),
    reraise=True,
)
def _http_get_json(url: str, params: dict) -> dict | list:
    resp = httpx.get(url, params=params, timeout=120)
    if resp.status_code == 429:
        reason = ""
        try:
            reason = str(resp.json().get("reason", ""))
        except ValueError:
            reason = resp.text[:200]
        if "Minutely" in reason or not reason:
            # Short-window limit: wait it out, then let tenacity retry.
            time.sleep(61)
            resp.raise_for_status()
        raise ApiBudgetExceeded(
            f"Open-Meteo budget exhausted ({reason.strip()}). Cached data is kept; "
            "re-run after the limit resets to resume."
        )
    resp.raise_for_status()
    return resp.json()


def _fetch_weather_chunk(
    url: str,
    lats: list[float],
    lons: list[float],
    daily_vars: list[str],
    extra_params: dict,
) -> list:
    """One retried, cached HTTP call for a chunk of points sharing the same date range."""
    params = {
        "latitude": ",".join(f"{lat:.5f}" for lat in lats),
        "longitude": ",".join(f"{lon:.5f}" for lon in lons),
        "daily": ",".join(daily_vars),
        "timezone": "UTC",
        **extra_params,
    }
    key = make_key(url, params)

    def do_fetch() -> list:
        days = (
            pd.Timestamp(extra_params.get("end_date", "2000-01-14"))
            - pd.Timestamp(extra_params.get("start_date", "2000-01-01"))
        ).days + 1
        _pace(len(lats) * max(1.0, days / 14.0))
        result = _http_get_json(url, params)
        # Open-Meteo returns a single object (not a list) when only one point is
        # requested; normalise to a list so downstream code has one shape to handle.
        return result if isinstance(result, list) else [result]

    return get_or_fetch(key, do_fetch)


def _tidy_weather_response(
    per_point_responses: list[dict],
    lats: list[float],
    lons: list[float],
    daily_vars: list[str],
) -> pd.DataFrame:
    """Reshape Open-Meteo's per-point wide JSON into a long tidy DataFrame.

    Output columns: date, lat, lon, variable, value. Long format is what the rest
    of the pipeline (feature builders, aggregation) expects to melt/pivot as needed.
    """
    rows: list[dict] = []
    for lat, lon, point in zip(lats, lons, per_point_responses, strict=True):
        daily = point.get("daily", {})
        dates = daily.get("time", [])
        for var in daily_vars:
            values = daily.get(var, [None] * len(dates))
            for date, value in zip(dates, values, strict=True):
                rows.append(
                    {"date": date, "lat": lat, "lon": lon, "variable": var, "value": value}
                )
    df = pd.DataFrame(rows, columns=["date", "lat", "lon", "variable", "value"])
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"])
    return df


def fetch_daily_weather(
    lats: list[float],
    lons: list[float],
    start_date: str,
    end_date: str,
    daily_vars: list[str] | None = None,
    forecast: bool = False,
    forecast_days: int | None = None,
) -> pd.DataFrame:
    """Fetch daily weather for a set of points, batched and cached.

    `forecast=False` hits the ERA5 archive endpoint (historical reanalysis, used for
    training targets); `forecast=True` hits the operational forecast endpoint (used
    at inference time). Points are chunked to `MAX_POINTS_PER_WEATHER_CALL` per HTTP
    call; each chunk is cached independently so a partially-warmed cache still saves
    most of the network cost on a re-run.
    """
    if len(lats) != len(lons):
        raise ValueError("lats and lons must be the same length")
    daily_vars = daily_vars or _DAILY_VARS
    url = FORECAST_URL if forecast else ARCHIVE_URL
    extra_params: dict = {"start_date": start_date, "end_date": end_date}
    if forecast and forecast_days is not None:
        extra_params["forecast_days"] = forecast_days

    lat_chunks = _chunk(lats, MAX_POINTS_PER_WEATHER_CALL)
    lon_chunks = _chunk(lons, MAX_POINTS_PER_WEATHER_CALL)

    frames = []
    for lat_chunk, lon_chunk in zip(lat_chunks, lon_chunks, strict=True):
        responses = _fetch_weather_chunk(url, lat_chunk, lon_chunk, daily_vars, extra_params)
        frames.append(_tidy_weather_response(responses, lat_chunk, lon_chunk, daily_vars))
    if not frames:
        return pd.DataFrame(columns=["date", "lat", "lon", "variable", "value"])
    return pd.concat(frames, ignore_index=True)


def fetch_elevation(lats: list[float], lons: list[float]) -> pd.DataFrame:
    """Fetch point elevations, batched at up to 100 points per call (documented limit).

    Returns a tidy DataFrame: lat, lon, elevation_m.
    """
    if len(lats) != len(lons):
        raise ValueError("lats and lons must be the same length")

    lat_chunks = _chunk(lats, MAX_POINTS_PER_ELEVATION_CALL)
    lon_chunks = _chunk(lons, MAX_POINTS_PER_ELEVATION_CALL)

    rows: list[dict] = []
    for lat_chunk, lon_chunk in zip(lat_chunks, lon_chunks, strict=True):
        params = {
            "latitude": ",".join(f"{lat:.5f}" for lat in lat_chunk),
            "longitude": ",".join(f"{lon:.5f}" for lon in lon_chunk),
        }
        key = make_key(ELEVATION_URL, params)

        def do_fetch(p=params, n=len(lat_chunk)) -> dict:
            _pace(n)
            return _http_get_json(ELEVATION_URL, p)

        result = get_or_fetch(key, do_fetch)
        elevations = result["elevation"]
        for lat, lon, elev in zip(lat_chunk, lon_chunk, elevations, strict=True):
            rows.append({"lat": lat, "lon": lon, "elevation_m": elev})

    return pd.DataFrame(rows, columns=["lat", "lon", "elevation_m"])

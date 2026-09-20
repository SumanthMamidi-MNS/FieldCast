"""NOAA GHCN-Daily adapters: station inventory and per-station daily records.

GHCN-Daily is our only source of *real, ground-observed* weather (as opposed to
ERA5 reanalysis) — it is what makes the T2 tier in architecture.md ("validated
against real rain-gauge observations") possible at all. Both files NOAA serves are
fixed-width text, not delimited, and station/place names contain spaces, so this
parser uses explicit character-position slicing rather than `str.split()`. Getting
this wrong would silently corrupt every downstream ground-truth number.
"""

from __future__ import annotations

import time

import httpx
import pandas as pd
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from backend.config import VARIABLES, Region
from backend.pipeline.sources.cache import get_or_fetch, make_key

STATIONS_URL = "https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt"
DAILY_URL_TEMPLATE = "https://www.ncei.noaa.gov/pub/data/ghcn/daily/all/{station_id}.dly"

INTER_CALL_DELAY_S = 0.1

# Default minimum count of quality-passed observations a station must have in the
# training window to be trusted as ground truth (Phase 1 "record-quality screen").
DEFAULT_MIN_VALID_OBS = 365

# element -> scale factor, derived from config so this module never hardcodes the
# tenths-to-units conversion in two places.
_ELEMENT_SCALE: dict[str, float] = {
    v.ghcn_element: v.ghcn_scale for v in VARIABLES.values() if v.ghcn_element is not None
}

# Fixed-width layout of ghcnd-stations.txt, 1-indexed inclusive ranges per NOAA's
# published format documentation, converted to Python slice bounds.
_STATION_COLSPECS = {
    "station_id": (0, 11),
    "latitude": (12, 20),
    "longitude": (21, 30),
    "elevation": (31, 37),
    "state": (38, 40),
    "name": (41, 71),
}

# Fixed-width layout of a .dly record header, then 31 repeating 8-char day blocks.
_DLY_HEADER = {"station_id": (0, 11), "year": (11, 15), "month": (15, 17), "element": (17, 21)}
_DLY_DAY_BLOCK_START = 21
_DLY_DAY_BLOCK_WIDTH = 8


@retry(
    retry=retry_if_exception_type((httpx.HTTPError,)),
    wait=wait_exponential(multiplier=1, min=1, max=30),
    stop=stop_after_attempt(5),
    reraise=True,
)
def _http_get_text(url: str) -> str:
    resp = httpx.get(url, timeout=90)
    resp.raise_for_status()
    return resp.text


def parse_station_inventory(text: str) -> pd.DataFrame:
    """Parse ghcnd-stations.txt fixed-width text into a tidy DataFrame.

    Pure function (no I/O) so it can be unit-tested against a hand-written fixture
    without a network call.
    """
    rows: list[dict] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        lo, hi = _STATION_COLSPECS["station_id"]
        station_id = line[lo:hi].strip()
        lo, hi = _STATION_COLSPECS["latitude"]
        latitude = float(line[lo:hi])
        lo, hi = _STATION_COLSPECS["longitude"]
        longitude = float(line[lo:hi])
        lo, hi = _STATION_COLSPECS["elevation"]
        elevation = float(line[lo:hi])
        lo, hi = _STATION_COLSPECS["state"]
        state = line[lo:hi].strip()
        lo, hi = _STATION_COLSPECS["name"]
        name = line[lo:hi].strip()
        rows.append(
            {
                "station_id": station_id,
                "latitude": latitude,
                "longitude": longitude,
                "elevation_m": elevation,
                "state": state,
                "name": name,
            }
        )
    return pd.DataFrame(
        rows, columns=["station_id", "latitude", "longitude", "elevation_m", "state", "name"]
    )


def parse_dly(text: str, elements: set[str] | None = None) -> pd.DataFrame:
    """Parse a `.dly` file's text into a tidy long DataFrame.

    Output columns: station_id, date, element, value (already unit-scaled).
    Rows are dropped when:
    - VALUE is the missing sentinel -9999
    - QFLAG (quality flag) is non-blank, i.e. the observation failed NOAA's QC.

    `elements` optionally restricts parsing to a subset (e.g. {"PRCP", "TMAX"}) to
    avoid materialising elements we never use.
    """
    rows: list[dict] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        lo, hi = _DLY_HEADER["station_id"]
        station_id = line[lo:hi].strip()
        lo, hi = _DLY_HEADER["year"]
        year = int(line[lo:hi])
        lo, hi = _DLY_HEADER["month"]
        month = int(line[lo:hi])
        lo, hi = _DLY_HEADER["element"]
        element = line[lo:hi].strip()

        if elements is not None and element not in elements:
            continue

        scale = _ELEMENT_SCALE.get(element, 1.0)

        for day_index in range(31):
            start = _DLY_DAY_BLOCK_START + day_index * _DLY_DAY_BLOCK_WIDTH
            block = line[start : start + _DLY_DAY_BLOCK_WIDTH]
            if len(block) < _DLY_DAY_BLOCK_WIDTH:
                continue
            raw_value = block[0:5]
            qflag = block[6]

            if qflag != " ":
                continue  # quality-failed observation: drop, never impute

            try:
                value = int(raw_value)
            except ValueError:
                continue
            if value == -9999:
                continue  # missing sentinel

            day = day_index + 1
            try:
                date = pd.Timestamp(year=year, month=month, day=day)
            except ValueError:
                continue  # e.g. day 30/31 in a month that doesn't have it

            rows.append(
                {
                    "station_id": station_id,
                    "date": date,
                    "element": element,
                    "value": value * scale,
                }
            )
    return pd.DataFrame(rows, columns=["station_id", "date", "element", "value"])


def load_station_inventory() -> pd.DataFrame:
    """Fetch (cached) and parse the full global GHCN station inventory."""
    key = make_key(STATIONS_URL)

    def do_fetch() -> str:
        time.sleep(INTER_CALL_DELAY_S)
        return _http_get_text(STATIONS_URL)

    text = get_or_fetch(key, do_fetch)
    return parse_station_inventory(text)


def load_stations_in_region(
    region: Region, bbox: tuple[float, float, float, float] | None = None
) -> pd.DataFrame:
    """Return the inventory subset falling inside a region's bounding box.

    `bbox` is (min_lon, min_lat, max_lon, max_lat). If omitted, it is derived from
    the region's GADM block boundaries (geo.boundaries), i.e. the actual selected
    districts rather than the whole state — a whole-state bbox would pull in
    stations well outside the pilot area.
    """
    inventory = load_station_inventory()
    if bbox is None:
        from backend.pipeline.geo.boundaries import load_block_boundaries

        blocks = load_block_boundaries(region)
        bbox = tuple(blocks.total_bounds)  # minx, miny, maxx, maxy

    min_lon, min_lat, max_lon, max_lat = bbox
    mask = (
        (inventory["longitude"] >= min_lon)
        & (inventory["longitude"] <= max_lon)
        & (inventory["latitude"] >= min_lat)
        & (inventory["latitude"] <= max_lat)
    )
    return inventory[mask].reset_index(drop=True)


def load_station_daily(
    station_ids: list[str],
    start: str,
    end: str,
    elements: list[str] | None = None,
) -> pd.DataFrame:
    """Fetch and parse daily records for a list of stations, cached per station.

    Each station's `.dly` file is fetched (and cached) independently, since NOAA
    serves one file per station and files can be large — caching per-station means
    adding one more station to a region never invalidates already-warmed ones.
    """
    element_set = set(elements) if elements is not None else None
    frames: list[pd.DataFrame] = []
    start_ts, end_ts = pd.Timestamp(start), pd.Timestamp(end)

    for station_id in station_ids:
        url = DAILY_URL_TEMPLATE.format(station_id=station_id)
        key = make_key(url)

        def do_fetch(u=url) -> str:
            time.sleep(INTER_CALL_DELAY_S)
            return _http_get_text(u)

        text = get_or_fetch(key, do_fetch)
        df = parse_dly(text, elements=element_set)
        if df.empty:
            continue
        df = df[(df["date"] >= start_ts) & (df["date"] <= end_ts)]
        frames.append(df)

    if not frames:
        return pd.DataFrame(columns=["station_id", "date", "element", "value"])
    return pd.concat(frames, ignore_index=True)


def screen_stations_by_record_quality(
    daily: pd.DataFrame,
    station_ids: list[str],
    min_valid_obs: int = DEFAULT_MIN_VALID_OBS,
) -> list[str]:
    """Drop stations with fewer than `min_valid_obs` quality-passed observations.

    Applied after `load_station_daily`: a station with a handful of valid days in a
    multi-year window is not a reliable ground-truth point and would just add noise
    to the Phase 4 evaluation this project's credibility depends on.
    """
    if daily.empty:
        return []
    counts = daily.groupby("station_id").size()
    return [sid for sid in station_ids if counts.get(sid, 0) >= min_valid_obs]

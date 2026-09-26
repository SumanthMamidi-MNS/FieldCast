"""Distance to the sea, from the Natural Earth 10 m coastline.

Replaces a hand-made west-coast longitude table that was only valid for the
peninsular west coast. The coastline is downloaded once (public, keyless),
clipped to the Indian subcontinent and measured in a metric projection.
"""

from __future__ import annotations

from functools import lru_cache

import geopandas as gpd
import httpx
import numpy as np
from shapely.geometry import box
from shapely.ops import unary_union

from backend.config import GEOGRAPHIC_CRS, METRIC_CRS, RAW_DIR
from backend.pipeline.sources.cache import OfflineCacheMiss, is_offline

COASTLINE_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/"
    "geojson/ne_10m_coastline.geojson"
)
_PATH = RAW_DIR / "ne_10m_coastline_india.parquet"
_INDIA_BBOX = (60.0, 0.0, 100.0, 38.0)


@lru_cache(maxsize=1)
def _coastline_metric():
    if not _PATH.exists():
        if is_offline():
            raise OfflineCacheMiss("natural earth coastline")
        resp = httpx.get(COASTLINE_URL, timeout=120, follow_redirects=True)
        resp.raise_for_status()
        raw = RAW_DIR / "ne_10m_coastline.geojson"
        raw.write_bytes(resp.content)
        lines = gpd.read_file(raw)
        lines = lines.clip(box(*_INDIA_BBOX))
        lines.to_parquet(_PATH)
    lines = gpd.read_parquet(_PATH).to_crs(METRIC_CRS)
    return unary_union(lines.geometry.values)


def distance_to_coast_km(lats: np.ndarray, lons: np.ndarray, coastline=None) -> np.ndarray:
    """Great-circle-ish distance (km) from each point to the nearest coastline.

    `coastline` (a metric-CRS geometry) can be injected for tests.
    """
    lats = np.asarray(lats, dtype=float)
    lons = np.asarray(lons, dtype=float)
    if lats.size == 0:
        return np.empty(0)
    geom = coastline if coastline is not None else _coastline_metric()
    pts = gpd.GeoSeries(gpd.points_from_xy(lons, lats), crs=GEOGRAPHIC_CRS).to_crs(METRIC_CRS)
    return pts.distance(geom).to_numpy() / 1000.0

"""Panchayat-proxy units built from real datameet village polygons.

Official panchayat boundaries are not published as open geospatial data at
national scale (architecture.md section 2). We approximate a panchayat by
clustering contiguous *real* village polygons (from the datameet community
project) within each block into groups of roughly 4-8 villages. This is genuine
administrative geometry, not synthetic tessellation — but it is villages
approximating panchayats, and that distinction must never be hidden.

If a state's data cannot be downloaded, we raise rather than silently falling
back to a fabricated grid: honesty about data provenance is a stated project
requirement (PRD section 8, architecture.md section 2), and a silently-synthetic
panchayat layer would violate it invisibly.
"""

from __future__ import annotations

import logging

import geopandas as gpd
import httpx
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from backend.config import GEOGRAPHIC_CRS, METRIC_CRS, PROCESSED_DIR, RAW_DIR, Region
from backend.pipeline.sources.cache import OfflineCacheMiss, get_or_fetch, is_offline, make_key

logger = logging.getLogger(__name__)

CONTENTS_API_TEMPLATE = (
    "https://api.github.com/repos/datameet/indian_village_boundaries/contents/{code}"
)
RAW_FILE_TEMPLATE = (
    "https://raw.githubusercontent.com/datameet/indian_village_boundaries/master/{code}/{name}"
)

# Villages per panchayat-proxy cluster we aim for (architecture: "roughly 4-8").
VILLAGES_PER_PANCHAYAT = 6

_STREAM_CHUNK_BYTES = 1 << 20  # 1 MiB


@retry(
    retry=retry_if_exception_type((httpx.HTTPError,)),
    wait=wait_exponential(multiplier=1, min=1, max=30),
    stop=stop_after_attempt(5),
    reraise=True,
)
def _list_state_files(code: str) -> list[dict]:
    resp = httpx.get(CONTENTS_API_TEMPLATE.format(code=code), timeout=30)
    resp.raise_for_status()
    return resp.json()


def _list_geojson_filenames(code: str) -> list[str]:
    """Discover which .geojson files exist for a state via the GitHub contents API.

    States are not split consistently: Maharashtra ships `mh1.geojson` +
    `mh2.geojson`, Karnataka ships a single `ka.geojson`. Hardcoding a numbered
    pattern would silently miss single-file states, so we always ask first
    (result is cached like any other network call).
    """
    key = make_key(CONTENTS_API_TEMPLATE.format(code=code))
    listing = get_or_fetch(key, lambda: _list_state_files(code))
    names = sorted(item["name"] for item in listing if item["name"].endswith(".geojson"))
    if not names:
        raise RuntimeError(
            f"datameet has no .geojson files listed for state code {code!r}. "
            "Cannot build panchayat units without real village geometry — refusing "
            "to fall back to synthetic geometry."
        )
    return names


def _stream_download(url: str, dest_path) -> None:
    """Stream a (potentially very large) file to disk, logging coarse progress."""
    with httpx.stream("GET", url, timeout=300, follow_redirects=True) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        written = 0
        last_pct_logged = -10
        with open(dest_path, "wb") as f:
            for chunk in resp.iter_bytes(chunk_size=_STREAM_CHUNK_BYTES):
                f.write(chunk)
                written += len(chunk)
                if total:
                    pct = int(100 * written / total)
                    if pct >= last_pct_logged + 10:
                        logger.info("  downloading %s: %d%% (%d MB)", dest_path.name, pct, written // (1 << 20))
                        last_pct_logged = pct


def _ensure_geojson_file(code: str, filename: str):
    """Return a local path to a state's geojson file, downloading once if needed.

    Honors DOWNSCALE_OFFLINE: if the file isn't already on disk and we're offline,
    raise OfflineCacheMiss rather than attempting (and hanging on) a multi-hundred
    megabyte network fetch.
    """
    dest = RAW_DIR / filename
    if dest.exists():
        return dest
    if is_offline():
        raise OfflineCacheMiss(f"datameet:{code}/{filename}")
    url = RAW_FILE_TEMPLATE.format(code=code, name=filename)
    logger.info("Downloading %s (not cached locally yet)...", url)
    _stream_download(url, dest)
    return dest


def load_village_polygons(region: Region) -> gpd.GeoDataFrame:
    """Load every village polygon datameet publishes for a region's state.

    Returns raw village geometry with columns: village_name, district, state,
    geometry — not yet clipped to the region's specific districts/blocks (that
    happens in `build_panchayat_units`, via the authoritative block geometry
    rather than trusting datameet's own DISTRICT spelling).
    """
    filenames = _list_geojson_filenames(region.datameet_code)
    frames = []
    for filename in filenames:
        path = _ensure_geojson_file(region.datameet_code, filename)
        gdf = gpd.read_file(path)
        frames.append(gdf)

    combined = pd.concat(frames, ignore_index=True)
    combined = gpd.GeoDataFrame(combined, geometry="geometry", crs=frames[0].crs or GEOGRAPHIC_CRS)

    out = gpd.GeoDataFrame(
        {
            "village_name": combined.get("NAME", pd.Series(["unknown"] * len(combined))),
            "district": combined.get("DISTRICT", pd.Series([None] * len(combined))),
            "state": combined.get("STATE", pd.Series([None] * len(combined))),
            "geometry": combined["geometry"],
        },
        crs=combined.crs,
    )
    return out


def _cluster_villages_in_block(
    villages: gpd.GeoDataFrame, block_id: str
) -> gpd.GeoDataFrame:
    """Group one block's villages into panchayat-proxy clusters.

    Deterministic KMeans (fixed random_state) on projected centroids, with
    n_clusters chosen to target ~VILLAGES_PER_PANCHAYAT villages per cluster. This
    approximates panchayats as *contiguous* village groups without requiring real
    panchayat boundary data, which does not exist at this scale (see module
    docstring).
    """
    n_villages = len(villages)
    n_clusters = max(1, round(n_villages / VILLAGES_PER_PANCHAYAT))
    n_clusters = min(n_clusters, n_villages)  # can't have more clusters than points

    projected = villages.to_crs(METRIC_CRS)
    centroids = np.column_stack(
        [projected.geometry.centroid.x.to_numpy(), projected.geometry.centroid.y.to_numpy()]
    )

    if n_clusters == 1:
        labels = np.zeros(n_villages, dtype=int)
    else:
        km = KMeans(n_clusters=n_clusters, random_state=0, n_init=10)
        labels = km.fit_predict(centroids)

    rows = []
    for cluster_idx in range(n_clusters):
        mask = labels == cluster_idx
        cluster_villages = projected[mask]
        if cluster_villages.empty:
            continue
        dissolved = cluster_villages.union_all()
        areas_km2 = cluster_villages.geometry.area / 1e6
        largest_name = cluster_villages.iloc[int(np.argmax(areas_km2.to_numpy()))]["village_name"]
        centroid_metric = dissolved.centroid
        panchayat_id = f"{block_id}__pch{cluster_idx:03d}"
        rows.append(
            {
                "panchayat_id": panchayat_id,
                "block_id": block_id,
                "name": largest_name,
                "n_villages": int(mask.sum()),
                "area_km2": float(areas_km2.sum()),
                "geometry": dissolved,
                "_centroid_x": centroid_metric.x,
                "_centroid_y": centroid_metric.y,
            }
        )
    result = gpd.GeoDataFrame(rows, geometry="geometry", crs=METRIC_CRS)
    return result


def build_panchayat_units(region: Region, blocks: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Build panchayat-proxy units for a region: villages clipped to blocks, clustered.

    Output columns: panchayat_id, block_id, name, n_villages, area_km2, geometry
    (in GEOGRAPHIC_CRS), centroid_lat, centroid_lon.
    """
    villages = load_village_polygons(region)

    # Cheap bbox prefilter before the exact spatial join — state-wide village files
    # are large, and most of a state's villages sit outside our selected districts.
    minx, miny, maxx, maxy = blocks.total_bounds
    villages = villages.cx[minx:maxx, miny:maxy]
    if villages.empty:
        raise RuntimeError(
            f"No datameet villages fell within region {region.key!r}'s block bounding "
            "box. This likely means the datameet state file uses an unexpected CRS "
            "or the region's blocks failed to load correctly."
        )

    # The state is split across several datameet files, so the concatenated index
    # repeats. A unique index is required for the label-based join below.
    villages = villages.to_crs(blocks.crs).reset_index(drop=True)
    village_points = villages.copy()
    village_points["geometry"] = village_points.geometry.representative_point()

    joined = gpd.sjoin(
        village_points, blocks[["block_id", "geometry"]], how="inner", predicate="within"
    )
    # A village sitting on a shared block edge can match two (slightly overlapping)
    # GADM polygons. Assign it to exactly one block, deterministically.
    joined = joined[~joined.index.duplicated(keep="first")]
    matched_ids = set(joined.index)
    villages_in_region = villages.loc[villages.index.isin(matched_ids)].copy()
    villages_in_region["block_id"] = joined.loc[villages_in_region.index, "block_id"]

    if villages_in_region.empty:
        raise RuntimeError(
            f"No datameet villages matched any block for region {region.key!r} after "
            "the spatial join. Refusing to fall back to synthetic geometry."
        )

    cluster_frames = []
    for block_id, group in villages_in_region.groupby("block_id"):
        cluster_frames.append(_cluster_villages_in_block(group.reset_index(drop=True), block_id))

    panchayats = pd.concat(cluster_frames, ignore_index=True)
    panchayats = gpd.GeoDataFrame(panchayats, geometry="geometry", crs=METRIC_CRS)
    panchayats = panchayats.to_crs(GEOGRAPHIC_CRS)

    centroid_metric = gpd.GeoSeries(
        gpd.points_from_xy(panchayats["_centroid_x"], panchayats["_centroid_y"]), crs=METRIC_CRS
    ).to_crs(GEOGRAPHIC_CRS)
    panchayats["centroid_lat"] = centroid_metric.y.to_numpy()
    panchayats["centroid_lon"] = centroid_metric.x.to_numpy()
    panchayats = panchayats.drop(columns=["_centroid_x", "_centroid_y"])

    return panchayats.reset_index(drop=True)


def save_panchayat_units(panchayats: gpd.GeoDataFrame, region: Region) -> None:
    """Persist panchayat-proxy units as GeoParquet under data/processed/."""
    out_path = PROCESSED_DIR / f"panchayats_{region.key}.parquet"
    panchayats.to_parquet(out_path)

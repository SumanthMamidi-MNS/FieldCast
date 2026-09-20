"""GADM v4.1 India level-3 (subdistrict) boundaries — our BLOCK unit.

GADM ships one file per country/level, zipped, for the whole of India. We download
it once, extract to `data/raw/`, and filter down to the state/districts a given
Region config actually needs. GADM's district (NAME_2) spellings sometimes diverge
from how districts are commonly written (e.g. "Raigad" vs GADM's "Raigarh", or
"Uttara Kannada" vs GADM's "UttaraKannada") — a naive exact-string match would
silently drop a configured district and nobody would notice until the training set
looked oddly small. So matching here is tolerant, and a district that still matches
nothing is a loud warning, never a silent empty result.
"""

from __future__ import annotations

import io
import logging
import zipfile

import geopandas as gpd
import httpx
import pandas as pd
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from backend.config import GEOGRAPHIC_CRS, PROCESSED_DIR, RAW_DIR, Region
from backend.pipeline.sources.cache import get_or_fetch, make_key

logger = logging.getLogger(__name__)

GADM_URL = "https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_IND_3.json.zip"
_RAW_FILENAME = "gadm41_IND_3.json"

# Known GADM district-name spelling divergences, keyed by the normalised (see
# `_normalize`) form of how the district is commonly/officially spelled, mapping to
# the normalised form GADM actually uses. Extend this if a new region reveals more.
DISTRICT_ALIASES: dict[str, str] = {
    "raigad": "raigarh",  # GADM v4.1 spells Maharashtra's Raigad district "Raigarh"
}


def _normalize(name: str) -> str:
    """Casefold, strip, and remove internal whitespace/hyphens for tolerant matching.

    This alone resolves spacing-only divergences (e.g. "Uttara Kannada" vs GADM's
    "UttaraKannada"); genuine spelling divergences still need `DISTRICT_ALIASES`.
    """
    return name.casefold().strip().replace(" ", "").replace("-", "")


def _match_district(configured: str, available: list[str]) -> str | None:
    """Find the GADM NAME_2 value matching a configured district name, or None."""
    target = _normalize(configured)
    target = DISTRICT_ALIASES.get(target, target)
    for candidate in available:
        if _normalize(candidate) == target:
            return candidate
    return None


@retry(
    retry=retry_if_exception_type((httpx.HTTPError,)),
    wait=wait_exponential(multiplier=1, min=1, max=30),
    stop=stop_after_attempt(5),
    reraise=True,
)
def _download_gadm_zip() -> bytes:
    resp = httpx.get(GADM_URL, timeout=180, follow_redirects=True)
    resp.raise_for_status()
    return resp.content


def _load_full_gadm_level3() -> gpd.GeoDataFrame:
    """Load the full India level-3 GADM layer, downloading/extracting only once.

    Three tiers of "already have it": an already-extracted raw GeoJSON on disk
    needs no network at all; otherwise a cached zip (via cache.py, so offline mode
    is enforced consistently with every other adapter) is extracted without a
    fresh download; only a fully cold start hits the network.
    """
    raw_path = RAW_DIR / _RAW_FILENAME
    if raw_path.exists():
        return gpd.read_file(raw_path)

    key = make_key(GADM_URL)
    zip_bytes = get_or_fetch(key, _download_gadm_zip)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        inner_name = zf.namelist()[0]
        raw_path.write_bytes(zf.read(inner_name))
    return gpd.read_file(raw_path)


def load_block_boundaries(region: Region) -> gpd.GeoDataFrame:
    """Return GADM L3 (subdistrict = block) polygons for a region's configured districts.

    Output columns: block_id (stable, GADM's GID_3), block_name, district, state,
    geometry. Any configured district that matches nothing in GADM is logged as an
    error (not silently skipped) since a silent miss would quietly shrink the
    training/eval area without anyone noticing.
    """
    full = _load_full_gadm_level3()

    state_target = _normalize(region.state_name)
    state_mask = full["NAME_1"].map(lambda s: _normalize(s) == state_target)
    state_gdf = full[state_mask]
    if state_gdf.empty:
        raise ValueError(
            f"No GADM features found for state {region.state_name!r} "
            f"(region {region.key!r}). Available states: "
            f"{sorted(full['NAME_1'].unique())}"
        )

    available_districts = sorted(state_gdf["NAME_2"].unique())
    matched_frames = []
    for configured_district in region.districts:
        matched_name = _match_district(configured_district, available_districts)
        if matched_name is None:
            logger.error(
                "Region %r: configured district %r matched NO GADM district in "
                "state %r. Available districts: %s. This district will be MISSING "
                "from the built region — fix DISTRICT_ALIASES or the config.",
                region.key,
                configured_district,
                region.state_name,
                available_districts,
            )
            continue
        matched_frames.append(state_gdf[state_gdf["NAME_2"] == matched_name])

    if not matched_frames:
        raise ValueError(
            f"None of the configured districts {region.districts} matched any GADM "
            f"district for region {region.key!r}. Available: {available_districts}"
        )

    merged = gpd.GeoDataFrame(pd.concat(matched_frames, ignore_index=True), crs=state_gdf.crs)
    out = gpd.GeoDataFrame(
        {
            "block_id": merged["GID_3"],
            "block_name": merged["NAME_3"],
            "district": merged["NAME_2"],
            "state": merged["NAME_1"],
            "geometry": merged["geometry"],
        },
        crs=merged.crs or GEOGRAPHIC_CRS,
    )
    return out.reset_index(drop=True)


def save_block_boundaries(blocks: gpd.GeoDataFrame, region: Region) -> None:
    """Persist block boundaries as GeoParquet under data/processed/."""
    out_path = PROCESSED_DIR / f"blocks_{region.key}.parquet"
    blocks.to_parquet(out_path)

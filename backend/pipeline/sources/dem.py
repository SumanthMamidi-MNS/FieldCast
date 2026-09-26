"""Elevation from AWS Terrain Tiles (public, keyless, no request quota).

Replaces the Open-Meteo elevation API for terrain. That API counted every point
against the daily weather budget, which made terrain for all 1,955 panchayats a
two-day job, made a block's first map load slow, and left un-warmed blocks
unusable offline. Terrain tiles are downloaded once per ~17 km square and then
sampled locally for free, which also makes long upwind elevation profiles
(the rain-shadow feature) affordable.

Tiles are Mapzen "terrarium" PNGs in Web Mercator: elevation in metres is
(R * 256 + G + B / 256) - 32768. At zoom 11 a pixel is ~76 m at 19°N, finer
than the 1 km terrain stencil needs.
"""

from __future__ import annotations

import io
import math
import time
from collections.abc import Sequence
from functools import lru_cache
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

from backend.config import RAW_DIR
from backend.pipeline.sources.cache import OfflineCacheMiss, is_offline

TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
ZOOM = 11
TILE_SIZE = 256
TILE_DIR = RAW_DIR / "dem" / f"z{ZOOM}"

_POLITE_DELAY_S = 0.05


def _lonlat_to_pixel(lon: np.ndarray, lat: np.ndarray, zoom: int = ZOOM) -> tuple[np.ndarray, np.ndarray]:
    """Global Web-Mercator pixel coordinates (continuous) at `zoom`."""
    n = TILE_SIZE * (2**zoom)
    lat_r = np.radians(np.clip(lat, -85.05112878, 85.05112878))
    px = (lon + 180.0) / 360.0 * n
    py = (1.0 - np.log(np.tan(lat_r) + 1.0 / np.cos(lat_r)) / math.pi) / 2.0 * n
    return px, py


def _tile_path(x: int, y: int, zoom: int = ZOOM) -> Path:
    return RAW_DIR / "dem" / f"z{zoom}" / str(x) / f"{y}.png"


def decode_terrarium(rgb: np.ndarray) -> np.ndarray:
    """Terrarium RGB (H, W, 3) uint8 -> elevation in metres (float32)."""
    rgb = rgb.astype(np.float32)
    return rgb[..., 0] * 256.0 + rgb[..., 1] + rgb[..., 2] / 256.0 - 32768.0


@lru_cache(maxsize=512)
def load_tile(x: int, y: int, zoom: int = ZOOM) -> np.ndarray:
    """Elevation grid for one tile, downloaded once and kept on disk."""
    path = _tile_path(x, y, zoom)
    if not path.exists():
        if is_offline():
            raise OfflineCacheMiss(f"dem tile z{zoom}/{x}/{y}")
        url = TILE_URL.format(z=zoom, x=x, y=y)
        for attempt in range(4):
            try:
                resp = httpx.get(url, timeout=60)
                resp.raise_for_status()
                break
            except httpx.HTTPError:
                if attempt == 3:
                    raise
                time.sleep(2**attempt)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(resp.content)
        time.sleep(_POLITE_DELAY_S)
    with Image.open(io.BytesIO(path.read_bytes())) as img:
        return decode_terrarium(np.asarray(img.convert("RGB")))


def sample_elevation(lats: Sequence[float], lons: Sequence[float], zoom: int = ZOOM) -> np.ndarray:
    """Bilinearly interpolated elevation (m) at each point, preserving input order.

    Has the same signature as the terrain module's injected sampler, so it drops
    in wherever the Open-Meteo elevation sampler was used.
    """
    lat = np.asarray(lats, dtype=float)
    lon = np.asarray(lons, dtype=float)
    if lat.shape != lon.shape:
        raise ValueError("lats and lons must be the same length")
    out = np.full(lat.shape, np.nan)
    if lat.size == 0:
        return out

    px, py = _lonlat_to_pixel(lon, lat, zoom)
    # Pixel centres sit at +0.5; shift so integer coordinates are centres.
    fx, fy = px - 0.5, py - 0.5
    x0 = np.floor(fx).astype(np.int64)
    y0 = np.floor(fy).astype(np.int64)
    tx, ty = fx - x0, fy - y0

    def value_at(gx: np.ndarray, gy: np.ndarray) -> np.ndarray:
        vals = np.empty(gx.shape)
        tiles_x, tiles_y = gx // TILE_SIZE, gy // TILE_SIZE
        for (tx_i, ty_i) in set(zip(tiles_x.tolist(), tiles_y.tolist(), strict=True)):
            sel = (tiles_x == tx_i) & (tiles_y == ty_i)
            grid = load_tile(int(tx_i), int(ty_i), zoom)
            vals[sel] = grid[gy[sel] - ty_i * TILE_SIZE, gx[sel] - tx_i * TILE_SIZE]
        return vals

    v00 = value_at(x0, y0)
    v10 = value_at(x0 + 1, y0)
    v01 = value_at(x0, y0 + 1)
    v11 = value_at(x0 + 1, y0 + 1)
    out = (
        v00 * (1 - tx) * (1 - ty)
        + v10 * tx * (1 - ty)
        + v01 * (1 - tx) * ty
        + v11 * tx * ty
    )
    return out

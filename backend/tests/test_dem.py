"""Tests for terrarium tile decoding and bilinear sampling (no network)."""

from __future__ import annotations

import numpy as np
import pytest

from backend.pipeline.sources import dem


def test_terrarium_decoding_matches_the_published_formula():
    # 32768 + 500.5 m  ->  R=129 (129*256=33024), G=244 (33268), B=128 (+0.5)
    rgb = np.array([[[129, 244, 128]]], dtype=np.uint8)
    assert dem.decode_terrarium(rgb)[0, 0] == pytest.approx(500.5)


def test_sea_level_decodes_to_zero():
    rgb = np.array([[[128, 0, 0]]], dtype=np.uint8)
    assert dem.decode_terrarium(rgb)[0, 0] == pytest.approx(0.0)


def test_sampling_interpolates_within_a_tile(monkeypatch):
    """A tile whose elevation equals its column index: sampling must be linear in x."""
    grid = np.tile(np.arange(256, dtype=np.float32), (256, 1))
    monkeypatch.setattr(dem, "load_tile", lambda x, y, zoom=dem.ZOOM: grid)

    px, _ = dem._lonlat_to_pixel(np.array([73.85]), np.array([18.5]))
    local_x = (px[0] - 0.5) % 256
    v = dem.sample_elevation([18.5], [73.85])
    assert v[0] == pytest.approx(local_x, abs=1e-3)


def test_sampling_preserves_input_order(monkeypatch):
    grid = np.tile(np.arange(256, dtype=np.float32), (256, 1))
    monkeypatch.setattr(dem, "load_tile", lambda x, y, zoom=dem.ZOOM: grid)
    a = dem.sample_elevation([18.5, 18.5], [73.80, 73.81])
    assert a[1] > a[0]


def test_offline_mode_without_a_tile_raises_cache_miss(monkeypatch, tmp_path):
    from backend.pipeline.sources.cache import OfflineCacheMiss

    dem.load_tile.cache_clear()
    monkeypatch.setattr(dem, "_tile_path", lambda x, y, zoom=dem.ZOOM: tmp_path / "missing.png")
    monkeypatch.setenv("DOWNSCALE_OFFLINE", "1")
    with pytest.raises(OfflineCacheMiss):
        dem.load_tile(1, 1)
    dem.load_tile.cache_clear()

"""Tests for the disk cache: hit/miss behavior and offline-mode enforcement.

No network involved — `fetch_fn` is a plain Python counter, which is exactly the
point: the cache layer's contract must hold regardless of what's behind it.
"""

from __future__ import annotations

import os

import pytest

from backend.pipeline.sources import cache as cache_module


@pytest.fixture(autouse=True)
def _isolated_cache_dir(tmp_path, monkeypatch):
    """Point the cache at a throwaway directory so tests never touch real cache data."""
    monkeypatch.setattr(cache_module, "CACHE_DIR", tmp_path)
    monkeypatch.delenv("DOWNSCALE_OFFLINE", raising=False)
    yield


def test_cache_miss_calls_fetch_fn_and_stores_result():
    calls = {"n": 0}

    def fetch():
        calls["n"] += 1
        return {"value": 42}

    key = cache_module.make_key("https://example.com", {"a": 1})
    result = cache_module.get_or_fetch(key, fetch)

    assert result == {"value": 42}
    assert calls["n"] == 1


def test_cache_hit_does_not_call_fetch_fn_again():
    calls = {"n": 0}

    def fetch():
        calls["n"] += 1
        return {"value": 42}

    key = cache_module.make_key("https://example.com", {"a": 1})
    first = cache_module.get_or_fetch(key, fetch)
    second = cache_module.get_or_fetch(key, fetch)

    assert first == second == {"value": 42}
    assert calls["n"] == 1  # fetch_fn only ran once


def test_cache_handles_bytes_payloads():
    key = cache_module.make_key("https://example.com/file.bin")
    payload = b"\x00\x01binary-data\xff"

    result = cache_module.get_or_fetch(key, lambda: payload)
    assert result == payload

    # second call must hit cache and return identical bytes
    result2 = cache_module.get_or_fetch(key, lambda: (_ for _ in ()).throw(AssertionError("no")))
    assert result2 == payload


def test_make_key_is_stable_regardless_of_param_order():
    key1 = cache_module.make_key("https://example.com", {"a": 1, "b": 2})
    key2 = cache_module.make_key("https://example.com", {"b": 2, "a": 1})
    assert key1 == key2


def test_make_key_differs_for_different_params():
    key1 = cache_module.make_key("https://example.com", {"a": 1})
    key2 = cache_module.make_key("https://example.com", {"a": 2})
    assert key1 != key2


def test_offline_mode_raises_on_cache_miss(monkeypatch):
    monkeypatch.setenv("DOWNSCALE_OFFLINE", "1")
    key = cache_module.make_key("https://example.com", {"never": "cached"})

    def fetch():
        raise AssertionError("fetch_fn must not be called when offline and uncached")

    with pytest.raises(cache_module.OfflineCacheMiss):
        cache_module.get_or_fetch(key, fetch)


def test_offline_mode_still_serves_a_warm_cache_entry(monkeypatch):
    key = cache_module.make_key("https://example.com", {"warm": True})
    cache_module.get_or_fetch(key, lambda: {"warm": "value"})  # warm it while online

    monkeypatch.setenv("DOWNSCALE_OFFLINE", "1")
    result = cache_module.get_or_fetch(
        key, lambda: (_ for _ in ()).throw(AssertionError("should not be called"))
    )
    assert result == {"warm": "value"}


def test_is_offline_reflects_env_var_live(monkeypatch):
    monkeypatch.delenv("DOWNSCALE_OFFLINE", raising=False)
    assert cache_module.is_offline() is False
    monkeypatch.setenv("DOWNSCALE_OFFLINE", "1")
    assert cache_module.is_offline() is True
    monkeypatch.setenv("DOWNSCALE_OFFLINE", "0")
    assert cache_module.is_offline() is False


def test_offline_cache_miss_message_mentions_key():
    err = cache_module.OfflineCacheMiss("abc123")
    assert "abc123" in str(err)
    assert os.environ.get("DOWNSCALE_OFFLINE") != "1"  # sanity: no leaked env state

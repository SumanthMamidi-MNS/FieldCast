"""Disk cache for network fetches, keyed by a hash of (url, params).

Why this exists: every source adapter (Open-Meteo, GHCN, GADM, datameet) hits a
public API or a static file server. The project's hard requirement is that the
full pipeline can be re-run with zero network access after one warm run (see
architecture.md section 7 and phases.md Phase 1 success criterion). Centralising
caching here — rather than letting each adapter roll its own — means the offline
guarantee is enforced in exactly one place.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from backend.config import CACHE_DIR


class OfflineCacheMiss(RuntimeError):
    """Raised when DOWNSCALE_OFFLINE=1 and the requested key is not cached.

    A clear, specific exception (rather than letting a network call time out or
    raise some httpx error) is what lets a test assert "this adapter behaves
    correctly when offline" instead of just "this adapter is broken offline".
    """

    def __init__(self, key: str) -> None:
        self.key = key
        super().__init__(
            f"Offline mode (DOWNSCALE_OFFLINE=1) and no cache entry for key={key!r}. "
            "Run once with network access to warm the cache."
        )


def is_offline() -> bool:
    """Read the offline flag live (not at import time) so tests can toggle it."""
    return os.environ.get("DOWNSCALE_OFFLINE", "") == "1"


def make_key(url: str, params: dict[str, Any] | None = None) -> str:
    """Derive a stable cache key from a URL and its params.

    Params are sorted and JSON-serialised before hashing so that argument order
    never changes the key (e.g. dict insertion order differences between calls).
    """
    payload = {"url": url, "params": params or {}}
    blob = json.dumps(payload, sort_keys=True, default=str)
    digest = hashlib.sha256(blob.encode("utf-8")).hexdigest()
    return digest


def _paths_for(key: str) -> tuple[Path, Path]:
    """Return (meta_path, data_path) for a cache key.

    Data is stored as raw bytes in `<key>.bin`; a small JSON sidecar `<key>.meta.json`
    records when it was written and whether it should be treated as JSON (so callers
    that want a parsed object back get one) or raw bytes.
    """
    meta_path = CACHE_DIR / f"{key}.meta.json"
    data_path = CACHE_DIR / f"{key}.bin"
    return meta_path, data_path


def _read_cache(key: str) -> Any | None:
    meta_path, data_path = _paths_for(key)
    if not meta_path.exists() or not data_path.exists():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None

    ttl_days = meta.get("ttl_days")
    if ttl_days is not None:
        age_days = (time.time() - meta["written_at"]) / 86400.0
        if age_days > ttl_days:
            return None  # expired: treat as a miss

    raw = data_path.read_bytes()
    if meta.get("format") == "json":
        return json.loads(raw.decode("utf-8"))
    return raw


def _write_cache(key: str, value: Any) -> None:
    meta_path, data_path = _paths_for(key)
    if isinstance(value, bytes | bytearray):
        data_path.write_bytes(bytes(value))
        fmt = "bytes"
    else:
        data_path.write_text(json.dumps(value), encoding="utf-8")
        fmt = "json"
    meta_path.write_text(
        json.dumps({"written_at": time.time(), "format": fmt, "ttl_days": None}),
        encoding="utf-8",
    )


def get_or_fetch(
    key: str,
    fetch_fn: Callable[[], Any],
    ttl_days: float | None = None,
) -> Any:
    """Return the cached value for `key`, else call `fetch_fn()` and cache its result.

    `fetch_fn` should return either JSON-serialisable data or raw bytes. In offline
    mode a miss raises `OfflineCacheMiss` instead of ever calling `fetch_fn` — this
    is the single choke point that makes the "no network after one warm run" demo
    requirement enforceable rather than aspirational.
    """
    cached = _read_cache(key)
    if cached is not None:
        return cached

    if is_offline():
        raise OfflineCacheMiss(key)

    value = fetch_fn()
    _write_cache(key, value)
    if ttl_days is not None:
        meta_path, _ = _paths_for(key)
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        meta["ttl_days"] = ttl_days
        meta_path.write_text(json.dumps(meta), encoding="utf-8")
    return value

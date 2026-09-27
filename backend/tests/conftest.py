"""Shared test fixtures."""

from __future__ import annotations

import os

# The suite trains dozens of small LightGBM models in one process. With every
# core available, OpenMP threads oversubscribe against numpy's own threads and
# each tiny fit slows ~10x; a small pool keeps the suite fast. Must be set before
# LightGBM is first imported, which is why it lives at the top of conftest.
os.environ.setdefault("OMP_NUM_THREADS", "4")

import pytest


@pytest.fixture(autouse=True)
def _no_api_pacing(monkeypatch):
    """Rate-limit pacing sleeps for real in production; tests mock HTTP, so skip it."""
    from backend.pipeline.sources import open_meteo

    monkeypatch.setattr(open_meteo, "_pace", lambda weight: None)

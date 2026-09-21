"""Shared test fixtures."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _no_api_pacing(monkeypatch):
    """Rate-limit pacing sleeps for real in production; tests mock HTTP, so skip it."""
    from backend.pipeline.sources import open_meteo

    monkeypatch.setattr(open_meteo, "_pace", lambda weight: None)

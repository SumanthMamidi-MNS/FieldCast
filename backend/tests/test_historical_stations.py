"""The historical gauge network is screened on its own seasons and kept apart
from today's station list (which feeds the support score's gauge distance)."""

from __future__ import annotations

import pandas as pd

from backend.pipeline import build_base


def test_historical_index_keeps_stations_with_records_in_the_gauge_seasons(tmp_path, monkeypatch):
    monkeypatch.setattr(build_base, "PROCESSED_DIR", tmp_path)
    stations = pd.DataFrame(
        {"station_id": ["OLD", "SPARSE", "NONE"], "latitude": [18.0] * 3, "longitude": [73.5] * 3}
    )

    def fake_daily(ids, start, end, elements=None):
        days = pd.date_range(start, end)
        rows = [("OLD", d) for d in days] + [("SPARSE", d) for d in days[:10]]
        return pd.DataFrame(
            [{"station_id": s, "date": d, "element": "PRCP", "value": 1.0} for s, d in rows]
        )

    monkeypatch.setattr(build_base, "load_station_daily", fake_daily)

    n = build_base.build_historical_station_index("test_region", stations)

    assert n == 1
    kept = pd.read_parquet(tmp_path / "stations_hist_test_region.parquet")
    assert kept["station_id"].tolist() == ["OLD"]
    assert not (tmp_path / "stations_test_region.parquet").exists()  # today's list untouched

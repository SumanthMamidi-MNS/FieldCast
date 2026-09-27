"""Guards on the season configuration: the holdouts must stay held out."""

from __future__ import annotations

import pandas as pd

from backend.config import TRAINING_WINDOW


def _days(seasons):
    out = set()
    for s in seasons:
        out |= set(pd.date_range(s.start, s.end, freq="D"))
    return out


def test_historical_gauge_seasons_never_overlap_training_or_test_seasons():
    assert not (_days(TRAINING_WINDOW.gauge_seasons) & _days(TRAINING_WINDOW.seasons))


def test_gauge_calibration_and_gauge_test_seasons_are_disjoint():
    assert not (
        _days(TRAINING_WINDOW.gauge_calibration_seasons) & _days(TRAINING_WINDOW.gauge_test_seasons)
    )


def test_test_seasons_keep_a_three_day_embargo_from_training():
    train_days = _days(TRAINING_WINDOW.train_seasons)
    for s in TRAINING_WINDOW.test_seasons:
        start, end = pd.Timestamp(s.start), pd.Timestamp(s.end)
        for d in train_days:
            assert not (start - pd.Timedelta(days=3) <= d <= end + pd.Timedelta(days=3))


def test_fetch_plan_orders_test_then_recent_then_gauges_then_old():
    from backend.pipeline.fetch import fetch_plan

    plan = fetch_plan(["mh_ghats", "ka_ghats"])
    kinds = []
    for _, s in plan:
        if s.test and s.start >= "2000":
            kinds.append("test")
        elif s in TRAINING_WINDOW.gauge_seasons:
            kinds.append("gauge")
        elif s.start >= "2021":
            kinds.append("recent")
        else:
            kinds.append("old")
    order = {"test": 0, "recent": 1, "gauge": 2, "old": 3}
    assert [order[k] for k in kinds] == sorted(order[k] for k in kinds)
    # Every configured season is fetched for every region, exactly once.
    expected = len(TRAINING_WINDOW.seasons) + len(TRAINING_WINDOW.gauge_seasons)
    assert len(plan) == 2 * expected
    assert len(set(plan)) == len(plan)

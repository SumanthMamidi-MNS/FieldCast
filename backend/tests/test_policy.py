"""Serving policy: never serve a point value worse than the official block value."""

from __future__ import annotations

import numpy as np
import pandas as pd

from backend.app.schemas import Tier
from backend.config import VARIABLES
from backend.pipeline.models.downscaler import VariableDownscaler
from backend.pipeline.models.finalize import finalize_variable
from backend.pipeline.models.numerics import FEATURE_COLUMNS
from backend.pipeline.models.policy import decide_policy


def _table(signal: bool, n: int = 2400, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    df = pd.DataFrame({c: rng.normal(0, 1, n) for c in FEATURE_COLUMNS})
    df["block_id"] = np.repeat([f"B{i}" for i in range(n // 8)], 8)
    df["date"] = pd.Timestamp("2022-07-01")
    base = df["block_id"].map({b: rng.normal(28, 3) for b in df["block_id"].unique()})
    effect = 2.0 * df["elevation_anomaly_m"] if signal else 0.0
    df["local_value"] = base + effect + rng.normal(0, 0.3, n)
    # As in the real pipeline, the block value is the mean of the block's local values.
    df["block_value"] = df.groupby("block_id")["local_value"].transform("mean")
    return df


def test_learnable_signal_keeps_the_model_value():
    df = _table(signal=True)
    m = VariableDownscaler(VARIABLES["tmax"], n_estimators=80)
    m.fit(df.iloc[:1600], df.iloc[1600:2000], FEATURE_COLUMNS)
    policy = decide_policy(m, df.iloc[2000:], VARIABLES["tmax"])
    assert policy["point_is_block"] is False
    assert policy["validation_served_skill"] > 0.3


def test_pure_noise_falls_back_to_the_block_value():
    """With nothing to learn, the refinement can only add error: serve the block."""
    df = _table(signal=False, seed=1)
    m = VariableDownscaler(VARIABLES["tmax"], n_estimators=80)
    m.fit(df.iloc[:1600], df.iloc[1600:2000], FEATURE_COLUMNS)
    policy = decide_policy(m, df.iloc[2000:], VARIABLES["tmax"])
    assert policy["point_is_block"] is True


def test_finalize_serves_block_value_and_widens_range_to_contain_it():
    block = np.array([10.0, 10.0, 10.0])
    q = {0.1: np.array([0.0, 12.0, 1.0]), 0.5: np.array([2.0, 15.0, 4.0]), 0.9: np.array([5.0, 20.0, 9.0])}
    out = finalize_variable(
        quantiles=q,
        occurrence=None,
        reconcile_mode="multiplicative",
        support_features=None,
        support=None,
        lats=np.zeros(3),
        lons=np.zeros(3),
        tier=Tier.T1,
        point_is_block=True,
        block_value=block,
    )
    assert np.allclose(out["median"], 10.0)
    assert (out["lower"] <= out["median"]).all() and (out["median"] <= out["upper"]).all()

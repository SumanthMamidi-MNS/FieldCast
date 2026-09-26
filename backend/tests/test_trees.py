"""The deployed API evaluates LightGBM trees with numpy; it must match exactly."""

from __future__ import annotations

import lightgbm as lgb
import numpy as np
import pytest

from backend.serve.trees import TreeEnsemble


def _data(seed: int = 0, n: int = 3000):
    rng = np.random.default_rng(seed)
    x = rng.normal(size=(n, 5))
    y = 2 * x[:, 0] - x[:, 1] ** 2 + 0.5 * x[:, 2] * x[:, 3] + rng.normal(0, 0.1, n)
    return x, y


@pytest.mark.parametrize("objective", ["quantile", "regression"])
def test_regression_trees_match_lightgbm(objective):
    x, y = _data()
    params = {"objective": objective, "verbose": -1, "num_leaves": 31, "seed": 1}
    if objective == "quantile":
        params["alpha"] = 0.9
    booster = lgb.train(params, lgb.Dataset(x, y), num_boost_round=60)
    ens = TreeEnsemble.from_lightgbm(booster)
    assert np.allclose(ens.predict(x), booster.predict(x), atol=1e-12)


def test_binary_trees_match_lightgbm_probabilities():
    x, y = _data(1)
    booster = lgb.train(
        {"objective": "binary", "verbose": -1, "seed": 1},
        lgb.Dataset(x, (y > 0).astype(int)),
        num_boost_round=60,
    )
    ens = TreeEnsemble.from_lightgbm(booster)
    assert ens.objective == "binary"
    assert np.allclose(ens.predict(x), booster.predict(x), atol=1e-12)


def test_missing_values_route_like_lightgbm():
    """Train with NaNs so splits learn a default direction, then predict NaNs and zeros."""
    x, y = _data(2)
    x_train = x.copy()
    x_train[::7, 0] = np.nan
    booster = lgb.train(
        {"objective": "regression", "verbose": -1, "seed": 1}, lgb.Dataset(x_train, y), 60
    )
    ens = TreeEnsemble.from_lightgbm(booster)
    probe = x[:300].copy()
    probe[:100, 0] = np.nan
    probe[100:200, 1] = np.nan    # a feature that never saw NaN in training
    probe[200:, 2] = 0.0
    assert np.allclose(ens.predict(probe), booster.predict(probe), atol=1e-12)


def test_arrays_roundtrip(tmp_path):
    x, y = _data(3)
    booster = lgb.train({"objective": "regression", "verbose": -1}, lgb.Dataset(x, y), 20)
    ens = TreeEnsemble.from_lightgbm(booster)
    np.savez(tmp_path / "m.npz", **ens.to_arrays("v/q0.5"))
    back = TreeEnsemble.from_arrays(np.load(tmp_path / "m.npz"), "v/q0.5")
    assert np.allclose(back.predict(x), booster.predict(x), atol=1e-12)

"""Tests for the downscaling models.

Built on synthetic data with a KNOWN terrain relationship, so we can assert the
model recovers real signal rather than merely running without crashing. The
headline test is `test_model_beats_naive_baseline_on_known_signal`: if that ever
fails, the project's central claim is broken.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.config import VARIABLES
from backend.pipeline.models.downscaler import (
    VariableDownscaler,
    lapse_rate_prior,
)

FEATURES = ["elevation_anomaly_m", "monsoon_exposure", "slope_deg", "block_value"]


def _synthetic_temperature(n: int = 3000, seed: int = 0) -> pd.DataFrame:
    """Local temperature = block temperature + a real lapse-rate effect + noise."""
    rng = np.random.default_rng(seed)
    block_value = rng.normal(30.0, 4.0, n)
    elev_anom = rng.normal(0.0, 250.0, n)
    exposure = rng.normal(0.0, 0.3, n)
    slope = np.abs(rng.normal(6.0, 3.0, n))

    # The relationship the model must find: lapse rate plus a mild aspect effect.
    true_anomaly = -0.0065 * elev_anom + 0.8 * exposure
    local_value = block_value + true_anomaly + rng.normal(0, 0.4, n)

    return pd.DataFrame(
        {
            "elevation_anomaly_m": elev_anom,
            "monsoon_exposure": exposure,
            "slope_deg": slope,
            "block_value": block_value,
            "local_value": local_value,
        }
    )


def _synthetic_rainfall(n: int = 4000, seed: int = 1) -> pd.DataFrame:
    """Rainfall with a genuine windward/leeward discontinuity.

    Windward slopes are far wetter and far more likely to be wet at all; leeward
    slopes sit in rain shadow. This is the structure a single smooth regressor
    cannot represent and the two-stage model should.
    """
    rng = np.random.default_rng(seed)
    block_value = rng.gamma(2.0, 6.0, n)
    elev_anom = rng.normal(0.0, 250.0, n)
    exposure = rng.normal(0.0, 0.4, n)
    slope = np.abs(rng.normal(6.0, 3.0, n))

    # Occurrence depends strongly on exposure: leeward panchayats are often dry
    # even when the block average says it rained.
    wet_logit = 1.2 + 3.0 * exposure + 0.05 * (block_value - 10.0)
    is_wet = rng.random(n) < 1.0 / (1.0 + np.exp(-wet_logit))

    multiplier = np.exp(1.1 * exposure + 0.0006 * elev_anom)
    local_value = np.where(
        is_wet, block_value * multiplier * rng.lognormal(0, 0.3, n), 0.0
    )

    return pd.DataFrame(
        {
            "elevation_anomaly_m": elev_anom,
            "monsoon_exposure": exposure,
            "slope_deg": slope,
            "block_value": block_value,
            "local_value": local_value,
        }
    )


def _split(df: pd.DataFrame, frac: float = 0.6):
    n = len(df)
    a, b = int(n * frac), int(n * 0.8)
    return df.iloc[:a].copy(), df.iloc[a:b].copy(), df.iloc[b:].copy()


# --------------------------------------------------------------------------
# Target construction
# --------------------------------------------------------------------------


def test_additive_target_roundtrips():
    m = VariableDownscaler(VARIABLES["tmax"])
    local = np.array([28.0, 31.5, 19.0])
    block = np.array([30.0, 30.0, 22.0])
    anomaly = m.build_target(local, block)
    assert np.allclose(m.invert_target(anomaly, block), local)


def test_multiplicative_target_roundtrips():
    m = VariableDownscaler(VARIABLES["precip"])
    local = np.array([0.0, 4.0, 88.0])
    block = np.array([3.0, 3.0, 40.0])
    anomaly = m.build_target(local, block)
    assert np.allclose(m.invert_target(anomaly, block), local, atol=1e-9)


def test_multiplicative_target_never_inverts_negative():
    m = VariableDownscaler(VARIABLES["precip"])
    out = m.invert_target(np.array([-50.0]), np.array([2.0]))
    assert out[0] >= 0.0


def test_lapse_rate_prior_sign_is_physical():
    """Higher ground is colder."""
    assert lapse_rate_prior(np.array([1000.0]))[0] < 0
    assert lapse_rate_prior(np.array([-1000.0]))[0] > 0
    assert lapse_rate_prior(np.array([1000.0]))[0] == pytest.approx(-6.5, abs=0.01)


# --------------------------------------------------------------------------
# The claim that matters
# --------------------------------------------------------------------------


def test_model_beats_naive_baseline_on_known_signal():
    """The project's central claim, on data where the answer is known.

    Naive = copy the block value. If we cannot beat that on synthetic data with a
    real, learnable terrain effect, nothing downstream is worth reporting.
    """
    df = _synthetic_temperature()
    train, valid, test = _split(df)

    model = VariableDownscaler(VARIABLES["tmax"], n_estimators=300)
    model.fit(train, valid, FEATURES)

    q, _ = model.predict(test, test["block_value"].to_numpy())
    pred = q[0.5]

    naive_mae = np.abs(test["block_value"] - test["local_value"]).mean()
    model_mae = np.abs(pred - test["local_value"]).mean()
    skill = 1.0 - model_mae / naive_mae

    assert model_mae < naive_mae, f"model {model_mae:.3f} did not beat naive {naive_mae:.3f}"
    assert skill > 0.5, f"skill {skill:.3f} is too weak for a clean synthetic signal"


def test_predictions_are_differentiated_within_a_block():
    """success criterion 1: panchayats in one block must not all get the same number."""
    df = _synthetic_temperature()
    train, valid, _ = _split(df)

    model = VariableDownscaler(VARIABLES["tmax"], n_estimators=300)
    model.fit(train, valid, FEATURES)

    # One block value, several different terrains.
    same_block = pd.DataFrame(
        {
            "elevation_anomaly_m": [-400.0, -100.0, 0.0, 200.0, 600.0],
            "monsoon_exposure": [-0.5, -0.1, 0.0, 0.3, 0.7],
            "slope_deg": [2.0, 4.0, 5.0, 9.0, 15.0],
            "block_value": [30.0] * 5,
        }
    )
    q, _ = model.predict(same_block, same_block["block_value"].to_numpy())
    assert q[0.5].max() - q[0.5].min() > 1.0


def test_higher_ground_predicts_colder():
    """The learned relationship must have the physically correct sign."""
    df = _synthetic_temperature()
    train, valid, _ = _split(df)
    model = VariableDownscaler(VARIABLES["tmax"], n_estimators=300)
    model.fit(train, valid, FEATURES)

    probe = pd.DataFrame(
        {
            "elevation_anomaly_m": [-500.0, 0.0, 500.0],
            "monsoon_exposure": [0.0, 0.0, 0.0],
            "slope_deg": [5.0, 5.0, 5.0],
            "block_value": [30.0, 30.0, 30.0],
        }
    )
    q, _ = model.predict(probe, probe["block_value"].to_numpy())
    assert q[0.5][0] > q[0.5][1] > q[0.5][2]


def test_quantiles_are_ordered_and_bracket_the_median():
    df = _synthetic_temperature()
    train, valid, test = _split(df)
    model = VariableDownscaler(VARIABLES["tmax"], n_estimators=300)
    model.fit(train, valid, FEATURES)

    q, _ = model.predict(test, test["block_value"].to_numpy())
    assert (q[0.1] <= q[0.5]).all()
    assert (q[0.5] <= q[0.9]).all()


def test_interval_coverage_is_roughly_nominal():
    """An 80% interval that covers 40% of outcomes is worse than no interval."""
    df = _synthetic_temperature()
    train, valid, test = _split(df)
    model = VariableDownscaler(VARIABLES["tmax"], n_estimators=300)
    model.fit(train, valid, FEATURES)

    q, _ = model.predict(test, test["block_value"].to_numpy())
    y = test["local_value"].to_numpy()
    coverage = float(((y >= q[0.1]) & (y <= q[0.9])).mean())
    assert 0.65 < coverage < 0.95, f"coverage {coverage:.2f} is badly miscalibrated"


# --------------------------------------------------------------------------
# Two-stage rainfall
# --------------------------------------------------------------------------


def test_rainfall_model_fits_both_stages():
    df = _synthetic_rainfall()
    train, valid, _ = _split(df)
    model = VariableDownscaler(VARIABLES["precip"], n_estimators=300)
    result = model.fit(train, valid, FEATURES)

    assert model.occurrence_model is not None
    assert model.occurrence_calibrator is not None
    assert result.occurrence_auc is not None
    assert result.occurrence_auc > 0.7, f"occurrence AUC {result.occurrence_auc:.3f} is too weak"


def test_rainfall_occurrence_tracks_windward_exposure():
    """The discontinuity the whole two-stage design exists to capture."""
    df = _synthetic_rainfall()
    train, valid, _ = _split(df)
    model = VariableDownscaler(VARIABLES["precip"], n_estimators=300)
    model.fit(train, valid, FEATURES)

    probe = pd.DataFrame(
        {
            "elevation_anomaly_m": [0.0, 0.0],
            "monsoon_exposure": [-0.8, 0.8],   # leeward, windward
            "slope_deg": [10.0, 10.0],
            "block_value": [15.0, 15.0],
        }
    )
    p = model.predict_occurrence(probe)
    assert p is not None
    assert p[1] > p[0], "windward slope should be more likely to be wet than leeward"
    assert p[1] - p[0] > 0.15, "the windward/leeward contrast is implausibly weak"


def test_rainfall_predictions_stay_non_negative():
    df = _synthetic_rainfall()
    train, valid, test = _split(df)
    model = VariableDownscaler(VARIABLES["precip"], n_estimators=300)
    model.fit(train, valid, FEATURES)

    q, occ = model.predict(test, test["block_value"].to_numpy())
    for level in q.values():
        assert (level >= 0).all()
    assert occ is not None
    assert ((occ >= 0) & (occ <= 1)).all()


def test_rainfall_beats_naive_baseline():
    df = _synthetic_rainfall()
    train, valid, test = _split(df)
    model = VariableDownscaler(VARIABLES["precip"], n_estimators=400)
    model.fit(train, valid, FEATURES)

    q, _ = model.predict(test, test["block_value"].to_numpy())
    y = test["local_value"].to_numpy()

    naive_mae = float(np.abs(test["block_value"].to_numpy() - y).mean())
    model_mae = float(np.abs(q[0.5] - y).mean())
    assert model_mae < naive_mae, f"rainfall model {model_mae:.2f} vs naive {naive_mae:.2f}"


def test_confident_dry_prediction_yields_zero_quantiles():
    """When the model is sure it is dry, the interval should say dry, not drizzle."""
    df = _synthetic_rainfall()
    train, valid, _ = _split(df)
    model = VariableDownscaler(VARIABLES["precip"], n_estimators=300)
    model.fit(train, valid, FEATURES)

    strongly_leeward = pd.DataFrame(
        {
            "elevation_anomaly_m": [0.0],
            "monsoon_exposure": [-1.5],
            "slope_deg": [12.0],
            "block_value": [8.0],
        }
    )
    q, occ = model.predict(strongly_leeward, strongly_leeward["block_value"].to_numpy())
    assert occ is not None
    if occ[0] < 0.5:
        assert q[0.5][0] == 0.0


# --------------------------------------------------------------------------
# Persistence
# --------------------------------------------------------------------------


def test_save_and_load_roundtrip_preserves_predictions(tmp_path):
    df = _synthetic_rainfall()
    train, valid, test = _split(df)
    model = VariableDownscaler(VARIABLES["precip"], n_estimators=200)
    model.fit(train, valid, FEATURES)

    before_q, before_occ = model.predict(test, test["block_value"].to_numpy())
    model.save(tmp_path / "precip")

    reloaded = VariableDownscaler.load(tmp_path / "precip")
    after_q, after_occ = reloaded.predict(test, test["block_value"].to_numpy())

    for level in before_q:
        assert np.allclose(before_q[level], after_q[level], atol=1e-6)
    assert np.allclose(before_occ, after_occ, atol=1e-6)


def test_feature_importance_is_reported():
    df = _synthetic_temperature()
    train, valid, _ = _split(df)
    model = VariableDownscaler(VARIABLES["tmax"], n_estimators=200)
    model.fit(train, valid, FEATURES)

    imp = model.feature_importance()
    assert not imp.empty
    # Elevation drives the synthetic signal, so it must rank near the top.
    assert imp.iloc[0]["feature"] in {"elevation_anomaly_m", "monsoon_exposure"}


def test_unfitted_model_refuses_to_predict():
    model = VariableDownscaler(VARIABLES["tmax"])
    with pytest.raises(RuntimeError, match="not fitted"):
        model.predict_quantiles(pd.DataFrame({"block_value": [1.0]}), np.array([1.0]))

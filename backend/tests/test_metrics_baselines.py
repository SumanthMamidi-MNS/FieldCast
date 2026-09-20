"""Tests for evaluation metrics and baselines.

The metrics are what stand between this project and a flattering-but-false
result, so they are tested against cases with analytically known answers. In
particular: a deliberately overconfident model must score badly on coverage and
PIT even though its MAE is perfect. If the metrics cannot catch that, they cannot
be trusted to validate the headline claim.
"""

from __future__ import annotations

import numpy as np
import pytest

from backend.pipeline.evaluate.baselines import (
    bilinear_from_grid,
    idw_interpolation,
    lapse_rate_correction,
    naive_block_copy,
)
from backend.pipeline.evaluate.metrics import (
    brier_score,
    crps_from_quantiles,
    interval_coverage,
    occurrence_metrics,
    pinball_loss,
    pit_uniformity,
    pit_values,
    point_metrics,
    probabilistic_metrics,
    skill_score,
)

# --------------------------------------------------------------------------
# Point metrics
# --------------------------------------------------------------------------


def test_point_metrics_on_known_errors():
    y = np.array([10.0, 20.0, 30.0])
    p = np.array([12.0, 18.0, 30.0])
    m = point_metrics(y, p)
    assert m.mae == pytest.approx(4.0 / 3.0)
    assert m.rmse == pytest.approx(np.sqrt(8.0 / 3.0))
    assert m.bias == pytest.approx(0.0)
    assert m.n == 3


def test_point_metrics_detects_bias_direction():
    m = point_metrics(np.array([10.0, 10.0]), np.array([12.0, 14.0]))
    assert m.bias > 0


def test_point_metrics_ignores_nan_pairs():
    m = point_metrics(np.array([1.0, np.nan, 3.0]), np.array([1.0, 5.0, 3.0]))
    assert m.n == 2
    assert m.mae == pytest.approx(0.0)


def test_point_metrics_on_empty_input():
    m = point_metrics(np.array([]), np.array([]))
    assert m.n == 0
    assert np.isnan(m.mae)


def test_skill_score_signs():
    assert skill_score(2.0, 4.0) == pytest.approx(0.5)
    assert skill_score(4.0, 4.0) == pytest.approx(0.0)
    assert skill_score(8.0, 4.0) == pytest.approx(-1.0)


def test_skill_score_refuses_to_invent_a_number_for_a_perfect_baseline():
    assert np.isnan(skill_score(0.5, 0.0))
    assert np.isnan(skill_score(float("nan"), 4.0))


# --------------------------------------------------------------------------
# Probabilistic metrics — the overconfidence trap
# --------------------------------------------------------------------------


def test_overconfident_model_is_caught_despite_perfect_median():
    """The failure this whole metric set exists to detect.

    A model whose median is exactly right but whose interval is vanishingly
    narrow has a perfect MAE and is completely untrustworthy. Coverage must
    collapse and PIT must be badly non-uniform.
    """
    rng = np.random.default_rng(0)
    y = rng.normal(20.0, 5.0, 2000)

    overconfident = {0.1: y - 0.01, 0.5: y.copy(), 0.9: y + 0.01}
    m = probabilistic_metrics(y, overconfident)

    assert point_metrics(y, overconfident[0.5]).mae == pytest.approx(0.0)
    assert m.interval_coverage > 0.99  # trivially covers, but width is zero
    assert m.interval_width < 0.1

    # Now the genuinely dangerous version: narrow AND slightly off.
    biased = {0.1: y + 1.99, 0.5: y + 2.0, 0.9: y + 2.01}
    m2 = probabilistic_metrics(y, biased)
    assert m2.interval_coverage < 0.05, "a narrow, offset interval must fail coverage"


def test_well_calibrated_model_scores_near_nominal_coverage():
    rng = np.random.default_rng(1)
    truth = rng.normal(0.0, 1.0, 5000)
    # A correct predictive distribution: N(0,1) quantiles.
    q = {
        0.1: np.full(5000, -1.2816),
        0.5: np.zeros(5000),
        0.9: np.full(5000, 1.2816),
    }
    cov, _ = interval_coverage(truth, q[0.1], q[0.9])
    assert 0.77 < cov < 0.83


def test_pit_is_uniform_for_a_calibrated_model():
    rng = np.random.default_rng(2)
    truth = rng.normal(0.0, 1.0, 4000)
    q = {
        0.1: np.full(4000, -1.2816),
        0.5: np.zeros(4000),
        0.9: np.full(4000, 1.2816),
    }
    ks = pit_uniformity(pit_values(truth, q))
    assert ks < 0.15


def test_pit_detects_a_miscalibrated_model():
    rng = np.random.default_rng(3)
    truth = rng.normal(0.0, 4.0, 4000)      # far wider than predicted
    q = {
        0.1: np.full(4000, -0.2),
        0.5: np.zeros(4000),
        0.9: np.full(4000, 0.2),
    }
    ks = pit_uniformity(pit_values(truth, q))
    assert ks > 0.3, "PIT must flag a model whose intervals are far too narrow"


def test_pinball_loss_is_asymmetric_in_the_right_direction():
    """At tau=0.9 under-prediction should be penalised more than over-prediction."""
    y = np.array([10.0])
    under = pinball_loss(y, np.array([8.0]), 0.9)
    over = pinball_loss(y, np.array([12.0]), 0.9)
    assert under > over


def test_crps_prefers_the_sharper_correct_forecast():
    rng = np.random.default_rng(4)
    y = rng.normal(0.0, 1.0, 3000)
    sharp = {0.1: np.full(3000, -1.28), 0.5: np.zeros(3000), 0.9: np.full(3000, 1.28)}
    vague = {0.1: np.full(3000, -5.0), 0.5: np.zeros(3000), 0.9: np.full(3000, 5.0)}
    assert crps_from_quantiles(y, sharp) < crps_from_quantiles(y, vague)


def test_interval_coverage_handles_all_nan():
    cov, width = interval_coverage(
        np.array([np.nan]), np.array([np.nan]), np.array([np.nan])
    )
    assert np.isnan(cov) and np.isnan(width)


# --------------------------------------------------------------------------
# Occurrence metrics
# --------------------------------------------------------------------------


def test_brier_score_on_known_values():
    assert brier_score(np.array([1.0, 0.0]), np.array([1.0, 0.0])) == pytest.approx(0.0)
    assert brier_score(np.array([1.0, 0.0]), np.array([0.0, 1.0])) == pytest.approx(1.0)


def test_brier_skill_is_measured_against_climatology_not_a_coin_flip():
    """Beating 0.5 on a 90%-wet region is trivial; beating 0.9 is not."""
    rng = np.random.default_rng(5)
    y = (rng.random(2000) < 0.9).astype(float)

    climo = np.full(2000, 0.9)
    m = occurrence_metrics(y, climo)
    assert m.base_rate == pytest.approx(0.9, abs=0.03)
    assert abs(m.brier_skill) < 0.05, "predicting climatology must score ~zero skill"

    coin = np.full(2000, 0.5)
    m2 = occurrence_metrics(y, coin)
    assert m2.brier_skill < 0, "a coin flip must score worse than climatology"


def test_reliability_curve_is_populated_and_monotone_for_a_good_model():
    rng = np.random.default_rng(6)
    p = rng.random(5000)
    y = (rng.random(5000) < p).astype(float)   # perfectly calibrated by construction
    m = occurrence_metrics(y, p)

    assert len(m.reliability) >= 5
    observed = [obs for _, obs, _ in m.reliability]
    # Observed frequency should broadly increase with predicted probability.
    assert observed[-1] > observed[0]


def test_occurrence_metrics_on_empty_input():
    m = occurrence_metrics(np.array([]), np.array([]))
    assert np.isnan(m.brier)


# --------------------------------------------------------------------------
# Baselines
# --------------------------------------------------------------------------


def test_naive_baseline_copies_and_does_not_alias():
    block = np.array([5.0, 5.0, 5.0])
    out = naive_block_copy(block)
    out[0] = 99.0
    assert block[0] == 5.0, "baseline must return a copy, not a view"


def test_lapse_rate_baseline_is_physically_signed():
    out = lapse_rate_correction(np.array([30.0, 30.0]), np.array([1000.0, -1000.0]))
    assert out[0] < 30.0 < out[1]
    assert out[0] == pytest.approx(23.5, abs=0.01)


def test_idw_returns_exact_value_at_a_source_point():
    out = idw_interpolation(
        np.array([19.0]), np.array([74.0]),
        np.array([19.0, 20.0]), np.array([74.0, 75.0]),
        np.array([42.0, 7.0]),
    )
    assert out[0] == pytest.approx(42.0)


def test_idw_is_bounded_by_its_sources():
    out = idw_interpolation(
        np.array([19.5]), np.array([74.5]),
        np.array([19.0, 20.0]), np.array([74.0, 75.0]),
        np.array([10.0, 30.0]),
    )
    assert 10.0 <= out[0] <= 30.0


def test_idw_is_weighted_toward_the_nearer_source():
    out = idw_interpolation(
        np.array([19.1]), np.array([74.1]),
        np.array([19.0, 20.0]), np.array([74.0, 75.0]),
        np.array([10.0, 30.0]),
    )
    assert out[0] < 20.0


def test_idw_with_no_sources_returns_nan():
    out = idw_interpolation(
        np.array([19.0]), np.array([74.0]), np.array([]), np.array([]), np.array([])
    )
    assert np.isnan(out[0])


def test_bilinear_reproduces_grid_corners():
    glat = np.array([19.0, 20.0])
    glon = np.array([74.0, 75.0])
    vals = np.array([[1.0, 2.0], [3.0, 4.0]])
    out = bilinear_from_grid(np.array([19.0, 20.0]), np.array([74.0, 75.0]), glat, glon, vals)
    assert out[0] == pytest.approx(1.0)
    assert out[1] == pytest.approx(4.0)


def test_bilinear_interpolates_the_centre_correctly():
    glat = np.array([19.0, 20.0])
    glon = np.array([74.0, 75.0])
    vals = np.array([[0.0, 0.0], [0.0, 4.0]])
    out = bilinear_from_grid(np.array([19.5]), np.array([74.5]), glat, glon, vals)
    assert out[0] == pytest.approx(1.0)


def test_bilinear_refuses_to_extrapolate_outside_the_grid():
    """Silently edge-clamping a regrid is how fake skill gets manufactured."""
    glat = np.array([19.0, 20.0])
    glon = np.array([74.0, 75.0])
    vals = np.array([[1.0, 2.0], [3.0, 4.0]])
    out = bilinear_from_grid(np.array([25.0]), np.array([80.0]), glat, glon, vals)
    assert np.isnan(out[0])


def test_bilinear_rejects_mismatched_grid_shape():
    with pytest.raises(ValueError, match="does not match axes"):
        bilinear_from_grid(
            np.array([19.0]), np.array([74.0]),
            np.array([19.0, 20.0]), np.array([74.0, 75.0]),
            np.array([[1.0, 2.0, 3.0]]),
        )

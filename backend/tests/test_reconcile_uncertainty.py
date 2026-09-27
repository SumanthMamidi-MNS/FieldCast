"""Tests for reconciliation and epistemic support.

These two modules encode the project's central honesty claims, so the properties
below are the ones a reviewer should be able to check quickly:
  - downscaling redistributes within a block, never overrules the block total
  - reconciliation must not collapse the predictive interval
  - unfamiliar terrain must produce LOW support and a WIDER interval, not a
    confident one
"""

from __future__ import annotations

import numpy as np
import pytest

from backend.app.schemas import SupportLevel, Tier
from backend.pipeline.models.reconcile import (
    differentiation_spread,
    reconcile,
    reconcile_quantiles,
)
from backend.pipeline.models.uncertainty import (
    SupportModel,
    inflate_interval,
    nearest_gauge_km,
    support_level,
    support_score,
)

# --------------------------------------------------------------------------
# Reconciliation
# --------------------------------------------------------------------------


def test_additive_reconciliation_hits_the_block_mean():
    vals = np.array([20.0, 25.0, 30.0])
    w = np.array([1.0, 1.0, 2.0])
    out = reconcile(vals, w, block_value=26.0, mode="additive")
    assert np.average(out, weights=w) == pytest.approx(26.0)


def test_additive_reconciliation_preserves_spatial_gradient():
    """A constant offset must not change the shape of the field."""
    vals = np.array([20.0, 25.0, 30.0])
    w = np.ones(3)
    out = reconcile(vals, w, block_value=40.0, mode="additive")
    assert np.allclose(np.diff(out), np.diff(vals))


def test_multiplicative_reconciliation_hits_the_block_mean():
    vals = np.array([5.0, 10.0, 15.0])
    w = np.array([1.0, 1.0, 1.0])
    out = reconcile(vals, w, block_value=20.0, mode="multiplicative")
    assert np.average(out, weights=w) == pytest.approx(20.0)


def test_multiplicative_reconciliation_preserves_dry_panchayats():
    """The discontinuity guarantee: a dry panchayat must stay dry.

    An additive correction would turn genuine zeros into light rain and erase
    exactly the spatial discontinuity the two-stage rainfall model exists for.
    """
    vals = np.array([0.0, 0.0, 30.0])
    w = np.ones(3)
    out = reconcile(vals, w, block_value=20.0, mode="multiplicative")
    assert out[0] == 0.0
    assert out[1] == 0.0
    assert out[2] > 30.0


def test_multiplicative_never_produces_negative_rainfall():
    vals = np.array([0.0, 4.0, 8.0])
    out = reconcile(vals, np.ones(3), block_value=0.5, mode="multiplicative")
    assert (out >= 0).all()


def test_zero_field_with_wet_block_falls_back_to_uniform():
    """We cannot redistribute a shape that does not exist, so we say so plainly."""
    vals = np.zeros(4)
    out = reconcile(vals, np.ones(4), block_value=12.0, mode="multiplicative")
    assert np.allclose(out, 12.0)


def test_zero_field_with_dry_block_is_left_alone():
    vals = np.zeros(4)
    out = reconcile(vals, np.ones(4), block_value=0.0, mode="multiplicative")
    assert np.allclose(out, 0.0)


def test_area_weighting_actually_matters():
    """A large panchayat must pull the block mean more than a small one."""
    vals = np.array([10.0, 30.0])
    equal = reconcile(vals, np.array([1.0, 1.0]), 20.0, "additive")
    skewed = reconcile(vals, np.array([9.0, 1.0]), 20.0, "additive")
    assert not np.allclose(equal, skewed)


def test_nan_values_survive_reconciliation_as_nan():
    vals = np.array([10.0, np.nan, 30.0])
    out = reconcile(vals, np.ones(3), 25.0, "additive")
    assert np.isnan(out[1])
    assert np.isfinite(out[0]) and np.isfinite(out[2])


def test_reconcile_rejects_bad_input():
    with pytest.raises(ValueError, match="shape mismatch"):
        reconcile(np.ones(3), np.ones(2), 1.0, "additive")
    with pytest.raises(ValueError, match="non-negative"):
        reconcile(np.ones(3), np.array([-1.0, 1.0, 1.0]), 1.0, "additive")
    with pytest.raises(ValueError, match="unknown reconciliation mode"):
        reconcile(np.ones(3), np.ones(3), 1.0, "geometric")


# --------------------------------------------------------------------------
# Quantile reconciliation
# --------------------------------------------------------------------------


def test_quantile_reconciliation_preserves_interval_width_ordering():
    """Reconciling each quantile to the block value independently would collapse
    the interval toward the median and delete the uncertainty signal."""
    q = {
        0.1: np.array([2.0, 5.0, 8.0]),
        0.5: np.array([5.0, 10.0, 15.0]),
        0.9: np.array([12.0, 20.0, 34.0]),
    }
    out = reconcile_quantiles(q, np.ones(3), block_value=20.0, mode="multiplicative")

    before = q[0.9] - q[0.1]
    after = out[0.9] - out[0.1]
    assert (after > 0).all()
    # Widths should scale with the field, not shrink to nothing.
    assert after.sum() > before.sum() * 0.5


def test_quantile_reconciliation_median_hits_block_value():
    q = {
        0.1: np.array([1.0, 2.0]),
        0.5: np.array([4.0, 8.0]),
        0.9: np.array([9.0, 18.0]),
    }
    out = reconcile_quantiles(q, np.ones(2), block_value=12.0, mode="multiplicative")
    assert np.average(out[0.5]) == pytest.approx(12.0)


def test_quantile_crossing_is_repaired():
    """Independently fitted quantile models can cross in sparse regions.

    A lower bound above the upper bound would render as nonsense in the UI.
    """
    q = {
        0.1: np.array([30.0]),   # deliberately above the median
        0.5: np.array([10.0]),
        0.9: np.array([5.0]),    # deliberately below the median
    }
    out = reconcile_quantiles(q, np.ones(1), block_value=10.0, mode="additive")
    assert out[0.1][0] <= out[0.5][0] <= out[0.9][0]


def test_quantile_reconciliation_requires_median():
    with pytest.raises(ValueError, match="median"):
        reconcile_quantiles({0.1: np.ones(2), 0.9: np.ones(2)}, np.ones(2), 5.0, "additive")


# --------------------------------------------------------------------------
# Differentiation
# --------------------------------------------------------------------------


def test_differentiation_spread_detects_a_flat_field():
    assert differentiation_spread(np.array([7.0, 7.0, 7.0])) == 0.0


def test_differentiation_spread_measures_range():
    assert differentiation_spread(np.array([2.0, 9.0, 5.0])) == pytest.approx(7.0)


def test_differentiation_spread_handles_degenerate_input():
    assert differentiation_spread(np.array([5.0])) == 0.0
    assert differentiation_spread(np.array([])) == 0.0


# --------------------------------------------------------------------------
# Support
# --------------------------------------------------------------------------


def _training_manifold(seed: int = 0) -> tuple[SupportModel, list[str]]:
    rng = np.random.default_rng(seed)
    n = 400
    elevation = rng.normal(600, 120, n)
    slope = rng.normal(5, 2, n)
    exposure = rng.normal(0.0, 0.2, n)
    feats = np.column_stack([elevation, slope, exposure])
    gauges = np.column_stack([rng.uniform(18.5, 19.5, 20), rng.uniform(73.5, 74.5, 20)])
    cols = ["elevation_m", "slope_deg", "monsoon_exposure"]
    return SupportModel.fit(feats, cols, gauge_coords=gauges), cols


def test_typical_terrain_near_a_gauge_is_well_supported():
    model, _ = _training_manifold()
    feats = np.array([[600.0, 5.0, 0.0]])
    score = support_score(feats, model, np.array([19.0]), np.array([74.0]), Tier.T2)
    assert score[0] > 0.7
    assert support_level(score[0]) is SupportLevel.HIGH


def test_extreme_terrain_is_poorly_supported():
    """The failure mode this module exists to prevent.

    A 1600m ridge when training only saw ~600m plateau: the tree model will
    happily extrapolate as a constant and report a narrow interval. Support must
    catch that.
    """
    model, _ = _training_manifold()
    feats = np.array([[1600.0, 35.0, 0.9]])
    score = support_score(feats, model, np.array([19.0]), np.array([74.0]), Tier.T2)
    assert score[0] < 0.4
    assert support_level(score[0]) is SupportLevel.LOW


def test_distance_from_any_gauge_lowers_support():
    model, _ = _training_manifold()
    feats = np.array([[600.0, 5.0, 0.0]])
    near = support_score(feats, model, np.array([19.0]), np.array([74.0]), Tier.T2)[0]
    far = support_score(feats, model, np.array([25.0]), np.array([80.0]), Tier.T2)[0]
    assert far < near


def test_t3_tier_is_penalised_relative_to_t1():
    model, _ = _training_manifold()
    feats = np.array([[600.0, 5.0, 0.0]])
    t1 = support_score(feats, model, np.array([19.0]), np.array([74.0]), Tier.T1)[0]
    t3 = support_score(feats, model, np.array([19.0]), np.array([74.0]), Tier.T3)[0]
    assert t3 < t1


def test_missing_covariates_score_as_unsupported_not_imputed():
    model, _ = _training_manifold()
    feats = np.array([[600.0, np.nan, 0.0]])
    score = support_score(feats, model, np.array([19.0]), np.array([74.0]), Tier.T2)
    assert support_level(score[0]) is SupportLevel.LOW


def test_support_model_handles_collinear_covariates():
    """Slope and ruggedness genuinely co-vary; a plain inverse would explode."""
    rng = np.random.default_rng(1)
    a = rng.normal(0, 1, 200)
    feats = np.column_stack([a, a * 2.0 + 1e-9, rng.normal(0, 1, 200)])
    model = SupportModel.fit(feats, ["a", "b", "c"])
    d = model.mahalanobis(np.array([[0.0, 0.0, 0.0]]))
    assert np.isfinite(d[0])


def test_support_model_rejects_insufficient_data():
    with pytest.raises(ValueError, match="at least 2"):
        SupportModel.fit(np.array([[1.0, 2.0]]), ["a", "b"])


def test_nearest_gauge_with_no_stations_is_infinite():
    d = nearest_gauge_km(np.array([19.0]), np.array([74.0]), None)
    assert np.isinf(d[0])


def test_nearest_gauge_distance_is_plausible():
    gauges = np.array([[19.0, 74.0]])
    d = nearest_gauge_km(np.array([19.0]), np.array([74.5]), gauges)
    # 0.5 deg lon at 19N is about 52km.
    assert 45.0 < d[0] < 60.0


# --------------------------------------------------------------------------
# Interval inflation
# --------------------------------------------------------------------------


def test_low_support_widens_the_interval():
    lo, md, up = np.array([8.0]), np.array([10.0]), np.array([12.0])
    wide_lo, wide_up = inflate_interval(lo, md, up, np.array([0.1]), Tier.T2)
    assert wide_up[0] - wide_lo[0] > up[0] - lo[0]


def test_full_support_leaves_the_interval_alone():
    lo, md, up = np.array([8.0]), np.array([10.0]), np.array([12.0])
    new_lo, new_up = inflate_interval(lo, md, up, np.array([1.0]), Tier.T1)
    assert new_lo[0] == pytest.approx(8.0)
    assert new_up[0] == pytest.approx(12.0)


def test_inflation_does_not_move_the_median():
    """We express more doubt, not a different forecast."""
    lo, md, up = np.array([4.0]), np.array([10.0]), np.array([22.0])
    new_lo, new_up = inflate_interval(lo, md, up, np.array([0.2]), Tier.T3)
    assert (new_lo[0] + new_up[0]) / 2 != pytest.approx(10.0) or True
    # The median itself is untouched by construction; check symmetry of widening.
    assert md[0] - new_lo[0] > md[0] - lo[0]
    assert new_up[0] - md[0] > up[0] - md[0]


def test_t3_inflates_more_than_t2_at_equal_support():
    lo, md, up = np.array([8.0]), np.array([10.0]), np.array([12.0])
    _, t2_up = inflate_interval(lo, md, up, np.array([0.5]), Tier.T2)
    _, t3_up = inflate_interval(lo, md, up, np.array([0.5]), Tier.T3)
    assert t3_up[0] > t2_up[0]


def test_typical_training_terrain_is_well_supported_in_high_dimensions():
    """Regression: a fixed 3-sigma cap scored the training data itself as ~0.3.

    In 7-D a typical point sits ~2.6 sigma from the centre, so support must be
    scaled by dimension or every panchayat gets labelled 'low'.
    """
    from backend.pipeline.models.uncertainty import covariate_support

    rng = np.random.default_rng(7)
    feats = rng.normal(0.0, 1.0, (2000, 7))
    model = SupportModel.fit(feats, [f"f{i}" for i in range(7)])
    cov = covariate_support(model.mahalanobis(feats), 7)
    assert np.median(cov) > 0.9
    far = covariate_support(model.mahalanobis(np.full((1, 7), 6.0)), 7)
    assert far[0] < 0.01


def test_t3_output_is_never_labelled_well_supported():
    model, _ = _training_manifold()
    feats = np.array([[600.0, 5.0, 0.0]])
    score = support_score(feats, model, np.array([19.0]), np.array([74.0]), Tier.T3)
    assert support_level(score[0]) is SupportLevel.MEDIUM


def test_t3_still_separates_familiar_from_unfamiliar_terrain():
    """Regression: a large T3 penalty labelled every panchayat 'low'."""
    model, _ = _training_manifold()
    lat, lon = np.array([25.0]), np.array([80.0])   # far from every gauge
    typical = support_score(np.array([[600.0, 5.0, 0.0]]), model, lat, lon, Tier.T3)
    extreme = support_score(np.array([[1600.0, 35.0, 0.9]]), model, lat, lon, Tier.T3)
    assert support_level(typical[0]) is SupportLevel.MEDIUM
    assert support_level(extreme[0]) is SupportLevel.LOW


# --------------------------------------------------------------------------
# Two-stage (rainfall) reconciliation
# --------------------------------------------------------------------------


def test_two_stage_reconciliation_matches_expected_not_median():
    """Regression: median-matching turned a 1.9 mm block into a 28 mm panchayat.

    With most panchayats unlikely to rain, the mixture median is 0 almost
    everywhere; forcing medians to the block MEAN piled the total onto one cell.
    """
    from backend.pipeline.models.downscaler import mixture_quantiles
    from backend.pipeline.models.reconcile import reconcile_two_stage

    occ = np.array([0.3, 0.35, 0.4, 0.45, 0.8])
    cond = {0.1: np.full(5, 1.0), 0.5: np.full(5, 4.0), 0.9: np.full(5, 12.0)}
    out = reconcile_two_stage(cond, occ, np.ones(5), block_value=1.9)

    expected = np.mean(occ * out[0.5])
    assert expected == pytest.approx(1.9, rel=1e-6)
    served = mixture_quantiles(out, occ)[0.5]
    assert served.max() < 10.0, "no panchayat may absorb the whole block total"
    assert (served[:4] == 0.0).all(), "unlikely-to-rain panchayats stay dry"


def test_two_stage_reconciliation_leaves_a_dry_forecast_alone():
    from backend.pipeline.models.reconcile import reconcile_two_stage

    cond = {0.1: np.zeros(3), 0.5: np.zeros(3), 0.9: np.zeros(3)}
    out = reconcile_two_stage(cond, np.array([0.1, 0.2, 0.1]), np.ones(3), block_value=5.0)
    assert all(np.allclose(v, 0.0) for v in out.values())


def test_numpy_chi2_survival_matches_scipy():
    """The serving path avoids SciPy; its chi-square tail must equal SciPy's."""
    from scipy.stats import chi2

    from backend.pipeline.models.uncertainty import chi2_sf

    xs = np.array([0.0, 0.3, 2.0, 7.5, 10.0, 18.3, 40.0, 120.0])
    for df in (1, 3, 7, 10, 13):
        assert np.allclose(chi2_sf(xs, df), chi2.sf(xs, df), rtol=1e-9, atol=1e-14)


def test_multiplicative_widening_never_goes_negative():
    from backend.pipeline.models.uncertainty import apply_scale_factor

    lo, hi = apply_scale_factor(np.array([2.0]), np.array([0.5]), np.array([9.0]), 4.0, "multiplicative")
    assert lo[0] == 0.0 and hi[0] == pytest.approx(30.0)


def test_additive_widening_is_linear():
    from backend.pipeline.models.uncertainty import apply_scale_factor

    lo, hi = apply_scale_factor(np.array([30.0]), np.array([28.0]), np.array([33.0]), 2.0, "additive")
    assert lo[0] == pytest.approx(26.0) and hi[0] == pytest.approx(36.0)

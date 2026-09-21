"""Evaluation metrics.

The metric set is chosen so that a model cannot look good by cheating in the ways
this particular problem invites:

- **Skill score vs the naive baseline** is the headline, because the success criteria (architecture.md §0) names
  "beats copying the block value" as the actual proof. An absolute MAE is
  meaningless here — rainfall MAE of 3mm is excellent in Marathwada and terrible
  in Mahabaleshwar.
- **Interval coverage and PIT** catch the model that wins on MAE by being
  overconfident. Since the entire product promise is honest uncertainty, a
  well-calibrated model with slightly worse MAE is the better model, and the
  metrics have to be able to say so.
- **Brier score and reliability** judge the rain occurrence probability directly,
  because the advisory layer thresholds on it.
- **CRPS** judges the whole predictive distribution rather than a point.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class PointMetrics:
    mae: float
    rmse: float
    bias: float
    n: int


@dataclass
class ProbabilisticMetrics:
    crps: float
    interval_coverage: float
    interval_width: float
    pit_uniformity: float = field(
        metadata={"note": "KS statistic vs uniform; 0 is perfectly calibrated"}, default=float("nan")
    )


@dataclass
class OccurrenceMetrics:
    brier: float
    brier_skill: float
    base_rate: float
    reliability: list[tuple[float, float, int]] = field(default_factory=list)


def _clean(y_true: np.ndarray, y_pred: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    if y_true.shape != y_pred.shape:
        raise ValueError(f"shape mismatch: {y_true.shape} vs {y_pred.shape}")
    mask = np.isfinite(y_true) & np.isfinite(y_pred)
    return y_true[mask], y_pred[mask]


def point_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> PointMetrics:
    t, p = _clean(y_true, y_pred)
    if t.size == 0:
        return PointMetrics(mae=float("nan"), rmse=float("nan"), bias=float("nan"), n=0)
    err = p - t
    return PointMetrics(
        mae=float(np.mean(np.abs(err))),
        rmse=float(np.sqrt(np.mean(err**2))),
        bias=float(np.mean(err)),
        n=int(t.size),
    )


def skill_score(model_error: float, baseline_error: float) -> float:
    """1 - model/baseline. Positive means better than the baseline.

    Returns NaN rather than a flattering number when the baseline is perfect,
    because a skill score against a zero-error baseline is not defined and
    reporting 0 or 1 there would be a quiet lie.
    """
    if not np.isfinite(model_error) or not np.isfinite(baseline_error):
        return float("nan")
    if baseline_error <= 0:
        return float("nan")
    return float(1.0 - model_error / baseline_error)


def pinball_loss(y_true: np.ndarray, y_pred: np.ndarray, tau: float) -> float:
    t, p = _clean(y_true, y_pred)
    if t.size == 0:
        return float("nan")
    diff = t - p
    return float(np.mean(np.maximum(tau * diff, (tau - 1.0) * diff)))


def crps_from_quantiles(y_true: np.ndarray, quantiles: dict[float, np.ndarray]) -> float:
    """Approximate CRPS by integrating pinball loss over the quantile levels.

    CRPS = 2 * integral_0^1 pinball_tau dtau. With only three fitted levels this
    is a coarse trapezoidal approximation, not an exact CRPS, and it is reported
    as a relative comparator between models rather than an absolute score.
    """
    levels = sorted(quantiles)
    if not levels:
        return float("nan")

    losses = [pinball_loss(y_true, quantiles[q], q) for q in levels]
    if len(levels) == 1:
        return float(2.0 * losses[0])

    # Trapezoidal integration over tau, extended to the [0,1] endpoints where the
    # pinball loss goes to zero.
    taus = [0.0, *levels, 1.0]
    vals = [0.0, *losses, 0.0]
    return float(2.0 * np.trapezoid(vals, taus))


def interval_coverage(
    y_true: np.ndarray, lower: np.ndarray, upper: np.ndarray
) -> tuple[float, float]:
    """Empirical coverage and mean width of a predictive interval.

    An 80% interval should contain the truth about 80% of the time. Much less and
    the model is overconfident; much more and it is uselessly vague. Both failures
    matter for a system whose selling point is calibrated uncertainty.
    """
    y = np.asarray(y_true, dtype=float)
    lo = np.asarray(lower, dtype=float)
    hi = np.asarray(upper, dtype=float)
    mask = np.isfinite(y) & np.isfinite(lo) & np.isfinite(hi)
    if not mask.any():
        return float("nan"), float("nan")
    y, lo, hi = y[mask], lo[mask], hi[mask]
    return (
        float(np.mean((y >= lo) & (y <= hi))),
        float(np.mean(hi - lo)),
    )


def pit_values(y_true: np.ndarray, quantiles: dict[float, np.ndarray]) -> np.ndarray:
    """Probability integral transform values, by interpolating the quantile ladder.

    If the predictive distribution is right, PIT values are uniform on [0,1]. A
    U-shaped PIT histogram means intervals are too narrow — the single most
    common and most dangerous failure for this product.
    """
    levels = sorted(quantiles)
    y = np.asarray(y_true, dtype=float)
    grid = np.vstack([np.asarray(quantiles[q], dtype=float) for q in levels])

    out = np.full(y.shape, np.nan)
    for i in range(y.size):
        col = grid[:, i]
        if not np.isfinite(y[i]) or not np.isfinite(col).all():
            continue
        # np.interp needs an increasing x; the quantile ladder is sorted already.
        out[i] = float(np.interp(y[i], col, levels, left=0.0, right=1.0))
    return out


def pit_uniformity(pit: np.ndarray) -> float:
    """Kolmogorov-Smirnov distance from uniform. 0 = perfectly calibrated."""
    p = np.asarray(pit, dtype=float)
    p = p[np.isfinite(p)]
    if p.size == 0:
        return float("nan")
    p = np.sort(p)
    n = p.size
    ecdf = np.arange(1, n + 1) / n
    return float(np.max(np.abs(ecdf - p)))


def probabilistic_metrics(
    y_true: np.ndarray, quantiles: dict[float, np.ndarray]
) -> ProbabilisticMetrics:
    lo_key, hi_key = min(quantiles), max(quantiles)
    cov, width = interval_coverage(y_true, quantiles[lo_key], quantiles[hi_key])
    return ProbabilisticMetrics(
        crps=crps_from_quantiles(y_true, quantiles),
        interval_coverage=cov,
        interval_width=width,
        pit_uniformity=pit_uniformity(pit_values(y_true, quantiles)),
    )


def brier_score(y_true: np.ndarray, p_pred: np.ndarray) -> float:
    t, p = _clean(y_true, p_pred)
    if t.size == 0:
        return float("nan")
    return float(np.mean((p - t) ** 2))


def occurrence_metrics(
    y_true: np.ndarray, p_pred: np.ndarray, n_bins: int = 10
) -> OccurrenceMetrics:
    """Brier score, skill against climatology, and a reliability curve.

    Brier skill is against the base rate, not against 0.5: beating a coin flip on
    monsoon rainfall is trivial, beating "it rains 62% of days here" is not.
    """
    t, p = _clean(y_true, p_pred)
    if t.size == 0:
        return OccurrenceMetrics(float("nan"), float("nan"), float("nan"))

    base = float(np.mean(t))
    bs = float(np.mean((p - t) ** 2))
    bs_climo = float(np.mean((base - t) ** 2))
    skill = float(1.0 - bs / bs_climo) if bs_climo > 0 else float("nan")

    edges = np.linspace(0.0, 1.0, n_bins + 1)
    reliability: list[tuple[float, float, int]] = []
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        sel = (p >= lo) & (p < hi) if i < n_bins - 1 else (p >= lo) & (p <= hi)
        if sel.sum() == 0:
            continue
        reliability.append((float(p[sel].mean()), float(t[sel].mean()), int(sel.sum())))

    return OccurrenceMetrics(
        brier=bs, brier_skill=skill, base_rate=base, reliability=reliability
    )

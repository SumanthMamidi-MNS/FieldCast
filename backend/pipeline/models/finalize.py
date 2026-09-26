"""From raw model outputs to the served forecast: reconcile, support, interval.

Numpy-only and shared: the pipeline's Predictor (LightGBM) and the deployed
runtime (numpy trees) both hand their raw quantiles here, so every step after
the trees is literally the same code in evaluation and in production.
"""

from __future__ import annotations

import numpy as np

from backend.app.schemas import Tier
from backend.config import QUANTILES
from backend.pipeline.models.numerics import mixture_quantiles
from backend.pipeline.models.reconcile import reconcile_quantiles, reconcile_two_stage
from backend.pipeline.models.uncertainty import (
    SupportModel,
    clamp_non_negative,
    inflate_interval,
    nearest_gauge_km,
    support_score,
)


def finalize_variable(
    *,
    quantiles: dict[float, np.ndarray],
    occurrence: np.ndarray | None,
    reconcile_mode: str,
    support_features: np.ndarray | None,
    support: SupportModel | None,
    lats: np.ndarray,
    lons: np.ndarray,
    tier: Tier,
    weights: np.ndarray | None = None,
    reconcile_to: float | None = None,
    scale_factor: float | None = None,
) -> dict:
    """Served median, interval, occurrence and support for one variable.

    `quantiles` are the model's natural-unit quantiles, sorted; for a two-stage
    variable (occurrence given) they are the if-wet conditional amounts.
    `reconcile_to` applies block-mean reconciliation (all rows one block-day).
    `scale_factor` is the point-scale widening fitted at gauges; applied below
    the grid scale (T2/T3) in place of the fixed T3 inflation.
    """
    n = len(lats)
    w = np.ones(n) if weights is None else np.asarray(weights, dtype=float)

    conditional = None
    if occurrence is not None:
        conditional = quantiles
        if reconcile_to is not None:
            conditional = reconcile_two_stage(conditional, occurrence, w, float(reconcile_to))
        quantiles = mixture_quantiles(conditional, occurrence)
    elif reconcile_to is not None:
        quantiles = reconcile_quantiles(quantiles, w, float(reconcile_to), reconcile_mode)

    lats = np.asarray(lats, dtype=float)
    lons = np.asarray(lons, dtype=float)
    if support is not None and support_features is not None:
        score = support_score(support_features, support, lats, lons, tier)
        gauge_km = nearest_gauge_km(lats, lons, support.gauge_coords)
    else:
        score = np.zeros(n)
        gauge_km = np.full(n, np.inf)

    lo_q, hi_q = min(QUANTILES), max(QUANTILES)
    median = quantiles[0.5]
    if scale_factor is not None and tier is not Tier.T1:
        lower, upper = inflate_interval(quantiles[lo_q], median, quantiles[hi_q], score, Tier.T2)
        k = float(scale_factor)
        lower, upper = median - k * (median - lower), median + k * (upper - median)
    else:
        lower, upper = inflate_interval(quantiles[lo_q], median, quantiles[hi_q], score, tier)
    if reconcile_mode == "multiplicative":
        lower, median, upper = clamp_non_negative(lower, median, upper)

    return {
        "median": median,
        "lower": lower,
        "upper": upper,
        "raw_quantiles": quantiles,
        "occurrence": occurrence,
        "conditional": conditional,
        "support_score": score,
        "nearest_gauge_km": gauge_km,
    }

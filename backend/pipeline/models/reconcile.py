"""Block-mean reconciliation.

After per-panchayat prediction, the area-weighted mean of the panchayat values
must return the official block value. This is not a modelling nicety — it is what
makes the output adoptable. IMD publishes a block forecast and has to stand behind
it; a downscaling layer that quietly contradicts the aggregate would be rejected
regardless of its skill scores. We redistribute within the block, we do not
overrule it.

Two reconciliation modes, because the variables differ in kind:

- **multiplicative** for non-negative fluxes (rainfall, wind). Scaling preserves
  zeros, which matters enormously for rainfall: an additive shift would turn a
  genuinely dry panchayat into a lightly wet one and destroy the discontinuity
  the two-stage model exists to capture.
- **additive** for intensive variables (temperature, humidity). A constant offset
  preserves the spatial gradient, which is the physically meaningful part.
"""

from __future__ import annotations

import numpy as np

# Below this block total, multiplicative scaling is numerically meaningless and
# we fall back to leaving the field alone: rescaling 0.02mm to hit 0.03mm is noise
# amplification, not reconciliation.
_NEGLIGIBLE_TOTAL = 1e-6

# Guard against a single panchayat absorbing an implausible correction when the
# predicted block mean is far below the official one.
_MAX_SCALE = 10.0


def reconcile(
    values: np.ndarray,
    weights: np.ndarray,
    block_value: float,
    mode: str,
) -> np.ndarray:
    """Adjust panchayat values so their weighted mean equals `block_value`.

    Args:
        values: predicted per-panchayat values.
        weights: area weights; need not be normalised.
        block_value: the official block-level value to preserve.
        mode: "multiplicative" or "additive".

    Returns:
        Adjusted values with the same shape as `values`.
    """
    values = np.asarray(values, dtype=float)
    weights = np.asarray(weights, dtype=float)

    if values.shape != weights.shape:
        raise ValueError(f"values/weights shape mismatch: {values.shape} vs {weights.shape}")
    if values.size == 0:
        return values.copy()
    if np.any(weights < 0):
        raise ValueError("weights must be non-negative")

    total_weight = weights.sum()
    if total_weight <= 0:
        raise ValueError("weights sum to zero; cannot reconcile")
    w = weights / total_weight

    finite = np.isfinite(values)
    if not finite.any():
        return values.copy()

    current = float(np.sum(w[finite] * values[finite]) / w[finite].sum())

    if mode == "additive":
        out = values + (block_value - current)

    elif mode == "multiplicative":
        if abs(current) < _NEGLIGIBLE_TOTAL:
            # Predicted field is essentially zero. If the block says it is also
            # dry, nothing to do. If the block says otherwise, we cannot
            # redistribute a zero field multiplicatively, so fall back to
            # spreading the block value uniformly rather than inventing a shape.
            if abs(block_value) < _NEGLIGIBLE_TOTAL:
                return values.copy()
            out = np.full_like(values, block_value)
            out[~finite] = np.nan
            return out

        scale = block_value / current
        scale = float(np.clip(scale, 0.0, _MAX_SCALE))
        out = values * scale
        out = np.maximum(out, 0.0)

    else:
        raise ValueError(f"unknown reconciliation mode: {mode!r}")

    out[~finite] = np.nan
    return out


def reconcile_quantiles(
    quantiles: dict[float, np.ndarray],
    weights: np.ndarray,
    block_value: float,
    mode: str,
) -> dict[float, np.ndarray]:
    """Reconcile a full set of predictive quantiles consistently.

    The same adjustment derived from the median is applied to every quantile.
    Reconciling each quantile independently to the block value would collapse the
    predictive interval toward the median and destroy the uncertainty information
    that is the entire point of this system.
    """
    if 0.5 not in quantiles:
        raise ValueError("median quantile (0.5) is required to derive the adjustment")

    median = np.asarray(quantiles[0.5], dtype=float)
    adjusted_median = reconcile(median, weights, block_value, mode)

    out: dict[float, np.ndarray] = {}
    for q, vals in quantiles.items():
        vals = np.asarray(vals, dtype=float)
        if mode == "additive":
            shift = adjusted_median - median
            out[q] = vals + shift
        else:
            with np.errstate(divide="ignore", invalid="ignore"):
                scale = np.where(np.abs(median) > _NEGLIGIBLE_TOTAL, adjusted_median / median, 1.0)
            out[q] = np.maximum(vals * scale, 0.0)

    return _enforce_monotonic(out)


def _enforce_monotonic(quantiles: dict[float, np.ndarray]) -> dict[float, np.ndarray]:
    """Guarantee q10 <= q50 <= q90 pointwise.

    Independently-fitted quantile regressors can cross, especially in sparse
    regions. A crossed interval is not merely untidy — it would render a lower
    bound above the upper bound in the UI and destroy trust in the whole display.
    """
    levels = sorted(quantiles)
    stacked = np.vstack([np.asarray(quantiles[q], dtype=float) for q in levels])
    stacked = np.sort(stacked, axis=0)
    return {q: stacked[i] for i, q in enumerate(levels)}


def differentiation_spread(values: np.ndarray) -> float:
    """Max-min across panchayats: the evidence that downscaling did something.

    success criterion 1. If this is ~0 the system returned the block value with
    extra steps, and the API says so rather than dressing it up.
    """
    values = np.asarray(values, dtype=float)
    finite = values[np.isfinite(values)]
    if finite.size < 2:
        return 0.0
    return float(finite.max() - finite.min())

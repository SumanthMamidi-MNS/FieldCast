"""Epistemic support scoring: "do we actually know this area?"

The quantile models give aleatoric uncertainty — how variable the weather
genuinely is at a location the model understands. They say nothing about
locations the model has never seen anything like. A LightGBM model asked about a
1400m windward ridge when it only ever trained on 600m plateau will answer with a
narrow, confident, wrong interval, because tree models extrapolate as a constant.

That failure mode is precisely what PRD §7 warns against: false precision driving
a real farming decision. So we compute support separately and let it widen the
interval and downgrade the advisory.

Support combines three signals:

1. **Covariate distance** — how far this panchayat's terrain sits from the
   training manifold, as a robust Mahalanobis distance.
2. **Observational proximity** — distance to the nearest real gauge. A panchayat
   50km from any station is less supported than one with a gauge in it, however
   ordinary its terrain.
3. **Tier** — T3 output is below the scale at which anything was validated, and
   carries a fixed penalty no amount of terrain similarity can remove.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.spatial.distance import cdist

from backend.app.schemas import SupportLevel, Tier
from backend.config import SUPPORT_LABELS, T3_INTERVAL_INFLATION

# Mahalanobis distance (in units of sigma) at which support from terrain
# similarity has fully decayed. 3 sigma is the conventional "clearly outside".
_MAX_MAHALANOBIS = 3.0

# Gauge distance (km) beyond which observational support is treated as absent.
# 50km is roughly the scale over which convective rainfall decorrelates in the
# monsoon, so a gauge further than that tells you little about here.
_MAX_GAUGE_KM = 50.0

# Blend weights. Terrain similarity dominates because it is what the model
# actually conditions on; gauge proximity is a secondary check on whether the
# region was observable at all.
_W_COVARIATE = 0.6
_W_GAUGE = 0.4

_TIER_PENALTY = {Tier.T1: 0.0, Tier.T2: 0.05, Tier.T3: 0.25}

_HIGH_THRESHOLD = 0.70
_MEDIUM_THRESHOLD = 0.40


@dataclass
class SupportModel:
    """Fitted description of where the training data actually lived."""

    mean: np.ndarray
    inv_cov: np.ndarray
    columns: list[str]
    gauge_coords: np.ndarray | None = None  # (n, 2) lat/lon of training stations

    @classmethod
    def fit(
        cls,
        features: np.ndarray,
        columns: list[str],
        gauge_coords: np.ndarray | None = None,
    ) -> SupportModel:
        """Fit the training manifold.

        Uses a pseudo-inverse: terrain covariates are genuinely collinear (slope
        and ruggedness co-vary strongly), and a plain inverse would either blow up
        or silently produce garbage distances.
        """
        features = np.asarray(features, dtype=float)
        finite = features[np.isfinite(features).all(axis=1)]
        if finite.shape[0] < 2:
            raise ValueError("need at least 2 complete rows to fit a support model")

        mean = finite.mean(axis=0)
        cov = np.cov(finite, rowvar=False)
        cov = np.atleast_2d(cov)
        # Ridge the diagonal for numerical stability before inverting.
        cov = cov + np.eye(cov.shape[0]) * 1e-6 * max(np.trace(cov), 1.0)
        inv_cov = np.linalg.pinv(cov)

        return cls(mean=mean, inv_cov=inv_cov, columns=list(columns), gauge_coords=gauge_coords)

    def mahalanobis(self, features: np.ndarray) -> np.ndarray:
        """Robust distance from the training manifold, in sigma units."""
        features = np.asarray(features, dtype=float)
        if features.ndim == 1:
            features = features.reshape(1, -1)

        delta = features - self.mean
        # Row-wise quadratic form without building an n-by-n matrix.
        left = delta @ self.inv_cov
        sq = np.einsum("ij,ij->i", left, delta)
        sq = np.maximum(sq, 0.0)          # tiny negatives from pinv rounding
        dist = np.sqrt(sq)

        # A row with any missing covariate cannot be scored; treat it as maximally
        # unsupported rather than imputing it into apparent confidence.
        incomplete = ~np.isfinite(features).all(axis=1)
        dist[incomplete] = np.inf
        return dist


def nearest_gauge_km(
    lats: np.ndarray,
    lons: np.ndarray,
    gauge_coords: np.ndarray | None,
) -> np.ndarray:
    """Great-circle distance to the closest observing station, in km."""
    lats = np.asarray(lats, dtype=float)
    lons = np.asarray(lons, dtype=float)

    if gauge_coords is None or len(gauge_coords) == 0:
        return np.full(lats.shape, np.inf)

    # Equirectangular approximation. At these distances and this latitude the
    # error is well under a kilometre, and this is a covariate, not a survey.
    lat0 = float(np.mean(lats))
    scale_lon = np.cos(np.radians(lat0))

    pts = np.column_stack([lats, lons * scale_lon])
    gauges = np.column_stack([gauge_coords[:, 0], gauge_coords[:, 1] * scale_lon])

    d_deg = cdist(pts, gauges).min(axis=1)
    return d_deg * 111.32


def support_score(
    features: np.ndarray,
    model: SupportModel,
    lats: np.ndarray,
    lons: np.ndarray,
    tier: Tier,
) -> np.ndarray:
    """Combine the signals into a 0-1 support score. 1 = fully supported."""
    maha = model.mahalanobis(features)
    cov_component = np.clip(1.0 - maha / _MAX_MAHALANOBIS, 0.0, 1.0)
    cov_component = np.where(np.isfinite(maha), cov_component, 0.0)

    gauge_km = nearest_gauge_km(lats, lons, model.gauge_coords)
    gauge_component = np.clip(1.0 - gauge_km / _MAX_GAUGE_KM, 0.0, 1.0)
    gauge_component = np.where(np.isfinite(gauge_km), gauge_component, 0.0)

    score = _W_COVARIATE * cov_component + _W_GAUGE * gauge_component
    score = score - _TIER_PENALTY[tier]
    return np.clip(score, 0.0, 1.0)


def support_level(score: float) -> SupportLevel:
    if score >= _HIGH_THRESHOLD:
        return SupportLevel.HIGH
    if score >= _MEDIUM_THRESHOLD:
        return SupportLevel.MEDIUM
    return SupportLevel.LOW


def support_label(level: SupportLevel) -> str:
    return SUPPORT_LABELS[level.value]


def inflate_interval(
    lower: np.ndarray,
    median: np.ndarray,
    upper: np.ndarray,
    score: np.ndarray,
    tier: Tier,
) -> tuple[np.ndarray, np.ndarray]:
    """Widen the predictive interval where support is weak.

    This is the mechanism that stops the tree model from reporting a narrow,
    confident interval in terrain it has never seen. Low support widens the
    interval up to 2x on top of the fixed T3 inflation; full support leaves it
    untouched.

    Widening is applied around the median so the central estimate is unchanged —
    we are expressing more doubt, not a different forecast.
    """
    lower = np.asarray(lower, dtype=float)
    median = np.asarray(median, dtype=float)
    upper = np.asarray(upper, dtype=float)
    score = np.asarray(score, dtype=float)

    # score 1.0 -> factor 1.0 (no change); score 0.0 -> factor 2.0
    factor = 1.0 + (1.0 - np.clip(score, 0.0, 1.0))
    if tier is Tier.T3:
        factor = factor * T3_INTERVAL_INFLATION

    new_lower = median - (median - lower) * factor
    new_upper = median + (upper - median) * factor
    return new_lower, new_upper


def clamp_non_negative(
    lower: np.ndarray, median: np.ndarray, upper: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Rainfall and wind cannot be negative; interval inflation can push them there."""
    return (
        np.maximum(lower, 0.0),
        np.maximum(median, 0.0),
        np.maximum(upper, 0.0),
    )

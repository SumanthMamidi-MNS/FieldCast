"""API response contract.

The central design commitment: a downscaled value is NEVER returned as a bare
number. Every value carries (a) a predictive interval, (b) the validation tier it
came from, and (c) a plain-language support label. The uncertainty requirement (architecture.md §0) demands this —
a confident-looking wrong forecast drives a real and costly farming decision.
"""

from __future__ import annotations

from datetime import date as Date
from enum import StrEnum

from pydantic import BaseModel, Field


class Tier(StrEnum):
    """How well-grounded a given number actually is."""

    T1 = "T1"  # validated against dense reanalysis truth (~9km)
    T2 = "T2"  # validated against real rain-gauge observations
    T3 = "T3"  # inferred below the validated scale


class SupportLevel(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Confidence(BaseModel):
    """Uncertainty, split into its two genuinely different kinds.

    Conflating these is the usual mistake: a narrow interval in a region we have
    never observed is not confidence, it is ignorance wearing confidence's clothes.
    """

    lower: float = Field(description="10th percentile of the predictive distribution")
    upper: float = Field(description="90th percentile of the predictive distribution")
    interval_pct: int = Field(default=80, description="Nominal coverage of [lower, upper]")

    support: SupportLevel = Field(description="Epistemic: how well do we know this area?")
    support_label: str = Field(description="Human-readable support, shown verbatim in the UI")
    support_score: float = Field(ge=0, le=1, description="0=no support, 1=fully in-distribution")

    tier: Tier
    tier_note: str = Field(description="What validation, if any, backs this number")

    nearest_gauge_km: float | None = Field(
        default=None, description="Distance to the nearest real observing station"
    )


class VariableForecast(BaseModel):
    """One weather variable for one panchayat on one day."""

    variable: str
    label: str
    unit: str

    value: float = Field(description="Downscaled median estimate")
    block_value: float = Field(description="The official block-level value, for comparison")
    anomaly: float = Field(description="value - block_value; the refinement we actually added")

    confidence: Confidence

    # Rainfall only: the occurrence probability from the two-stage model.
    # Kept separate from `value` on purpose — "70% chance of rain" and "expected
    # 12mm" are different statements and conflating them misleads.
    rain_probability: float | None = Field(
        default=None, ge=0, le=1, description="P(measurable rain) — precipitation only"
    )
    value_source: str = Field(
        default="model",
        description=(
            "'model': the panchayat-level estimate. 'block': the official block value, "
            "served because the model did not beat it on validation data (the range and, "
            "for rain, the rain chance still come from the model)."
        ),
    )


class PanchayatForecast(BaseModel):
    panchayat_id: str
    panchayat_name: str
    unit_type: str = Field(
        default="village_cluster",
        description="'gram_panchayat' (real LGD boundary) or 'village_cluster' (approximation)",
    )
    block_id: str
    block_name: str

    latitude: float
    longitude: float
    elevation_m: float
    area_km2: float

    date: Date
    variables: dict[str, VariableForecast]

    advisory: Advisory


class AdvisoryAction(StrEnum):
    """What the officer should actually tell farmers to do."""

    PROCEED = "proceed"
    CAUTION = "caution"
    AVOID = "avoid"
    NO_GUIDANCE = "no_guidance"


class AdvisoryItem(BaseModel):
    """A single actionable agro-met recommendation."""

    activity: str = Field(description="e.g. 'Pesticide spraying'")
    action: AdvisoryAction
    reason: str = Field(description="Plain language, cites the driving variable")
    confidence_caveat: str | None = Field(
        default=None,
        description="Present when low support should change how much the officer trusts this",
    )


class Advisory(BaseModel):
    """Plain-language guidance derived from the downscaled variables.

    This is the layer that makes the system usable by an extension officer rather
    than only evaluable as a benchmark (the extension-officer usability goal).
    """

    headline: str
    items: list[AdvisoryItem]
    uncertainty_statement: str = Field(
        description="The honest caveat, always present, never buried"
    )


class BlockForecastResponse(BaseModel):
    """All panchayats inside one block for one date."""

    block_id: str
    block_name: str
    district: str
    state: str
    date: Date

    panchayat_count: int
    panchayats: list[PanchayatForecast]

    # The headline proof that this is not a copy-paste of the block value.
    differentiation: Differentiation

    model_version: str
    generated_at: str


class Differentiation(BaseModel):
    """Evidence that downscaling actually did something (success criterion 1).

    If spread is ~0 the system has added nothing, and we say so rather than
    presenting identical numbers as if they were insight.
    """

    variable_spread: dict[str, float] = Field(
        description="max-min across panchayats within the block, per variable"
    )
    meaningful: bool = Field(
        description="True if at least one variable is differentiated beyond noise"
    )
    note: str


class BlockSummary(BaseModel):
    block_id: str
    block_name: str
    district: str
    state: str
    panchayat_count: int
    centroid_lat: float
    centroid_lon: float


class PanchayatGeometry(BaseModel):
    """GeoJSON-ready panchayat outline for the map."""

    panchayat_id: str
    panchayat_name: str
    unit_type: str = "village_cluster"
    block_id: str
    geometry: dict
    centroid_lat: float
    centroid_lon: float
    elevation_m: float
    area_km2: float


class BaselineComparison(BaseModel):
    """Model vs the naive block-copy baseline, for the dashboard's 'why' view."""

    variable: str
    label: str
    unit: str
    model_mae: float
    naive_mae: float
    skill_score: float = Field(description="1 - model_mae/naive_mae; >0 means we beat naive")
    interval_coverage: float = Field(description="Empirical coverage of the 80% interval")
    n_observations: int
    tier: Tier
    region: str


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    model_version: str | None
    regions_available: list[str]
    offline_mode: bool


# Resolve forward references declared before their targets.
PanchayatForecast.model_rebuild()
BlockForecastResponse.model_rebuild()

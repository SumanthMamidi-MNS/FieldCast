"""Agro-meteorological advisory generation.

Turns downscaled numbers into the sentence an extension officer actually says to
a farmer. The bar is usability by an extension officer: the system must be usable by an advisory officer,
not merely evaluable as a benchmark.

Two design commitments that are easy to get wrong:

1. **Low confidence makes advice more conservative, not less.** The cost of
   agro-met errors is asymmetric. Spraying before unforecast rain wastes the
   chemical, pollutes runoff, and leaves the crop unprotected; *not* spraying
   costs one day. So when support is low we downgrade PROCEED to CAUTION on
   irreversible, input-consuming operations. We never upgrade a warning away.

2. **Rain probability and rain amount drive different decisions.** Spray timing
   depends on *whether* it rains; irrigation depends on *how much*. The two-stage
   rainfall model gives us both, and we use each where it belongs rather than
   collapsing them into one number.

Thresholds below are stated explicitly so they can be challenged and tuned by an
agronomist rather than buried in code.
"""

from __future__ import annotations

from dataclasses import dataclass

from backend.app.schemas import (
    Advisory,
    AdvisoryAction,
    AdvisoryItem,
    SupportLevel,
    VariableForecast,
)

# --------------------------------------------------------------------------
# Agronomic thresholds. Sources: IMD Agromet Advisory Service bulletins and
# standard extension practice. Tunable per crop/region in future work.
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Thresholds:
    # Spraying
    spray_rain_prob_avoid: float = 0.40   # wash-off risk becomes material
    spray_rain_prob_caution: float = 0.20
    spray_wind_avoid_kmh: float = 20.0    # droplet drift onto non-target areas
    spray_wind_caution_kmh: float = 15.0

    # Irrigation
    irrigation_rain_sufficient_mm: float = 10.0   # skip irrigation
    irrigation_rain_partial_mm: float = 3.0       # reduce, do not skip
    irrigation_heat_stress_c: float = 38.0

    # Harvest / drying
    harvest_rain_prob_avoid: float = 0.35
    harvest_rain_amount_avoid_mm: float = 5.0

    # Fertiliser
    fert_runoff_risk_mm: float = 25.0     # heavy rain leaches surface-applied N

    # Fungal disease pressure
    disease_humidity_pct: float = 85.0
    disease_temp_min_c: float = 18.0
    disease_temp_max_c: float = 30.0

    # Heavy rainfall warning (IMD-style daily categories)
    heavy_rain_mm: float = 64.5
    very_heavy_rain_mm: float = 115.5


THRESHOLDS = Thresholds()

# Operations that consume an input and cannot be undone once performed.
# These are the ones we make more conservative under low confidence.
_IRREVERSIBLE = {"Pesticide spraying", "Fertiliser application", "Harvesting"}

_LOW_SUPPORT_CAVEAT = (
    "Local terrain data is sparse for this panchayat, so this estimate is less "
    "certain than for neighbouring areas — confirm against local observation."
)
_MEDIUM_SUPPORT_CAVEAT = (
    "Moderate confidence for this panchayat; treat the range, not the single "
    "number, as the forecast."
)


def _get(variables: dict[str, VariableForecast], key: str) -> VariableForecast | None:
    return variables.get(key)


def _worst_support(variables: dict[str, VariableForecast]) -> SupportLevel:
    """The advisory is only as trustworthy as its least-supported input."""
    order = {SupportLevel.HIGH: 0, SupportLevel.MEDIUM: 1, SupportLevel.LOW: 2}
    if not variables:
        return SupportLevel.LOW
    return max((v.confidence.support for v in variables.values()), key=lambda s: order[s])


def _downgrade(action: AdvisoryAction) -> AdvisoryAction:
    """One step more cautious. Never moves toward PROCEED."""
    if action is AdvisoryAction.PROCEED:
        return AdvisoryAction.CAUTION
    return action


def _spray_advice(variables: dict[str, VariableForecast]) -> AdvisoryItem | None:
    rain = _get(variables, "precip")
    wind = _get(variables, "wind")
    if rain is None and wind is None:
        return None

    p = rain.rain_probability if rain and rain.rain_probability is not None else 0.0
    w = wind.value if wind else 0.0

    if p >= THRESHOLDS.spray_rain_prob_avoid:
        return AdvisoryItem(
            activity="Pesticide spraying",
            action=AdvisoryAction.AVOID,
            reason=(
                f"{p:.0%} chance of rain — spray applied now is likely to wash off "
                f"before it acts, wasting the input and leaving the crop unprotected."
            ),
        )
    if w >= THRESHOLDS.spray_wind_avoid_kmh:
        return AdvisoryItem(
            activity="Pesticide spraying",
            action=AdvisoryAction.AVOID,
            reason=(
                f"Wind up to {w:.0f} km/h will carry spray droplets off-target. "
                f"Wait for calmer conditions, ideally early morning."
            ),
        )
    if p >= THRESHOLDS.spray_rain_prob_caution or w >= THRESHOLDS.spray_wind_caution_kmh:
        return AdvisoryItem(
            activity="Pesticide spraying",
            action=AdvisoryAction.CAUTION,
            reason=(
                f"{p:.0%} rain chance and wind up to {w:.0f} km/h — possible but not ideal. "
                f"Spray early morning and allow a few hours of drying time."
            ),
        )
    return AdvisoryItem(
        activity="Pesticide spraying",
        action=AdvisoryAction.PROCEED,
        reason=(
            f"Low rain chance ({p:.0%}) and light wind ({w:.0f} km/h) — good spraying window."
        ),
    )


def _irrigation_advice(variables: dict[str, VariableForecast]) -> AdvisoryItem | None:
    rain = _get(variables, "precip")
    tmax = _get(variables, "tmax")
    if rain is None:
        return None

    mm = rain.value
    hot = tmax is not None and tmax.value >= THRESHOLDS.irrigation_heat_stress_c

    if mm >= THRESHOLDS.irrigation_rain_sufficient_mm:
        return AdvisoryItem(
            activity="Irrigation",
            action=AdvisoryAction.AVOID,
            reason=(
                f"About {mm:.0f} mm of rain expected here — enough to meet crop water "
                f"need. Irrigating as well risks waterlogging and wastes water."
            ),
        )
    if mm >= THRESHOLDS.irrigation_rain_partial_mm:
        return AdvisoryItem(
            activity="Irrigation",
            action=AdvisoryAction.CAUTION,
            reason=(
                f"About {mm:.0f} mm expected — some help, but not a full replacement. "
                f"Reduce the planned volume rather than skipping entirely."
            ),
        )
    if hot:
        return AdvisoryItem(
            activity="Irrigation",
            action=AdvisoryAction.PROCEED,
            reason=(
                f"Little rain expected ({mm:.1f} mm) with {tmax.value:.0f}°C peak temperature — "
                f"irrigate, preferably early morning or evening to cut evaporation loss."
            ),
        )
    return AdvisoryItem(
        activity="Irrigation",
        action=AdvisoryAction.PROCEED,
        reason=f"Little rain expected ({mm:.1f} mm) — irrigate as per your normal schedule.",
    )


def _harvest_advice(variables: dict[str, VariableForecast]) -> AdvisoryItem | None:
    rain = _get(variables, "precip")
    if rain is None:
        return None

    p = rain.rain_probability if rain.rain_probability is not None else 0.0
    mm = rain.value

    if p >= THRESHOLDS.harvest_rain_prob_avoid or mm >= THRESHOLDS.harvest_rain_amount_avoid_mm:
        return AdvisoryItem(
            activity="Harvesting",
            action=AdvisoryAction.AVOID,
            reason=(
                f"{p:.0%} chance of rain ({mm:.0f} mm expected) — harvested grain left in "
                f"the open will take up moisture and risk spoilage. Delay, or ensure covered storage."
            ),
        )
    return AdvisoryItem(
        activity="Harvesting",
        action=AdvisoryAction.PROCEED,
        reason=f"Dry conditions expected ({p:.0%} rain chance) — suitable for harvest and drying.",
    )


def _fertiliser_advice(variables: dict[str, VariableForecast]) -> AdvisoryItem | None:
    rain = _get(variables, "precip")
    if rain is None:
        return None

    mm = rain.value
    if mm >= THRESHOLDS.fert_runoff_risk_mm:
        return AdvisoryItem(
            activity="Fertiliser application",
            action=AdvisoryAction.AVOID,
            reason=(
                f"Heavy rain expected ({mm:.0f} mm) — surface-applied nutrients will wash "
                f"away before the crop can take them up. Apply after the rain passes."
            ),
        )
    if THRESHOLDS.irrigation_rain_partial_mm <= mm < THRESHOLDS.fert_runoff_risk_mm:
        return AdvisoryItem(
            activity="Fertiliser application",
            action=AdvisoryAction.PROCEED,
            reason=(
                f"Light to moderate rain ({mm:.0f} mm) will help work the fertiliser into "
                f"the soil — a favourable window."
            ),
        )
    return AdvisoryItem(
        activity="Fertiliser application",
        action=AdvisoryAction.CAUTION,
        reason=(
            f"Very little rain expected ({mm:.1f} mm) — irrigate lightly after applying so "
            f"nutrients reach the root zone."
        ),
    )


def _disease_advice(variables: dict[str, VariableForecast]) -> AdvisoryItem | None:
    rh = _get(variables, "humidity")
    tmax = _get(variables, "tmax")
    if rh is None or tmax is None:
        return None

    if (
        rh.value >= THRESHOLDS.disease_humidity_pct
        and THRESHOLDS.disease_temp_min_c <= tmax.value <= THRESHOLDS.disease_temp_max_c
    ):
        return AdvisoryItem(
            activity="Fungal disease watch",
            action=AdvisoryAction.CAUTION,
            reason=(
                f"{rh.value:.0f}% humidity at {tmax.value:.0f}°C is favourable for fungal "
                f"infection. Scout the crop and consider a preventive fungicide if the "
                f"spray window allows."
            ),
        )
    return None


def _heavy_rain_item(variables: dict[str, VariableForecast]) -> AdvisoryItem | None:
    rain = _get(variables, "precip")
    if rain is None:
        return None
    mm = rain.confidence.upper  # warn on the plausible high end, not the median
    if mm >= THRESHOLDS.very_heavy_rain_mm:
        return AdvisoryItem(
            activity="Heavy rainfall preparedness",
            action=AdvisoryAction.AVOID,
            reason=(
                f"Upper estimate reaches {mm:.0f} mm — very heavy rainfall is plausible here. "
                f"Clear field drainage, secure harvested produce, and defer field operations."
            ),
        )
    if mm >= THRESHOLDS.heavy_rain_mm:
        return AdvisoryItem(
            activity="Heavy rainfall preparedness",
            action=AdvisoryAction.CAUTION,
            reason=(
                f"Upper estimate reaches {mm:.0f} mm — heavy rainfall is possible. "
                f"Check drainage and avoid leaving produce uncovered."
            ),
        )
    return None


def _headline(variables: dict[str, VariableForecast], items: list[AdvisoryItem]) -> str:
    rain = _get(variables, "precip")
    tmax = _get(variables, "tmax")

    parts: list[str] = []
    if rain is not None:
        p = rain.rain_probability if rain.rain_probability is not None else 0.0
        if p >= 0.6:
            parts.append(f"Rain likely ({p:.0%}), about {rain.value:.0f} mm")
        elif p >= 0.3:
            parts.append(f"Rain possible ({p:.0%}), about {rain.value:.0f} mm")
        else:
            parts.append(f"Mostly dry ({p:.0%} rain chance)")
    if tmax is not None:
        parts.append(f"peak {tmax.value:.0f}°C")

    avoided = [i.activity.lower() for i in items if i.action is AdvisoryAction.AVOID]
    lead = "; ".join(parts) if parts else "Forecast available"
    if avoided:
        return f"{lead}. Hold off on {', '.join(avoided)}."
    return f"{lead}. No operations need to be postponed."


def _uncertainty_statement(
    variables: dict[str, VariableForecast], support: SupportLevel
) -> str:
    """Always present, never buried. This is the core design tension (architecture.md §0) made literal."""
    if not variables:
        return (
            "No forecast variables were available for this panchayat, so no confidence "
            "can be stated. Do not treat the absence of a warning as an all-clear."
        )
    rain = _get(variables, "precip")
    tier = rain.confidence.tier if rain else next(iter(variables.values())).confidence.tier

    base = {
        SupportLevel.HIGH: (
            "Confidence is good for this panchayat: its terrain is well represented in "
            "the training data and an observing station is nearby."
        ),
        SupportLevel.MEDIUM: (
            "Confidence is moderate for this panchayat. Use the stated range rather than "
            "the single value when the decision is costly."
        ),
        SupportLevel.LOW: (
            "Confidence is low for this panchayat — we have little local terrain or "
            "observational support here. Treat this as indicative and verify locally "
            "before acting on it."
        ),
    }[support]

    if rain is not None:
        lo, hi = rain.confidence.lower, rain.confidence.upper
        base += f" Rainfall could plausibly fall anywhere between {lo:.0f} and {hi:.0f} mm."

    if tier == "T3":
        base += (
            " This estimate is produced below the scale at which we can validate against "
            "observations, so it is physically-informed inference rather than a measured result."
        )
    return base


def build_advisory(variables: dict[str, VariableForecast]) -> Advisory:
    """Assemble the full advisory for one panchayat-day.

    Order matters: the most decision-changing warnings come first, because an
    officer reading on a phone in the field may not scroll.
    """
    candidates = [
        _heavy_rain_item(variables),
        _spray_advice(variables),
        _irrigation_advice(variables),
        _harvest_advice(variables),
        _fertiliser_advice(variables),
        _disease_advice(variables),
    ]
    items = [i for i in candidates if i is not None]

    support = _worst_support(variables)

    # Asymmetric-cost adjustment: low confidence tightens advice on operations
    # that consume an input and cannot be undone.
    if support is SupportLevel.LOW:
        adjusted: list[AdvisoryItem] = []
        for item in items:
            if item.activity in _IRREVERSIBLE:
                adjusted.append(
                    item.model_copy(
                        update={
                            "action": _downgrade(item.action),
                            "confidence_caveat": _LOW_SUPPORT_CAVEAT,
                        }
                    )
                )
            else:
                adjusted.append(item.model_copy(update={"confidence_caveat": _LOW_SUPPORT_CAVEAT}))
        items = adjusted
    elif support is SupportLevel.MEDIUM:
        items = [
            i.model_copy(update={"confidence_caveat": _MEDIUM_SUPPORT_CAVEAT})
            if i.activity in _IRREVERSIBLE
            else i
            for i in items
        ]

    if not items:
        items = [
            AdvisoryItem(
                activity="General",
                action=AdvisoryAction.NO_GUIDANCE,
                reason="Not enough variables were available to generate specific guidance.",
            )
        ]

    return Advisory(
        headline=_headline(variables, items),
        items=items,
        uncertainty_statement=_uncertainty_statement(variables, support),
    )

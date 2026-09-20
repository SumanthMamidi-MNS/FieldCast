"""Tests for the agro-advisory engine.

The behaviour worth protecting here is the asymmetric-cost rule: low confidence
must make advice MORE conservative. A regression that silently flips this would
produce confident-sounding advice in exactly the places we know least about,
which is the specific failure PRD §7 warns against.
"""

from __future__ import annotations

import pytest

from backend.app.schemas import (
    AdvisoryAction,
    Confidence,
    SupportLevel,
    Tier,
    VariableForecast,
)
from backend.app.services.advisory import build_advisory


def _conf(
    lower: float,
    upper: float,
    support: SupportLevel = SupportLevel.HIGH,
    tier: Tier = Tier.T2,
) -> Confidence:
    return Confidence(
        lower=lower,
        upper=upper,
        support=support,
        support_label=support.value,
        support_score={SupportLevel.HIGH: 0.9, SupportLevel.MEDIUM: 0.6, SupportLevel.LOW: 0.2}[
            support
        ],
        tier=tier,
        tier_note="test",
        nearest_gauge_km=5.0,
    )


def _var(
    key: str,
    value: float,
    *,
    block_value: float | None = None,
    rain_prob: float | None = None,
    support: SupportLevel = SupportLevel.HIGH,
    lower: float | None = None,
    upper: float | None = None,
    tier: Tier = Tier.T2,
) -> VariableForecast:
    bv = block_value if block_value is not None else value
    return VariableForecast(
        variable=key,
        label=key,
        unit="mm" if key == "precip" else "u",
        value=value,
        block_value=bv,
        anomaly=value - bv,
        confidence=_conf(
            lower if lower is not None else value * 0.5,
            upper if upper is not None else value * 1.5,
            support,
            tier,
        ),
        rain_probability=rain_prob,
    )


def _actions(advisory) -> dict[str, AdvisoryAction]:
    return {i.activity: i.action for i in advisory.items}


# --------------------------------------------------------------------------


def test_high_rain_probability_blocks_spraying():
    adv = build_advisory({"precip": _var("precip", 12.0, rain_prob=0.8)})
    assert _actions(adv)["Pesticide spraying"] is AdvisoryAction.AVOID
    assert "wash off" in _actions_reason(adv, "Pesticide spraying")


def test_high_wind_blocks_spraying_even_when_dry():
    adv = build_advisory(
        {"precip": _var("precip", 0.0, rain_prob=0.02), "wind": _var("wind", 26.0)}
    )
    assert _actions(adv)["Pesticide spraying"] is AdvisoryAction.AVOID
    assert "off-target" in _actions_reason(adv, "Pesticide spraying")


def test_dry_calm_conditions_allow_spraying():
    adv = build_advisory(
        {"precip": _var("precip", 0.0, rain_prob=0.05), "wind": _var("wind", 6.0)}
    )
    assert _actions(adv)["Pesticide spraying"] is AdvisoryAction.PROCEED


def test_sufficient_rain_cancels_irrigation():
    adv = build_advisory({"precip": _var("precip", 18.0, rain_prob=0.9)})
    assert _actions(adv)["Irrigation"] is AdvisoryAction.AVOID


def test_heat_without_rain_triggers_irrigation():
    adv = build_advisory(
        {"precip": _var("precip", 0.2, rain_prob=0.05), "tmax": _var("tmax", 41.0)}
    )
    assert _actions(adv)["Irrigation"] is AdvisoryAction.PROCEED


def test_heavy_rain_warning_uses_upper_bound_not_median():
    """A 20mm median with a 130mm upper bound is still a preparedness warning.

    Warning only on the median would hide exactly the tail risk that matters.
    """
    adv = build_advisory(
        {"precip": _var("precip", 20.0, rain_prob=0.9, lower=5.0, upper=130.0)}
    )
    assert "Heavy rainfall preparedness" in _actions(adv)


def test_no_heavy_rain_warning_when_upper_bound_is_modest():
    adv = build_advisory({"precip": _var("precip", 8.0, rain_prob=0.5, lower=2.0, upper=20.0)})
    assert "Heavy rainfall preparedness" not in _actions(adv)


def test_low_support_downgrades_irreversible_operations():
    """The core asymmetric-cost rule."""
    good = {
        "precip": _var("precip", 0.0, rain_prob=0.05),
        "wind": _var("wind", 5.0),
    }
    baseline = build_advisory(good)
    assert _actions(baseline)["Pesticide spraying"] is AdvisoryAction.PROCEED

    low = {
        "precip": _var("precip", 0.0, rain_prob=0.05, support=SupportLevel.LOW),
        "wind": _var("wind", 5.0, support=SupportLevel.LOW),
    }
    degraded = build_advisory(low)
    assert _actions(degraded)["Pesticide spraying"] is AdvisoryAction.CAUTION
    assert all(i.confidence_caveat for i in degraded.items)


def test_low_support_never_softens_an_avoid():
    """Conservatism is one-directional: we never talk a warning down."""
    low = {"precip": _var("precip", 30.0, rain_prob=0.9, support=SupportLevel.LOW)}
    adv = build_advisory(low)
    assert _actions(adv)["Irrigation"] is AdvisoryAction.AVOID


def test_worst_support_across_variables_governs():
    """One poorly-supported variable degrades the whole advisory."""
    mixed = {
        "precip": _var("precip", 0.0, rain_prob=0.05, support=SupportLevel.HIGH),
        "wind": _var("wind", 5.0, support=SupportLevel.LOW),
    }
    adv = build_advisory(mixed)
    assert _actions(adv)["Pesticide spraying"] is AdvisoryAction.CAUTION


def test_uncertainty_statement_always_present_and_mentions_range():
    adv = build_advisory({"precip": _var("precip", 10.0, rain_prob=0.5, lower=1.0, upper=40.0)})
    assert adv.uncertainty_statement
    assert "1" in adv.uncertainty_statement and "40" in adv.uncertainty_statement


def test_t3_tier_is_disclosed_in_the_statement():
    adv = build_advisory(
        {"precip": _var("precip", 10.0, rain_prob=0.5, tier=Tier.T3, support=SupportLevel.MEDIUM)}
    )
    assert "inference" in adv.uncertainty_statement.lower()


def test_disease_watch_fires_on_humid_mild_conditions():
    adv = build_advisory(
        {
            "precip": _var("precip", 1.0, rain_prob=0.2),
            "humidity": _var("humidity", 92.0),
            "tmax": _var("tmax", 26.0),
        }
    )
    assert "Fungal disease watch" in _actions(adv)


def test_disease_watch_silent_when_hot_and_dry():
    adv = build_advisory(
        {
            "precip": _var("precip", 0.0, rain_prob=0.02),
            "humidity": _var("humidity", 30.0),
            "tmax": _var("tmax", 41.0),
        }
    )
    assert "Fungal disease watch" not in _actions(adv)


def test_headline_names_postponed_operations():
    adv = build_advisory({"precip": _var("precip", 25.0, rain_prob=0.85)})
    assert "Hold off" in adv.headline


def test_empty_variables_degrade_gracefully():
    adv = build_advisory({})
    assert _actions(adv)["General"] is AdvisoryAction.NO_GUIDANCE
    assert adv.uncertainty_statement


# --------------------------------------------------------------------------


def _actions_reason(advisory, activity: str) -> str:
    for i in advisory.items:
        if i.activity == activity:
            return i.reason
    pytest.fail(f"no advisory item for {activity}")

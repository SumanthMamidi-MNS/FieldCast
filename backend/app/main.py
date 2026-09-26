"""FastAPI application.

Run:  uvicorn backend.app.main:app --reload --port 8000
"""

from __future__ import annotations

import json
import os
from datetime import date as Date

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.app.schemas import (
    BaselineComparison,
    BlockForecastResponse,
    BlockSummary,
    HealthResponse,
    PanchayatGeometry,
    Tier,
)
from backend.app.services import forecast as svc
from backend.config import ARTIFACT_DIR, PRIMARY_REGION, REGIONS, REPORT_DIR
from backend.pipeline.models.downscaler import MODEL_VERSION
from backend.pipeline.sources.open_meteo import set_pacing

# Interactive requests are small; pace them to the minutely limit, not the hourly
# budget that long training runs need.
set_pacing("minutely")

app = FastAPI(
    title="Panchayat Weather Downscaling API",
    version=MODEL_VERSION,
    description=(
        "Downscales block-level weather forecasts to panchayat level for agro-met advisories. "
        "Every value carries a predictive interval, a validation tier, and a support label."
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _region(region: str) -> str:
    if region not in REGIONS:
        raise HTTPException(404, f"unknown region {region!r}; available: {sorted(REGIONS)}")
    if not (ARTIFACT_DIR / region).exists() and not (ARTIFACT_DIR / PRIMARY_REGION).exists():
        raise HTTPException(503, "models are not trained yet")
    return region


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except svc.ForecastError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(503, f"required artifact missing: {exc}") from exc


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    trained = [r for r in REGIONS if (ARTIFACT_DIR / r / "summary.json").exists()]
    return HealthResponse(
        status="ok",
        model_loaded=bool(trained),
        model_version=MODEL_VERSION if trained else None,
        regions_available=trained,
        offline_mode=os.environ.get("DOWNSCALE_OFFLINE") == "1",
    )


@app.get("/api/blocks", response_model=list[BlockSummary])
def blocks(region: str = Query(PRIMARY_REGION)) -> list[BlockSummary]:
    return _call(svc.list_blocks, _region(region))


@app.get("/api/blocks/{block_id}/panchayats", response_model=list[PanchayatGeometry])
def panchayats(block_id: str, region: str = Query(PRIMARY_REGION)) -> list[PanchayatGeometry]:
    return _call(svc.panchayat_geometries, _region(region), block_id)


@app.get("/api/blocks/{block_id}/forecast", response_model=BlockForecastResponse)
def forecast(
    block_id: str,
    date: Date = Query(..., description="YYYY-MM-DD"),
    region: str = Query(PRIMARY_REGION),
) -> BlockForecastResponse:
    return _call(svc.block_forecast, _region(region), block_id, date)


class BlockInput(BaseModel):
    """An official block-level forecast to be downscaled (e.g. an IMD bulletin)."""

    date: Date
    block_values: dict[str, float] = Field(
        description="Variable key -> block value, e.g. {'precip': 24.0, 'tmax': 29.5}"
    )


@app.post("/api/blocks/{block_id}/forecast", response_model=BlockForecastResponse)
def forecast_from_input(
    block_id: str, body: BlockInput, region: str = Query(PRIMARY_REGION)
) -> BlockForecastResponse:
    if not body.block_values:
        raise HTTPException(422, "block_values must not be empty")
    return _call(svc.block_forecast, _region(region), block_id, body.date, body.block_values)


@app.get("/api/evaluation", response_model=list[BaselineComparison])
def evaluation(region: str = Query(PRIMARY_REGION)) -> list[BaselineComparison]:
    """Model-vs-naive skill from the committed evaluation report."""
    path = REPORT_DIR / f"evaluation_{region}.json"
    if not path.exists():
        raise HTTPException(404, f"no evaluation report for {region!r}; run the evaluation first")
    report = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for tier in ("T1", "T2"):
        for r in report.get(tier, {}).values():
            out.append(
                BaselineComparison(
                    variable=r["variable"],
                    label=r["label"],
                    unit=r["unit"],
                    model_mae=r["model_mae"],
                    naive_mae=r["naive_mae"],
                    skill_score=r["skill_vs_naive"],
                    interval_coverage=r["interval_coverage_80"],
                    n_observations=r["n"],
                    tier=Tier(tier),
                    region=region,
                )
            )
    return out

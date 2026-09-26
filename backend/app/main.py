"""FieldCast API: the same app runs locally and on Vercel.

Local:   uvicorn backend.app.main:app --port 8000   (serves the API and, when
         `frontend/dist` exists, the dashboard at /)
Vercel:  found through `[tool.vercel] entrypoint` in pyproject.toml; the
         dashboard mount is promoted to the CDN at build time.

Reads only the committed serving bundle (`serve_bundle/`), so it needs numpy,
httpx and FastAPI, not the training stack.
"""

from __future__ import annotations

import os
from datetime import date as Date
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.app.schemas import (
    BaselineComparison,
    BlockForecastResponse,
    BlockSummary,
    HealthResponse,
    PanchayatGeometry,
    Tier,
)
from backend.config import MODEL_VERSION, PRIMARY_REGION, REGIONS, ROOT
from backend.serve import runtime as rt

app = FastAPI(
    title="FieldCast API",
    version=MODEL_VERSION,
    description=(
        "Downscales block-level weather forecasts to panchayat level for agro-met advisories. "
        "Every value carries a predictive interval, a validation tier, and a support label."
    ),
)

_cors = os.environ.get("CORS_ORIGINS")
if _cors:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors.split(","),
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )


def _runtime(region: str) -> rt.RegionRuntime:
    if region not in REGIONS:
        raise HTTPException(404, f"unknown region {region!r}; available: {sorted(REGIONS)}")
    if region not in rt.served_regions():
        raise HTTPException(
            503, f"{REGIONS[region].state_name} is not served yet: no trained model bundle."
        )
    return rt.get_runtime(region)


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except rt.ForecastError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


# --------------------------------------------------------------------------
@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    served = rt.served_regions()
    return HealthResponse(
        status="ok",
        model_loaded=bool(served),
        model_version=MODEL_VERSION if served else None,
        regions_available=served,
        offline_mode=os.environ.get("DOWNSCALE_OFFLINE") == "1",
    )


class RegionInfo(BaseModel):
    key: str
    state: str
    districts: list[str]
    served: bool = Field(description="True when this region has its own trained models")


@app.get("/api/regions", response_model=list[RegionInfo])
def regions() -> list[RegionInfo]:
    served = set(rt.served_regions())
    return [
        RegionInfo(key=r.key, state=r.state_name, districts=list(r.districts), served=r.key in served)
        for r in REGIONS.values()
    ]


@app.get("/api/blocks", response_model=list[BlockSummary])
def blocks(region: str = Query(PRIMARY_REGION)) -> list[BlockSummary]:
    return _call(_runtime(region).list_blocks)


@app.get("/api/blocks/{block_id}/panchayats", response_model=list[PanchayatGeometry])
def panchayats(block_id: str, region: str = Query(PRIMARY_REGION)) -> list[PanchayatGeometry]:
    return _call(_runtime(region).panchayat_geometries, block_id)


@app.get("/api/blocks/{block_id}/forecast", response_model=BlockForecastResponse)
def forecast(
    block_id: str,
    date: Date = Query(..., description="YYYY-MM-DD"),
    region: str = Query(PRIMARY_REGION),
) -> BlockForecastResponse:
    return _call(_runtime(region).forecast, block_id, date)


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
    return _call(_runtime(region).forecast, block_id, body.date, body.block_values)


@app.get("/api/evaluation", response_model=list[BaselineComparison])
def evaluation(region: str = Query(PRIMARY_REGION)) -> list[BaselineComparison]:
    """Model-vs-naive skill for one region, from its committed evaluation report."""
    report = rt.evaluation_reports().get(f"evaluation_{region}")
    if report is None:
        raise HTTPException(404, f"no evaluation report for {region!r}")
    out = []
    for tier in ("T1", "T2", "T2_hist"):
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
                    tier=Tier("T2" if tier == "T2_hist" else tier),
                    region=f"{region} (1960-61 gauges)" if tier == "T2_hist" else region,
                )
            )
    return out


@app.get("/api/evaluation/reports")
def evaluation_reports() -> dict:
    """Every committed evaluation report, keyed by file stem, for the Evidence page."""
    return rt.evaluation_reports()


# --------------------------------------------------------------------------
# Dashboard. Mounted last so every /api route above takes priority.
_DIST = Path(os.environ.get("FIELDCAST_FRONTEND", str(ROOT / "frontend" / "dist")))
if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="dashboard")

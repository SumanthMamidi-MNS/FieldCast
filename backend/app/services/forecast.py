"""Block-to-panchayat forecast service.

Where the block-level input comes from, in priority order:

1. **Supplied by the caller** (POST). This is the production path: an agency
   passes its own official block forecast (e.g. IMD's) and gets it downscaled.
2. **Operational forecast** (Open-Meteo, dates from today up to ~2 weeks ahead),
   averaged over the block's grid points to synthesise a block value.
3. **Historical replay** (dates inside the training/evaluation seasons), using the
   recorded block value. This exists for demonstration and audit: it lets anyone
   inspect what the system would have said on a past day.

Every panchayat value is labelled T3: panchayats sit below the ~16 km scale at
which the model was validated, so the output is physically-informed inference and
the interval is inflated accordingly.
"""

from __future__ import annotations

from datetime import date as Date
from datetime import datetime, timedelta
from functools import lru_cache

import geopandas as gpd
import numpy as np
import pandas as pd

from backend.app.schemas import (
    BlockForecastResponse,
    BlockSummary,
    Confidence,
    Differentiation,
    PanchayatForecast,
    PanchayatGeometry,
    Tier,
    VariableForecast,
)
from backend.app.services.advisory import build_advisory
from backend.config import PROCESSED_DIR, TIERS, TRAINING_WINDOW, VARIABLES
from backend.pipeline.geo.terrain import compute_terrain, distance_to_coast_km
from backend.pipeline.models.downscaler import MODEL_VERSION
from backend.pipeline.models.predictor import Predictor, build_target_features
from backend.pipeline.models.reconcile import differentiation_spread
from backend.pipeline.models.uncertainty import support_label, support_level

# Spread below which a variable is not considered meaningfully differentiated,
# in the variable's own units. Roughly the measurement resolution of each.
_MEANINGFUL_SPREAD = {"precip": 1.0, "tmax": 0.3, "tmin": 0.3, "humidity": 2.0, "wind": 1.0}

# Support multiplier outside the monsoon season the models were trained on.
_OUT_OF_SEASON_SUPPORT = 0.5


def _trained_months() -> set[int]:
    """Calendar months covered by at least one training season."""
    months: set[int] = set()
    for s in TRAINING_WINDOW.train_seasons:
        for d in pd.date_range(s.start, s.end, freq="MS"):
            months.add(d.month)
        months.add(pd.Timestamp(s.start).month)
    return months


class ForecastError(Exception):
    """Raised for requests that cannot be served; carries an HTTP status."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# --------------------------------------------------------------------------
# Cached static data
# --------------------------------------------------------------------------
@lru_cache(maxsize=4)
def get_predictor(region_key: str) -> Predictor:
    return Predictor.load(region_key)


@lru_cache(maxsize=4)
def get_blocks(region_key: str) -> gpd.GeoDataFrame:
    return gpd.read_parquet(PROCESSED_DIR / f"blocks_{region_key}.parquet")


@lru_cache(maxsize=4)
def get_panchayats(region_key: str) -> gpd.GeoDataFrame:
    return gpd.read_parquet(PROCESSED_DIR / f"panchayats_{region_key}.parquet")


@lru_cache(maxsize=4)
def _history(region_key: str, key: str) -> pd.DataFrame | None:
    path = PROCESSED_DIR / f"features_{region_key}_{key}.parquet"
    if not path.exists():
        return None
    df = pd.read_parquet(path, columns=["block_id", "date", "block_value"])
    df = df.groupby(["block_id", "date"])["block_value"].first().reset_index()
    df["date"] = pd.to_datetime(df["date"]).dt.date
    return df


def list_blocks(region_key: str) -> list[BlockSummary]:
    blocks = get_blocks(region_key)
    pch = get_panchayats(region_key)
    counts = pch.groupby("block_id").size()
    modelled = set(get_predictor(region_key).stats.index)
    out = []
    for _, b in blocks.iterrows():
        n = int(counts.get(b["block_id"], 0))
        if n == 0 or b["block_id"] not in modelled:
            continue
        c = b.geometry.representative_point()
        out.append(
            BlockSummary(
                block_id=b["block_id"],
                block_name=b["block_name"],
                district=b["district"],
                state=b["state"],
                panchayat_count=n,
                centroid_lat=float(c.y),
                centroid_lon=float(c.x),
            )
        )
    return sorted(out, key=lambda s: (s.district, s.block_name))


def _block_row(region_key: str, block_id: str) -> pd.Series:
    blocks = get_blocks(region_key)
    match = blocks[blocks["block_id"] == block_id]
    if match.empty:
        raise ForecastError(f"unknown block {block_id!r}", status=404)
    return match.iloc[0]


def panchayat_geometries(region_key: str, block_id: str) -> list[PanchayatGeometry]:
    _block_row(region_key, block_id)
    pch = get_panchayats(region_key)
    sub = pch[pch["block_id"] == block_id]
    terrain = panchayat_terrain(region_key, block_id)
    out = []
    for _, p in sub.iterrows():
        elev = float(terrain.loc[p["panchayat_id"], "elevation_m"])
        out.append(
            PanchayatGeometry(
                panchayat_id=p["panchayat_id"],
                panchayat_name=str(p["name"]),
                block_id=block_id,
                geometry=gpd.GeoSeries([p.geometry]).__geo_interface__["features"][0]["geometry"],
                centroid_lat=float(p["centroid_lat"]),
                centroid_lon=float(p["centroid_lon"]),
                elevation_m=elev,
                area_km2=float(p["area_km2"]),
            )
        )
    return out


def panchayat_terrain(region_key: str, block_id: str) -> pd.DataFrame:
    """Terrain at panchayat centroids for one block, cached to disk.

    Computed lazily per block: the whole region would cost ~18k elevation lookups,
    most of them for blocks nobody opens. Each block's result is persisted, so the
    cost is paid once.
    """
    cache_dir = PROCESSED_DIR / f"panchayat_terrain_{region_key}"
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{block_id}.parquet"
    if path.exists():
        return pd.read_parquet(path)

    from backend.pipeline.sources.open_meteo import fetch_elevation

    pch = get_panchayats(region_key)
    sub = pch[pch["block_id"] == block_id].reset_index(drop=True)
    if sub.empty:
        raise ForecastError(f"block {block_id!r} has no panchayat units", status=404)

    def sampler(lats, lons):
        return fetch_elevation(list(lats), list(lons))["elevation_m"].to_numpy()

    terr = compute_terrain(sub["centroid_lat"].tolist(), sub["centroid_lon"].tolist(), sampler)
    terr["distance_to_coast_km"] = distance_to_coast_km(
        sub["centroid_lat"].to_numpy(), sub["centroid_lon"].to_numpy()
    )
    terr.index = sub["panchayat_id"]
    terr.to_parquet(path)
    return terr


# --------------------------------------------------------------------------
# Block-level input
# --------------------------------------------------------------------------
def resolve_block_values(
    region_key: str, block_id: str, day: Date
) -> tuple[dict[str, float], str]:
    """Block value per variable for `day`, plus a description of its source."""
    hist = {}
    for key in VARIABLES:
        h = _history(region_key, key)
        if h is None:
            continue
        row = h[(h["block_id"] == block_id) & (h["date"] == day)]
        if not row.empty:
            hist[key] = float(row["block_value"].iloc[0])
    if len(hist) == len(VARIABLES):
        return hist, "historical replay (ERA5 block mean)"

    today = datetime.now().date()
    if not (today - timedelta(days=1) <= day <= today + timedelta(days=15)):
        raise ForecastError(
            f"no block forecast available for {day}: dates must be within the historical "
            f"replay seasons or between yesterday and 15 days ahead, or be supplied by the caller",
            status=422,
        )

    from backend.pipeline.sources.open_meteo import fetch_daily_weather

    grid = get_predictor(region_key).grid
    pts = grid[grid["block_id"] == block_id]
    if pts.empty:
        raise ForecastError(f"block {block_id!r} has no grid points", status=404)
    wx = fetch_daily_weather(
        pts["lat"].tolist(), pts["lon"].tolist(), str(day), str(day), forecast=True
    )
    values = {}
    for key, var in VARIABLES.items():
        v = wx[wx["variable"] == var.open_meteo_daily]["value"].astype(float)
        if v.notna().any():
            values[key] = float(v.mean())
    if not values:
        raise ForecastError("operational forecast returned no values", status=502)
    return values, "operational forecast (Open-Meteo, block mean)"


# --------------------------------------------------------------------------
# Forecast assembly
# --------------------------------------------------------------------------
def block_forecast(
    region_key: str,
    block_id: str,
    day: Date,
    block_values: dict[str, float] | None = None,
) -> BlockForecastResponse:
    block = _block_row(region_key, block_id)
    predictor = get_predictor(region_key)
    if block_id not in predictor.stats.index:
        raise ForecastError(f"block {block_id!r} has no modelled grid points", status=404)

    if block_values:
        unknown = set(block_values) - set(VARIABLES)
        if unknown:
            raise ForecastError(f"unknown variables in block_values: {sorted(unknown)}")
        values, source = dict(block_values), "supplied by caller"
    else:
        values, source = resolve_block_values(region_key, block_id, day)

    pch = get_panchayats(region_key)
    sub = pch[pch["block_id"] == block_id].reset_index(drop=True)
    terrain = panchayat_terrain(region_key, block_id).reindex(sub["panchayat_id"]).reset_index(drop=True)

    targets = pd.concat(
        [
            sub[["panchayat_id", "name", "block_id", "area_km2"]],
            sub[["centroid_lat", "centroid_lon"]].rename(
                columns={"centroid_lat": "lat", "centroid_lon": "lon"}
            ),
            terrain,
        ],
        axis=1,
    )
    in_season = day.month in _trained_months()
    weights = targets["area_km2"].to_numpy(dtype=float)

    per_var: dict[str, dict] = {}
    for key, bv in values.items():
        if key not in predictor.models:
            continue
        feats = build_target_features(
            targets, predictor.stats, np.full(len(targets), bv), pd.Series([day] * len(targets))
        )
        res = predictor.predict_variable(key, feats, Tier.T3, weights=weights, reconcile_to=bv)
        if not in_season:
            res["support_score"] = res["support_score"] * _OUT_OF_SEASON_SUPPORT
        res["block_value"] = bv
        per_var[key] = res

    tier_note = TIERS["T3"] + ("" if in_season else
                               " Outside the months the model was trained on.")
    panchayats: list[PanchayatForecast] = []
    for i, row in targets.iterrows():
        variables: dict[str, VariableForecast] = {}
        for key, res in per_var.items():
            var = VARIABLES[key]
            score = float(np.clip(res["support_score"][i], 0.0, 1.0))
            level = support_level(score)
            gauge = float(res["nearest_gauge_km"][i])
            value = float(res["median"][i])
            occ = res["occurrence"]
            variables[key] = VariableForecast(
                variable=key,
                label=var.label,
                unit=var.unit,
                value=round(value, 2),
                block_value=round(res["block_value"], 2),
                anomaly=round(value - res["block_value"], 2),
                confidence=Confidence(
                    lower=round(float(min(res["lower"][i], value)), 2),
                    upper=round(float(max(res["upper"][i], value)), 2),
                    support=level,
                    support_label=support_label(level),
                    support_score=round(score, 3),
                    tier=Tier.T3,
                    tier_note=tier_note,
                    nearest_gauge_km=round(gauge, 1) if np.isfinite(gauge) else None,
                ),
                rain_probability=(round(float(occ[i]), 3) if occ is not None else None),
            )
        panchayats.append(
            PanchayatForecast(
                panchayat_id=row["panchayat_id"],
                panchayat_name=str(row["name"]),
                block_id=block_id,
                block_name=block["block_name"],
                latitude=float(row["lat"]),
                longitude=float(row["lon"]),
                elevation_m=float(row["elevation_m"]),
                area_km2=round(float(row["area_km2"]), 2),
                date=day,
                variables=variables,
                advisory=build_advisory(variables),
            )
        )

    spread = {k: round(differentiation_spread(r["median"]), 3) for k, r in per_var.items()}
    meaningful_vars = [k for k, s in spread.items() if s >= _MEANINGFUL_SPREAD.get(k, 0.0)]
    note = (
        f"Differentiated beyond measurement resolution for: {', '.join(meaningful_vars)}."
        if meaningful_vars
        else "Panchayat values are nearly identical to the block value for this day; "
        "local terrain adds little information here, and we say so rather than implying precision."
    )
    note += f" Block input: {source}."

    return BlockForecastResponse(
        block_id=block_id,
        block_name=block["block_name"],
        district=block["district"],
        state=block["state"],
        date=day,
        panchayat_count=len(panchayats),
        panchayats=panchayats,
        differentiation=Differentiation(
            variable_spread=spread, meaningful=bool(meaningful_vars), note=note
        ),
        model_version=MODEL_VERSION,
        generated_at=datetime.now().isoformat(timespec="seconds"),
    )

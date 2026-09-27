"""The deployed forecast engine: serving bundle in, forecast JSON out.

Imports only numpy, httpx and pydantic (through the schemas), so it runs as a
small Vercel function. Where the block-level input comes from, in priority order:

1. **Supplied by the caller** (POST): an agency's official block forecast, e.g.
   an IMD bulletin. This is the production path.
2. **Historical replay** for dates in the bundled seasons: the recorded block
   value, so anyone can audit what the system would have said on a past day.
3. **Operational forecast** (Open-Meteo), yesterday to +15 days, averaged over
   the block's grid points.

Every panchayat value is labelled T3: panchayats sit below the scale at which the
model was validated, so the output is physically-informed inference with a
gauge-calibrated interval.
"""

from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass
from datetime import date as Date
from datetime import datetime, timedelta
from functools import cached_property, lru_cache
from pathlib import Path

import httpx
import numpy as np

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
from backend.config import SERVE_DIR, TIERS, VARIABLES
from backend.pipeline.models.finalize import finalize_variable
from backend.pipeline.models.numerics import (
    TERRAIN_COLUMNS,
    feature_matrix,
    invert_target,
    sort_quantiles,
    target_feature_columns,
)
from backend.pipeline.models.reconcile import differentiation_spread
from backend.pipeline.models.uncertainty import SupportModel, support_label, support_level
from backend.serve.trees import TreeEnsemble

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
_LIVE_TTL_S = 30 * 60
_LIVE_PAST_DAYS = 1
_LIVE_AHEAD_DAYS = 15

# Spread below which a variable is not called differentiated, in its own units.
_MEANINGFUL_SPREAD = {"precip": 1.0, "tmax": 0.3, "tmin": 0.3, "humidity": 2.0, "wind": 1.0}
_OUT_OF_SEASON_SUPPORT = 0.5


class ForecastError(Exception):
    """A request that cannot be served; carries the HTTP status to return."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass
class _VariableModel:
    key: str
    reconcile: str
    feature_columns: list[str]
    quantiles: dict[float, TreeEnsemble]
    occurrence: TreeEnsemble | None
    cal_x: np.ndarray | None
    cal_y: np.ndarray | None
    scale_factor: float | None
    point_is_block: bool = False

    def predict(self, x: np.ndarray, block_value: np.ndarray) -> tuple[dict, np.ndarray | None]:
        q = {
            level: invert_target(ens.predict(x), block_value, self.reconcile)
            for level, ens in self.quantiles.items()
        }
        q = sort_quantiles(q)
        occ = None
        if self.occurrence is not None:
            raw = self.occurrence.predict(x)
            # Isotonic calibration is a clipped piecewise-linear map: np.interp
            # reproduces sklearn's IsotonicRegression.predict exactly.
            occ = np.interp(raw, self.cal_x, self.cal_y) if self.cal_x is not None else raw
            occ = np.clip(occ, 0.0, 1.0)
        return q, occ


class RegionRuntime:
    """One region's bundle, loaded lazily and kept in memory for warm requests."""

    def __init__(self, root: Path):
        self.root = root
        if not (root / "manifest.json").exists():
            raise ForecastError(f"region bundle not found at {root.name}", status=404)
        self.manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
        self.key = self.manifest["region"]
        self._live_cache: dict[tuple[str, str], tuple[float, dict[str, float]]] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    @cached_property
    def models(self) -> dict[str, _VariableModel]:
        arrays = np.load(self.root / "models.npz")
        out = {}
        for key, meta in self.manifest["variables"].items():
            out[key] = _VariableModel(
                key=key,
                reconcile=meta["reconcile"],
                feature_columns=meta["feature_columns"],
                quantiles={
                    float(q): TreeEnsemble.from_arrays(arrays, f"{key}/q{q}")
                    for q in meta["quantiles"]
                },
                occurrence=TreeEnsemble.from_arrays(arrays, f"{key}/occ")
                if meta["occurrence"]
                else None,
                cal_x=np.asarray(arrays[f"{key}/cal_x"]) if meta["calibrated_occurrence"] else None,
                cal_y=np.asarray(arrays[f"{key}/cal_y"]) if meta["calibrated_occurrence"] else None,
                scale_factor=meta["scale_factor"],
                point_is_block=bool(meta.get("point_is_block", False)),
            )
        return out

    @cached_property
    def support(self) -> SupportModel | None:
        s = self.manifest.get("support")
        if not s:
            return None
        gauges = np.asarray(s["gauges"], dtype=float) if s["gauges"] else None
        return SupportModel(
            mean=np.asarray(s["mean"], dtype=float),
            inv_cov=np.asarray(s["inv_cov"], dtype=float),
            columns=list(s["columns"]),
            gauge_coords=gauges,
        )

    @cached_property
    def blocks(self) -> dict[str, dict]:
        rows = json.loads((self.root / "blocks.json").read_text(encoding="utf-8"))
        return {r["block_id"]: r for r in rows}

    def _block(self, block_id: str) -> dict:
        b = self.blocks.get(block_id)
        if b is None:
            raise ForecastError(f"unknown block {block_id!r}", status=404)
        return b

    @lru_cache(maxsize=256)  # noqa: B019 - one runtime per region, lives for the process
    def _panchayats(self, block_id: str) -> dict:
        self._block(block_id)
        path = self.root / "panchayats" / f"{block_id}.json"
        return json.loads(path.read_text(encoding="utf-8"))

    @lru_cache(maxsize=256)  # noqa: B019
    def _history(self, block_id: str) -> dict:
        path = self.root / "history" / f"{block_id}.json"
        if not path.exists():
            return {"dates": [], "values": {}}
        h = json.loads(path.read_text(encoding="utf-8"))
        h["index"] = {d: i for i, d in enumerate(h["dates"])}
        return h

    @cached_property
    def replay_windows(self) -> list[tuple[str, str]]:
        """Contiguous date ranges with recorded block values, from the bundle.

        Read from the data rather than configured, so the dashboard offers
        exactly the dates the API can replay.
        """
        dates: set[str] = set()
        for path in (self.root / "history").glob("*.json"):
            dates.update(json.loads(path.read_text(encoding="utf-8"))["dates"])
            break  # every block shares the same dates
        ordered = sorted(Date.fromisoformat(d) for d in dates)
        windows: list[tuple[str, str]] = []
        for d in ordered:
            if windows and (d - Date.fromisoformat(windows[-1][1])).days == 1:
                windows[-1] = (windows[-1][0], d.isoformat())
            else:
                windows.append((d.isoformat(), d.isoformat()))
        return windows

    # ------------------------------------------------------------------
    def list_blocks(self) -> list[BlockSummary]:
        out = [
            BlockSummary(
                block_id=b["block_id"],
                block_name=b["block_name"],
                district=b["district"],
                state=b["state"],
                panchayat_count=b["panchayat_count"],
                centroid_lat=b["centroid_lat"],
                centroid_lon=b["centroid_lon"],
            )
            for b in self.blocks.values()
        ]
        return sorted(out, key=lambda s: (s.district, s.block_name))

    def panchayat_geometries(self, block_id: str) -> list[PanchayatGeometry]:
        fc = self._panchayats(block_id)
        return [
            PanchayatGeometry(
                panchayat_id=f["properties"]["panchayat_id"],
                panchayat_name=f["properties"]["name"],
                unit_type=f["properties"].get("unit_type", "village_cluster"),
                block_id=block_id,
                geometry=f["geometry"],
                centroid_lat=f["properties"]["centroid_lat"],
                centroid_lon=f["properties"]["centroid_lon"],
                elevation_m=f["properties"]["terrain"]["elevation_m"],
                area_km2=f["properties"]["area_km2"],
            )
            for f in fc["features"]
        ]

    # ------------------------------------------------------------------
    def resolve_block_values(self, block_id: str, day: Date) -> tuple[dict[str, float], str]:
        h = self._history(block_id)
        i = h["index"].get(day.isoformat())
        if i is not None:
            values = {
                k: float(v[i]) for k, v in h["values"].items() if v[i] is not None
            }
            if len(values) == len(VARIABLES):
                return values, "historical replay (ERA5 block mean)"

        today = datetime.now().date()
        if not (today - timedelta(days=_LIVE_PAST_DAYS) <= day <= today + timedelta(days=_LIVE_AHEAD_DAYS)):
            lo, hi = self.manifest.get("history_range", ["", ""])
            raise ForecastError(
                f"No block forecast is available for {day}. Choose a date in the replay "
                f"record ({lo} to {hi}), or from yesterday up to {_LIVE_AHEAD_DAYS} days ahead, "
                "or enter an official block forecast.",
                status=422,
            )
        return self._live_block_values(block_id, day), "operational forecast (Open-Meteo, block mean)"

    def _live_block_values(self, block_id: str, day: Date) -> dict[str, float]:
        if os.environ.get("DOWNSCALE_OFFLINE") == "1":
            raise ForecastError(
                "Live forecasts need network access and the server is in offline mode. "
                "Use a replay date or enter an official block forecast.",
                status=503,
            )
        cache_key = (block_id, day.isoformat())
        with self._lock:
            hit = self._live_cache.get(cache_key)
            if hit and time.time() - hit[0] < _LIVE_TTL_S:
                return hit[1]

        grid = self._block(block_id)["grid"]
        params = {
            "latitude": ",".join(f"{p[0]:.5f}" for p in grid),
            "longitude": ",".join(f"{p[1]:.5f}" for p in grid),
            "daily": ",".join(v.open_meteo_daily for v in VARIABLES.values()),
            "timezone": "UTC",
            "start_date": day.isoformat(),
            "end_date": day.isoformat(),
        }
        try:
            resp = httpx.get(FORECAST_URL, params=params, timeout=20)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise ForecastError(f"live forecast service unavailable: {exc}", status=502) from exc
        payload = resp.json()
        points = payload if isinstance(payload, list) else [payload]

        values = {}
        for key, var in VARIABLES.items():
            vals = [
                p.get("daily", {}).get(var.open_meteo_daily, [None])[0] for p in points
            ]
            vals = [float(v) for v in vals if v is not None]
            if vals:
                values[key] = float(np.mean(vals))
        if not values:
            raise ForecastError("live forecast returned no values", status=502)
        with self._lock:
            self._live_cache[cache_key] = (time.time(), values)
        return values

    # ------------------------------------------------------------------
    def predict_variable(
        self,
        key: str,
        terrain: dict[str, np.ndarray],
        stats: dict[str, float],
        block_value: float,
        day: Date,
        lats: np.ndarray,
        lons: np.ndarray,
        weights: np.ndarray,
        tier: Tier = Tier.T3,
        reconcile_to: float | None = None,
    ) -> dict:
        n = lats.size
        model = self.models[key]
        cols = target_feature_columns(
            terrain,
            np.full(n, stats["mean_elevation_m"]),
            np.full(n, stats["elevation_spread_m"]),
            np.full(n, stats["mean_exposure"]),
            np.full(n, block_value),
            np.full(n, day.timetuple().tm_yday),
            np.full(n, day.month),
        )
        x = feature_matrix(cols, model.feature_columns)
        quantiles, occurrence = model.predict(x, np.full(n, block_value))
        support_features = (
            feature_matrix(cols, self.support.columns) if self.support is not None else None
        )
        return finalize_variable(
            quantiles=quantiles,
            occurrence=occurrence,
            reconcile_mode=model.reconcile,
            support_features=support_features,
            support=self.support,
            lats=lats,
            lons=lons,
            tier=tier,
            weights=weights,
            reconcile_to=reconcile_to,
            scale_factor=model.scale_factor,
            point_is_block=model.point_is_block,
            block_value=np.full(n, block_value),
        )

    def forecast(
        self, block_id: str, day: Date, block_values: dict[str, float] | None = None
    ) -> BlockForecastResponse:
        block = self._block(block_id)
        if block_values:
            unknown = set(block_values) - set(VARIABLES)
            if unknown:
                raise ForecastError(f"unknown variables in block_values: {sorted(unknown)}")
            values, source = dict(block_values), "supplied by caller"
        else:
            values, source = self.resolve_block_values(block_id, day)

        feats = self._panchayats(block_id)["features"]
        props = [f["properties"] for f in feats]
        lats = np.array([p["centroid_lat"] for p in props], dtype=float)
        lons = np.array([p["centroid_lon"] for p in props], dtype=float)
        weights = np.array([p["area_km2"] for p in props], dtype=float)
        terrain = {c: np.array([p["terrain"][c] for p in props], dtype=float) for c in TERRAIN_COLUMNS}

        in_season = day.month in set(self.manifest.get("trained_months", range(1, 13)))
        per_var: dict[str, dict] = {}
        for key, bv in values.items():
            if key not in self.models:
                continue
            res = self.predict_variable(
                key, terrain, block["stats"], bv, day, lats, lons, weights, reconcile_to=bv
            )
            if not in_season:
                res["support_score"] = res["support_score"] * _OUT_OF_SEASON_SUPPORT
            res["block_value"] = bv
            per_var[key] = res

        tier_note = TIERS["T3"] + (
            "" if in_season else " Outside the months the model was trained on."
        )
        panchayats: list[PanchayatForecast] = []
        for i, p in enumerate(props):
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
                    rain_probability=round(float(occ[i]), 3) if occ is not None else None,
                    value_source="block" if self.models[key].point_is_block else "model",
                )
            panchayats.append(
                PanchayatForecast(
                    panchayat_id=p["panchayat_id"],
                    panchayat_name=p["name"],
                    unit_type=p.get("unit_type", "village_cluster"),
                    block_id=block_id,
                    block_name=block["block_name"],
                    latitude=p["centroid_lat"],
                    longitude=p["centroid_lon"],
                    elevation_m=p["terrain"]["elevation_m"],
                    area_km2=p["area_km2"],
                    date=day,
                    variables=variables,
                    advisory=build_advisory(variables),
                )
            )

        spread = {k: round(differentiation_spread(r["median"]), 3) for k, r in per_var.items()}
        meaningful = [k for k, s in spread.items() if s >= _MEANINGFUL_SPREAD.get(k, 0.0)]
        note = (
            f"Differentiated beyond measurement resolution for: {', '.join(meaningful)}."
            if meaningful
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
                variable_spread=spread, meaningful=bool(meaningful), note=note
            ),
            model_version=self.manifest["model_version"],
            generated_at=datetime.now().isoformat(timespec="seconds"),
        )


# --------------------------------------------------------------------------
_RUNTIMES: dict[str, RegionRuntime] = {}
_RUNTIMES_LOCK = threading.Lock()


def bundle_root() -> Path:
    return Path(os.environ.get("FIELDCAST_BUNDLE", str(SERVE_DIR)))


def get_runtime(region_key: str) -> RegionRuntime:
    with _RUNTIMES_LOCK:
        rt = _RUNTIMES.get(region_key)
        if rt is None:
            rt = RegionRuntime(bundle_root() / region_key)
            _RUNTIMES[region_key] = rt
        return rt


def served_regions() -> list[str]:
    root = bundle_root()
    if not root.exists():
        return []
    return sorted(p.name for p in root.iterdir() if (p / "manifest.json").exists())


def evaluation_reports() -> dict[str, dict]:
    out = {}
    for path in sorted((bundle_root() / "reports").glob("evaluation_*.json")):
        out[path.stem] = json.loads(path.read_text(encoding="utf-8"))
    return out

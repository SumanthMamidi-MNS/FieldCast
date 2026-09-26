# Architecture — Panchayat-Level Weather Downscaling (SIH26074)

> Living document: describes the system **as currently built**. The PRD holds only
> the official problem statement; the requirements below are our derivation from it.

---

## 0. Problem framing (derived from the problem statement)

**Statement:** downscale weather forecasts from block level to panchayat level —
infer high-resolution information from low-resolution variables — for
agro-meteorological advisory services.

**The core design tension.** Standard downscaling (interpolation, image
super-resolution) assumes the fine-scale field is a *smooth* function of the coarse
one. That is false for rainfall, which is spatially discontinuous: across the
Western Ghats, one slope gets a downpour while the leeward side a few km away stays
dry. A second hard fact: panchayat-scale ground truth barely exists.

**Derived requirements / success criteria** (referenced from code as "success criteria"):

1. **Differentiated output** — panchayats in one block get different values that
   track real terrain, not a copy of the block value.
2. **Beat the naive baseline** — where ground truth exists, be closer to it than
   "copy the block value". This comparison is the project's actual proof.
3. **Explicit uncertainty** — every value carries an interval and a support label;
   a confident wrong number drives a real, costly farming decision.
4. **Usable by an extension officer** — plain-language advisories, not just numbers.
5. **Honesty about evidence** — state where results are validated and where they
   are inference.

**Three-tier honesty architecture.** Every output declares its tier; uncertainty
widens down the tiers.

| Tier | Step | Ground truth | Status |
|---|---|---|---|
| **T1** | Block (~30–40 km) → fine grid (~16 km spacing, ERA5 blend) | Dense reanalysis | **Measured** on a held-out season |
| **T2** | → real gauge point | 9 quality-screened GHCN gauges | **Measured** where gauges exist |
| **T3** | → panchayat polygon (~35–50 km², ~24 per block) | None | **Inference**; point-scale interval factor (fitted at gauges), support capped at moderate |

---

## 1. Tech stack

- **Backend:** Python 3.12, FastAPI + Uvicorn, Pydantic v2
- **ML:** LightGBM (quantile + binary), scikit-learn (isotonic calibration), SciPy
- **Geo/data:** GeoPandas, Shapely, pyproj, pandas, PyArrow (GeoParquet)
- **HTTP:** httpx + tenacity, with a disk cache and an offline mode
- **Frontend:** React 18 + Vite + TypeScript (strict) + MapLibre GL + Recharts
- **Quality:** pytest + ruff (backend), vitest + eslint (frontend)

Why LightGBM over neural super-resolution: see `decisions.md`.

---

## 2. Data sources (all public, keyless)

| Source | Used for | Notes |
|---|---|---|
| Open-Meteo archive (`best_match` ERA5 blend) | fine field + training target | `era5_land` returns null rainfall via this API; the blend varies at ~9 km |
| Open-Meteo forecast | live block input | block value = mean over the block's grid points |
| Open-Meteo elevation | 9-point terrain stencil | lazily per block for panchayats |
| GADM 4.1 India L3 | **blocks** | 86 blocks across 7 MH districts |
| datameet village polygons | **panchayat proxies** | 11,740 villages → 1,955 units (KMeans ~6 villages each, deterministic) |
| GHCN-Daily (NOAA) | **T2 ground truth** | 185 stations in bbox, 9 pass the record-quality screen |

**Free-tier budget constraint** (the reason for the training window below):
Open-Meteo counts every location × fortnight as one call, against 600/min,
5,000/hour and 10,000/day. The adapter paces requests to ~85% of the hourly limit;
a minutely 429 waits and retries, while an hourly or daily cap raises
`ApiBudgetExceeded`. Everything is cached, so a re-run resumes.

---

## 3. Model

- **Residual formulation:** predict the anomaly vs the block value. Additive for
  temperature/humidity; log-ratio `log1p(local) − log1p(block)` for rain and wind.
  A model that learns nothing degrades exactly to the naive baseline.
- **Two-stage rainfall:** occurrence = IMD rainy day (>=2.5 mm); isotonic-calibrated classifier plus
  conditional-amount quantile models trained on wet days only. The mixture's
  quantiles are zero below the dry probability (an approximation, since only three
  conditional levels are fitted).
- **Quantiles** τ = 0.1 / 0.5 / 0.9, with crossing repaired by sorting.
- **Features (17):** elevation, slope, monsoon exposure (cos(aspect − 245°) ×
  sin(slope)), TRI, detrended roughness, local relief, distance to coast; block
  value, elevation anomaly, block mean/spread of elevation, exposure anomaly, block
  mean exposure, lapse-rate prior, day-of-year harmonics, monsoon flag.
- **Epistemic support:** 0.6 × terrain similarity (chi-square-scaled Mahalanobis
  distance to the training manifold) + 0.4 × gauge proximity (decays to 0 at 50 km)
  − a tier penalty; T3 is capped at "moderate". Low support widens the interval
  up to 2× around the median.
- **Point-scale interval factor:** per variable, fitted on 2022 gauge-days so the
  80% interval covers ~80% of gauge observations; applied to T2/T3 output and
  evaluated on 2023 (humidity and wind have no gauges and keep the fixed ×1.35).
- **Reconciliation:** area-weighted panchayat values re-aggregate to the block
  value (for rain: the expectation sum of P(wet) x amount, not the median). One median-derived adjustment is applied to all quantiles, so the
  interval is not collapsed.

**Training design.** Train on the dense field (perfect-prognosis coarsening: the
block value is the mean of the grid points inside the block); validate on gauges
never seen in training.
**Holdouts:** whole blocks (SHA-256 hash, 20%) for validation; the whole 2023
season for test; a date-level leakage assertion with a 3-day embargo runs before
every fit.
**Window:** monsoon seasons (Jun–Sep) 2022 (train) and 2023 (test), on a 0.15° grid
(305 points, ~3.5 per block). Out-of-season requests are served with support
halved and a tier-note disclosure.

---

## 4. Baselines

| | Baseline | Where |
|---|---|---|
| B0 | naive block copy — *the bar* | T1, T2 |
| B1 | IDW of block values placed at block centroids | T1 |
| B2 | lapse-rate correction (−6.5 °C/km) | T1, T2 (temperature) |

A bilinear regrid (B3) is implemented but not reported: blocks are irregular
polygons, not a regular coarse grid, so IDW is the appropriate interpolation
baseline. Metrics: MAE/RMSE, skill vs each baseline with a 90% cluster-bootstrap
CI, 80%-interval coverage, PIT-KS, Brier score (vs climatology and vs the naive
block wet/dry call).

---

## 5. Folder structure

```
backend/
  config.py                 regions, variables, constants, training window
  app/                      main.py (FastAPI), schemas.py, services/{forecast,advisory}.py
  pipeline/
    sources/                cache.py, open_meteo.py, ghcn.py
    geo/                    boundaries.py, panchayats.py, terrain.py
    features/build.py       feature table, splits, leakage assertion
    models/                 downscaler.py, predictor.py, reconcile.py, uncertainty.py
    evaluate/               baselines.py, metrics.py, run.py
    build_base.py, train.py CLIs
  tests/
frontend/                   Vite + React dashboard (src/api, components, lib, types)
data/{raw,cache,processed}  gitignored, regenerated by the pipeline
models/artifacts/<region>/  per-variable boosters, calibrator, support.npz, summary.json
reports/                    evaluation_<region>.{json,md}, run logs
```

---

## 6. Data flow

**Offline:** `build_base` (blocks → panchayats → screened stations) →
`train` (grid → terrain → ERA5 seasons → per-variable tables → split → fit →
artifacts) → `evaluate.run` (T1 + T2 report).

**Online:** `GET /api/blocks/{id}/forecast?date=` resolves the block value
(historical replay, or the operational forecast for yesterday to +15 days);
`POST` takes an officer-supplied official block forecast instead. Panchayat
terrain (cached per block) → `Predictor` (the same code path as the gauge
evaluation) → reconcile → support → advisory → JSON. Other endpoints:
`/api/health`, `/api/blocks`, `/api/blocks/{id}/panchayats`, `/api/evaluation`.

---

## 7. Deployment

Local: `uvicorn backend.app.main:app --port 8000` and `npm run dev` (Vite proxies
`/api`). After one warm run, `DOWNSCALE_OFFLINE=1` serves entirely from cache.

---

## 8. Known limitations

1. T3 panchayat values are not validated at panchayat scale; no such truth exists.
2. Village clusters approximate panchayats; they are not official boundaries.
3. The target is a reanalysis (ERA5 blend), not an IMD operational product.
4. Only 9 recent GHCN gauges, so T2 results carry wide CIs.
5. Trained on the 2022 monsoon only (API budget).
7. **The "no worse than naive" guarantee holds only in the training region.** On
   Karnataka, MH-trained rainfall-amount output was 18-25% worse than naive while
   occurrence and temperature transferred; the API serves only regions with
   their own models.
8. At point gauges, temperature skill is matched or beaten by a plain lapse-rate
   correction (4 gauges; not significance-testable).
6. The distance-to-coast covariate uses a west-coast longitude table (valid for
   the peninsular west coast only).

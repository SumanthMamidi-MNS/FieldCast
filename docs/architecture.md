# Architecture — FieldCast (SIH26074)

> Living document: describes the system **as currently built**. The PRD holds only
> the official problem statement; the requirements below are our derivation from it.

---

## 0. Problem framing (derived from the problem statement)

**Statement:** downscale weather forecasts from block level to panchayat level —
infer high-resolution information from low-resolution variables — for
agro-meteorological advisory services.

**The core design tension.** Standard downscaling (interpolation, image
super-resolution) assumes the fine field is a *smooth* function of the coarse one.
That is false for rainfall, which is spatially discontinuous: across the Western
Ghats one slope gets a downpour while the leeward side a few km away stays dry.
And panchayat-scale ground truth barely exists.

**Derived requirements / success criteria** (referenced from code as "success criteria"):

1. **Differentiated output** — panchayats in one block get different values that
   track real terrain, not a copy of the block value.
2. **Beat the naive baseline** — where ground truth exists, be closer to it than
   "copy the block value". This comparison is the project's actual proof.
3. **Explicit uncertainty** — every value carries an interval and a support label.
4. **Usable by an extension officer** — plain-language advisories, not just numbers.
5. **Honesty about evidence** — state where results are validated and where they
   are inference.

**Three-tier honesty architecture.** Every output declares its tier.

| Tier | Step | Ground truth | Status |
|---|---|---|---|
| **T1** | Block → ~16 km grid (ERA5 blend) | Dense reanalysis | **Measured** on held-out seasons |
| **T2** | → real gauge point | GHCN: 4 modern gauges + ~100 per state in 1960 | **Measured** |
| **T3** | → panchayat polygon (~35–50 km²) | None | **Inference**; gauge-calibrated interval, support capped at moderate |

---

## 1. Two halves: offline pipeline, online serving

```
          OFFLINE (local machine, full stack)                ONLINE (Vercel, numpy only)
 GADM · datameet · LGD* · GHCN · Open-Meteo · DEM tiles
        │
 build_base ─► blocks, panchayat units, gauge index
 fetch ──────► ERA5 weather history (resumable, quota-paced)
 train ──────► per-variable LightGBM models + support model
 evaluate ───► reports (T1, T2, T2 historical, transfer)            FastAPI app (backend.app.main)
 export ─────► serve_bundle/  ──── committed to git ─────────►  reads bundle, numpy tree evaluator
                                                                 + dashboard (CDN-promoted mount)
```
\* LGD is used when a CAPTCHA-protected export has been placed in `data/raw/lgd/`.

The serving path shares every post-model computation with the pipeline
(`models/numerics.py`, `models/finalize.py`, `reconcile.py`, `uncertainty.py`, all
numpy-only) and a parity test requires the runtime to reproduce the pipeline
predictor's output exactly.

---

## 2. Tech stack

- **Runtime (deployed):** Python 3.12, FastAPI, pydantic v2, httpx, numpy (~83 MB installed)
- **Pipeline (local, `pip install -e ".[pipeline]"`):** pandas, PyArrow, GeoPandas,
  Shapely, pyproj, LightGBM, scikit-learn, SciPy, Pillow, typer, rich
- **Frontend:** React 18 + Vite + TypeScript (strict) + MapLibre GL + Recharts
- **Quality:** pytest + ruff (backend), vitest + eslint (frontend)
- **Deployment:** Vercel FastAPI preset (`[tool.vercel] entrypoint`), no Docker

---

## 3. Data sources (all public, keyless)

| Source | Used for | Notes |
|---|---|---|
| Open-Meteo archive (`best_match` ERA5 blend) | fine field, training target, replay | free tier 600/min, 5k/h, 10k/day; `pipeline.fetch` paces and resumes |
| Open-Meteo forecast | live block input (yesterday … +15 days) | called by the deployed API, cached 30 min |
| AWS Terrain Tiles (terrarium, z11) | all terrain | keyless, no quota; validated r=0.9985 vs previous DEM |
| Natural Earth 10 m coastline | distance to coast | |
| GADM 4.1 L3 | **blocks** | MH 86, KA 48 |
| datameet village polygons | **panchayat units** | MH 11,740 villages → 1,955 units |
| LGD village→gram-panchayat mapping | **real gram panchayats** | behind a CAPTCHA: manual download; clusters otherwise |
| GHCN-Daily (NOAA) | **T2 ground truth** | modern: 9 MH / 8 KA screened; historical 1956-61: ~95-100 per state |

---

## 4. Model

- **Residual formulation:** predict the anomaly vs the block value (additive for
  temperature/humidity; log-ratio for rain and wind). Learning nothing degrades
  exactly to the naive baseline.
- **Two-stage rainfall:** occurrence = IMD rainy day (≥2.5 mm), isotonic-calibrated
  classifier; conditional-amount quantiles trained on wet days; mixture quantiles.
- **Quantiles** τ = 0.1 / 0.5 / 0.9, crossing repaired by sorting.
- **Features (20):** elevation, slope, monsoon exposure (cos(aspect − 245°) ×
  sin(slope)), TRI, detrended roughness, local relief, distance to coast,
  **upwind barrier, downwind rise, upwind max elevation** (terrain profile along the
  monsoon flow line: the rain-shadow mechanism); block value, elevation anomaly,
  block mean/spread of elevation, exposure anomaly, block mean exposure, lapse-rate
  prior, day-of-year harmonics, monsoon flag.
- **Epistemic support:** 0.6 × chi-square-scaled Mahalanobis similarity to the
  training terrain + 0.4 × gauge proximity (0 at 50 km) − tier penalty; T3 capped
  at "moderate". Low support widens the interval up to 2×.
- **Point-scale interval factor:** per gauge-validated variable, fitted on the
  1958 historical gauge season so the 80% interval covers ~80% of gauge
  observations; applied to T2/T3. Humidity and wind (no gauges) keep ×1.35.
- **Reconciliation:** area-weighted panchayat values re-aggregate to the block
  value; rain is reconciled in expectation (Σ P(wet) × amount), not by median.

**Training and holdouts.** Seasons, not years: monsoons 2019-2022 and the
2021-22 dry season train; the 2022-23 dry season and 2023 monsoon are test
periods (5-day gap from the last training day ≥ 3-day embargo). Whole blocks (20%,
SHA-256 hash) are held out for validation. A date-level leakage assertion runs
before every fit; config tests guard that gauge seasons never overlap training.

---

## 5. Baselines and metrics

B0 naive block copy (the bar), B1 IDW of block values, B2 lapse-rate correction
(temperature). Metrics: MAE/RMSE; skill vs each baseline with a 90% cluster
bootstrap CI (blocks at T1, gauges at T2); no "significant" verdict below 8
gauges; 80%-interval coverage; PIT-KS; Brier score vs climatology and vs the naive
block wet/dry call; the served (post-reconciliation) skill.

---

## 6. Serving

- **Bundle** (`serve_bundle/<region>/`): `manifest.json` (per-variable feature
  order, calibration, support model, trained months), `models.npz` (flattened
  trees + isotonic thresholds), `blocks.json` (block stats + grid points; small
  blocks borrow their 3 nearest points), `panchayats/<block>.json` (GeoJSON
  simplified to ~30 m + precomputed terrain), `history/<block>.json` (replay).
  `serve_bundle/reports/` holds the evaluation reports.
- **Runtime** (`backend/serve/runtime.py`): numpy tree evaluation, isotonic via
  `np.interp`, shared finalize step, advisory generation.
- **Block input priority:** officer-supplied official bulletin (POST) → historical
  replay → live Open-Meteo forecast.
- **API:** `/api/health`, `/api/regions`, `/api/blocks`,
  `/api/blocks/{id}/panchayats`, `/api/blocks/{id}/forecast` (GET/POST),
  `/api/evaluation`, `/api/evaluation/reports`. A region is served only if its own
  bundle exists (rain amounts do not transfer across regions).

---

## 7. Folder structure

```
backend/
  config.py            regions, variables, seasons, constants, MODEL_VERSION
  app/                 main.py (FastAPI + dashboard mount), schemas.py, services/advisory.py
  serve/               trees.py (numpy trees), runtime.py (serving), export.py (bundle writer)
  pipeline/
    sources/           cache, open_meteo, ghcn, dem
    geo/               boundaries, panchayats, gram_panchayats (LGD), terrain, coast
    features/build.py  feature tables, splits, leakage assertion
    models/            downscaler (LightGBM), predictor, numerics, finalize, reconcile, uncertainty
    evaluate/          baselines, metrics, run
    build_base.py, fetch.py, train.py
  tests/
frontend/              FieldCast dashboard (Vite + React + MapLibre)
serve_bundle/          committed serving bundle (what production reads)
reports/               evaluation reports (md + json)
data/, models/         local pipeline data and artefacts (gitignored)
vercel.json, .vercelignore, .python-version
```

---

## 8. Deployment

`vercel.json` builds the dashboard (`cd frontend && npm ci && npm run build`); the
FastAPI preset installs the runtime dependencies from `pyproject.toml` and loads
`backend.app.main:app`, whose StaticFiles mount of `frontend/dist` is promoted to
the CDN. `.vercelignore` keeps pipeline data out of uploads. Locally, one
`uvicorn` process serves both the API and the built dashboard, and works offline
for replay dates and officer-supplied bulletins.

---

## 9. Known limitations

1. T3 panchayat values are inference: no panchayat-scale truth exists.
2. Real gram-panchayat boundaries need the CAPTCHA-protected LGD export; without
   it, units are deterministic clusters of ~6 villages (labelled as such).
3. The target is a reanalysis (ERA5 blend), not an IMD operational product; IMD
   block values can be supplied through the API but were not used in training.
4. Modern gauges are scarce (4 in modelled MH blocks); the ~100-gauge test uses
   1960, when the reanalysis assimilated fewer observations.
5. Models do not transfer across regions for rainfall amounts; each region needs
   its own training (MH and KA are trained separately).
6. Humidity and wind have no gauge validation and keep a fixed T3 inflation.

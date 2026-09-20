# Architecture — Panchayat-Level Weather Downscaling (SIH26074)

> Status: living document. Reflects the CURRENT architecture, updated as the build evolves.

---

## 0. The design decision that drives everything else

The PRD (§7) names the real tension: standard downscaling assumes the fine-scale
truth is a *smooth* function of the coarse input, which is false for rainfall.
It also names the real data problem (§8): panchayat-level ground truth is sparse.

Our response is a **three-tier honesty architecture**. Every output declares which
tier it came from, and uncertainty widens as we move down the tiers:

| Tier | Step | Ground truth | Status |
|---|---|---|---|
| **T1** | Block (~40 km) to ERA5-Land grid (~9 km) | Dense, real (ERA5-Land) | **Measured.** Full metrics. |
| **T2** | 9 km grid to real gauge point | Sparse, real (GHCN-Daily, 3807 Indian stations) | **Measured where gauges exist.** This is the PRD §9 proof. |
| **T3** | 9 km grid to panchayat polygon (~3 km) | None | **Inference.** Uncertainty inflated; labelled as unvalidated. |

We never present a T3 number with T1 confidence. That distinction is surfaced in
the API response, the dashboard, and the README.

---

## 1. Tech stack

- **Language:** Python 3.12 (pipeline + API), TypeScript (frontend)
- **API:** FastAPI + Uvicorn + Pydantic v2
- **ML:** LightGBM (quantile + binary objectives), scikit-learn (preprocessing, calibration)
- **Geospatial:** GeoPandas, Shapely, pyproj
- **Data:** pandas, Parquet (via pyarrow)
- **Frontend:** React 18 + Vite + TypeScript + MapLibre GL JS + Recharts
- **Testing:** pytest (backend), vitest (frontend), ruff (lint)
- **Runtime:** local-first; Docker Compose for a reproducible offline demo

**Why LightGBM and not a neural downscaler (CNN/GAN super-resolution):**
see `decisions.md`. Short version: tabular covariates, small sparse ground truth,
native quantile regression for calibrated uncertainty, and — decisively — the
model must be *explainable* to an extension officer who has to trust it.

---

## 2. Data sources (all public, all keyless)

| Source | Resolution | Used for |
|---|---|---|
| Open-Meteo ERA5 archive | ~9-25 km daily | Fine reference field + training target |
| Open-Meteo Forecast API | operational | Live coarse input at inference time |
| Open-Meteo Elevation API | ~90 m point | Terrain stencil (elevation, slope, aspect, ruggedness) |
| GADM v4.1 India L3 | subdistrict | **Block** boundaries |
| datameet `indian_village_boundaries` | village polygon | **Panchayat-proxy** units (real geometry) |
| GHCN-Daily (NOAA NCEI) | point station | **Real ground-truth validation** (PRCP, TMAX, TMIN) |

**Pilot region:** Maharashtra (Pune / Satara / Ahmednagar / Nashik belt — Western
Ghats windward plus rain-shadow, a ~3000 mm to ~500 mm gradient inside 50 km).
**Held-out transfer test:** Karnataka. Trained weights are never fit on KA; it
exists to test whether the learned terrain response generalises off its home turf.

### Panchayat units — stated honestly
Official panchayat boundaries are not published as open geospatial data at national
scale. We use **real village polygons** from datameet, dissolved into panchayat-proxy
units by grouping contiguous villages within a block. These are genuine administrative
geometries, not synthetic tessellation, but they are *village* units approximating
*panchayat* units. The README says so plainly.

---

## 3. The model

### 3.1 Residual formulation (not direct prediction)

We never predict the absolute panchayat value. We predict the **local anomaly**:

```
anomaly           = value(local) - value(block_mean)
prediction(local) = value(block_mean) + model(covariates)
```

This guarantees the model can only ever *refine* the official forecast, never
silently replace it. If the model outputs zero everywhere, we degrade gracefully
to the naive baseline — the system's worst case is "no worse than today".

### 3.2 Rainfall is modelled in two stages (the discontinuity problem)

A single regressor on rainfall produces smooth drizzle everywhere — exactly the
false-smoothness failure the PRD calls out. Instead:

- **Stage A — occurrence:** LightGBM binary classifier giving P(rain > 0.1 mm here),
  isotonic-calibrated on held-out data.
- **Stage B — amount given rain:** LightGBM quantile regressors (tau = 0.1/0.5/0.9)
  trained only on wet cases.
- Combined into a proper mixed discrete-continuous predictive distribution.

This lets one panchayat be dry while its neighbour is wet — the physical behaviour
naive interpolation cannot represent.

### 3.3 Continuous variables

Tmax, Tmin, relative humidity, wind speed: LightGBM quantile regression at
tau = 0.1/0.5/0.9 directly on the anomaly. Temperature additionally receives a
physical **lapse-rate prior** (about -6.5 °C/km) as an offset feature, so the model
learns the *departure* from known physics rather than re-deriving it.

### 3.4 Covariates

Terrain: elevation, elevation anomaly vs block mean, slope, aspect,
**monsoon-relative aspect** (cosine of aspect against the ~245° SW monsoon flow — the
windward/leeward discriminator that drives rain shadow), terrain ruggedness index,
local relief, distance to coast.

Context: block-mean value of every variable, block-level spatial gradient,
block terrain spread, day-of-year harmonics, monsoon-phase flag.

### 3.5 Two kinds of uncertainty, reported separately

1. **Aleatoric** — irreducible local variability. From the quantile spread.
2. **Epistemic** — *"do we actually know this area?"* A support score built from
   covariate in-distribution distance (Mahalanobis vs the training manifold),
   nearest gauge distance, terrain-data density, and tier (T1/T2/T3).

These combine into a published confidence band plus a plain-language label
(`well-supported` / `moderate` / `low — treat as indicative`). PRD §6's usability
bar is met literally: the system can say *"70% chance of rain, but we are not
confident about your specific area."*

### 3.6 Block-mean reconciliation

After per-panchayat prediction, area-weighted panchayat values are rescaled so they
re-aggregate to the official block value (multiplicative for rainfall, additive for
temperature). The official forecast is never contradicted in aggregate — only
redistributed within the block. This is what makes the output acceptable to an
agency that must stand behind its own block forecast.

---

## 4. Baselines we must beat (PRD §9)

| Baseline | Description |
|---|---|
| **B0 — Naive** | Copy the block value to every panchayat. *The bar the PRD names.* |
| **B1 — IDW** | Inverse-distance interpolation of neighbouring block values. |
| **B2 — Lapse-rate only** | Physical elevation correction, no learning. |
| **B3 — Bilinear** | Standard bilinear regrid of the coarse field. |

**Metrics:** MAE / RMSE plus skill score vs B0; Brier score and reliability diagram for
rain occurrence; CRPS and PIT histogram for distributional calibration; coverage of
the 80% interval (should be about 0.80 — an over-confident model fails here even if
its MAE wins).

---

## 5. Folder structure

```
SIH-Project-3/
├── docs/                    PRD, architecture, phases, decisions, memory
├── backend/
│   ├── app/                 FastAPI: routers, schemas, services, advisory text
│   ├── pipeline/
│   │   ├── sources/         one adapter per data source (cached, retrying)
│   │   ├── geo/             boundaries, panchayat units, terrain stencil
│   │   ├── features/        covariate builders
│   │   ├── models/          train, predict, uncertainty, reconciliation
│   │   └── evaluate/        baselines, metrics, reports
│   └── tests/
├── frontend/                Vite + React + MapLibre dashboard
├── data/                    cache/raw/interim/processed  (gitignored)
├── models/artifacts/        trained models + calibrators (gitignored)
└── docker-compose.yml
```

---

## 6. Data flow

**Offline (training):**
boundaries → panchayat units → terrain stencil → ERA5 fine field + GHCN stations
→ block aggregation (synthesises the coarse input) → feature table
→ train per-variable models → calibrate → evaluate vs B0-B3 → persist artifacts.

**Online (serving):**
request `(block_id, date)` → fetch operational coarse forecast → load cached terrain
features for that block's panchayats → predict anomaly and quantiles → reconcile to
block mean → compute support score → render advisory text → JSON to dashboard.

Terrain features are static and precomputed; only the weather leg is live, so a
request is a model call, not a data pull.

---

## 7. Deployment

Local-first: `uvicorn` plus `vite dev`. `docker-compose up` builds both plus a
pre-baked artifact layer for a zero-network demo (important: venue wifi is not to be
trusted). All data sources cache to disk on first fetch, so the full pipeline
re-runs offline after one warm run.

---

## 8. Known limitations (carried into the README, not hidden)

1. T3 panchayat-scale output is **not** validated against panchayat-scale truth,
   because such truth does not exist at scale. It is physically-informed inference.
2. Village polygons approximate panchayat units.
3. ERA5 is a reanalysis, not an operational IMD forecast; the pipeline accepts IMD
   block forecasts as input but was trained on reanalysis-derived coarse fields.
4. GHCN Indian station records have gaps and uneven recency.
5. Trained on Maharashtra; Karnataka transfer is measured and reported, but
   performance in climatically dissimilar regions (Himalaya, North-East, desert)
   is unknown.

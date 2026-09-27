<p align="center">
  <img src="docs/logo.svg" alt="FieldCast" width="340" />
</p>

<p align="center">
  <b>Village-level weather, with honest confidence.</b><br />
  Block-level weather forecasts downscaled to every gram panchayat for agro-meteorological advisories.
</p>

<p align="center">
  <img alt="Smart India Hackathon" src="https://img.shields.io/badge/Smart%20India%20Hackathon-SIH26074-f59e0b" />
  <img alt="Ministry of Earth Sciences" src="https://img.shields.io/badge/Ministry-Earth%20Sciences-0a3b34" />
  <img alt="Theme: Disaster Management" src="https://img.shields.io/badge/Theme-Disaster%20Management-a3402a" />
  <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-047857" />
</p>
<p align="center">
  <img alt="Python 3.12" src="https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white" />
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white" />
  <img alt="LightGBM" src="https://img.shields.io/badge/LightGBM-quantile%20models-2e7d32" />
  <img alt="React 18" src="https://img.shields.io/badge/React-18-20232a?logo=react&logoColor=61DAFB" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" />
  <img alt="MapLibre GL" src="https://img.shields.io/badge/MapLibre-GL-396CB2?logo=maplibre&logoColor=white" />
  <img alt="Vercel" src="https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white" />
  <img alt="Tests: 408 passing" src="https://img.shields.io/badge/tests-408%20passing-047857" />
</p>

---

## Contents

[The problem](#the-problem) · [What FieldCast does](#what-fieldcast-does) · [How it works](#how-it-works) ·
[Coverage](#coverage) · [Results](#results) · [The dashboard](#the-dashboard) · [Tech stack](#tech-stack) ·
[Project structure](#project-structure) · [Run it locally](#run-it-locally) · [Deploy on Vercel](#deploy-on-vercel) ·
[API](#api) · [Data and credits](#data-and-credits) · [Limitations](#limitations-stated-plainly)

## The problem

| | |
|---|---|
| **Problem statement** | SIH26074: *Downscaling of weather forecast from Block level to Panchayat level: inferring high-resolution plots / data / information / variables for agro-meteorological advisory services* |
| **Ministry** | Ministry of Earth Sciences (MoES) |
| **Theme** | Disaster Management |

Agro-met advisories in India are issued per **block**, but a block can span a
ridge, a valley and a rain shadow. Across the Western Ghats a windward slope can
get a downpour while a village a few kilometres downwind stays dry. One number
per block sends the same spraying, sowing and harvest advice to villages that
will see very different weather.

Two things make this harder than interpolation. Rainfall is not a smooth field,
and **there is almost no panchayat-scale ground truth** to learn from or check
against. So FieldCast's goal is the panchayat value **and** how far to trust it.

## What FieldCast does

- **Refines, never replaces, the official forecast.** It predicts each
  panchayat's *difference* from the block value, and panchayat values always add
  back up to the block value.
- **Serves real gram panchayats.** It builds 9,802 of them from village
  boundaries joined to the Government's LGD directory.
- **Gives every number a range and a confidence level.** Each value has a
  calibrated 80% range, a support level (high / moderate / low) and an evidence
  tier.
- **Treats rain as two statements.** It publishes a chance of rain (≥2.5 mm)
  plus an *if-it-rains* amount range, instead of a misleading single number.
- **Gives cautious farm advice.** Spraying, irrigation, harvest, fertiliser,
  disease watch and heavy-rain preparedness move from *go ahead* to *take care*
  where confidence is low. A warning is never softened.
- **Accepts the officer's IMD bulletin.** An officer can type the official block
  forecast and get it downscaled instantly.
- **Shows its evidence in the open.** Skill, confidence intervals, gauge checks
  and every loss are shown in the app, not only the wins.

## How it works

![How FieldCast turns one block forecast into gram-panchayat advice](docs/flowchart/fieldcast-flowchart.png)

| Design choice | Why |
|---|---|
| Predict the **anomaly** from the block value | If the model learns nothing, the output is exactly the official forecast |
| **Rain-shadow terrain features**: ridge height upwind along the 245° monsoon flow, and the rise ahead | The rain shadow is caused by the ridge upwind of a village, not its local slope |
| **Two-stage rainfall**: calibrated rainy-day classifier (IMD ≥2.5 mm) + conditional amount quantiles | One regressor smears drizzle everywhere; two stages allow "dry here, wet next door" |
| **LightGBM quantile models** (10th / 50th / 90th percentile) | A predictive range, not just a point |
| **Block-mean reconciliation** (rain reconciled in expectation) | The area-weighted panchayat mean equals the official block value |
| **Serving policy** decided on validation data | A variable whose served estimate does not beat the block value serves the block value |
| **Epistemic support**: terrain similarity to training data (chi-square-scaled Mahalanobis) + distance to a gauge | Tree models extrapolate with false confidence; low support widens the range and downgrades the advice |
| **Gauge-calibrated ranges** | Ranges are widened until ~80% of real rain-gauge observations fall inside |
| **Asymmetric-cost advice** | Irreversible, costly operations need more certainty than reversible ones |
| **Numpy-only serving** | The trained trees are flattened into arrays (identical to ~1e-15), so the API runs without LightGBM, pandas or SciPy |

### What is validated and what is inferred

| Tier | Claim | Evidence |
|---|---|---|
| **T1** | Block → ~16 km grid | Held-out 2022-23 dry season and 2023 monsoon; whole blocks held out |
| **T2** | → real rain gauge | NOAA GHCN gauges never used in training (4 modern gauges in Maharashtra, 3 in Karnataka) |
| **T3** | → gram panchayat | **Not validated**: no panchayat-scale truth exists. Terrain-informed inference with a gauge-calibrated range, labelled in every response |

Training uses the 2019–2022 monsoons and the 2021-22 dry season. A date-level
check with a 3-day gap stops any test day from leaking into training.

## Coverage

| | Maharashtra (pilot) | Karnataka |
|---|---|---|
| Districts | Pune, Satara, Ahmadnagar, Nashik, Raigad, Kolhapur, Sangli | Belagavi, Dharwad, Uttara Kannada, Shivamogga, Chikkamagaluru, Hassan |
| Blocks | 86 | 48 |
| Villages | 11,740 | 7,999 |
| Units served | **8,072 real gram panchayats** + 138 village clusters | **1,730 real gram panchayats** + 63 village clusters |

Gram-panchayat boundaries are built by joining village polygons to the Local
Government Directory (LGD) by census village code: 94% of Maharashtra and 96% of
Karnataka villages match exactly. The rest fall back to small village clusters,
labelled as such in the app.

Variables: rainfall, maximum and minimum temperature, relative humidity and wind
speed.

## Results

Skill = 1 − MAE(model) / MAE(naive block copy); positive beats the block
forecast, 1 is perfect. 90% CIs are cluster bootstraps over blocks (T1) or
gauges (T2); no result is called significant with fewer than 8 gauges. Full
tables are in [`reports/`](reports/) and on the app's Evidence page.

| Held-out seasons, grid (T1) | Maharashtra | Karnataka |
|---|---:|---:|
| Max temperature skill | **+0.44** [0.40, 0.48] | **+0.42** [0.35, 0.49] |
| Min temperature skill | **+0.28** [0.24, 0.32] | **+0.34** [0.25, 0.42] |
| Relative humidity skill | +0.19 | +0.03 |
| Wind speed skill | +0.05 | +0.22 |
| Rain / no-rain (Brier, lower is better) | **0.026** vs 0.043 block | **0.038** vs 0.056 block |
| Rain amount | block value served | block value served |

- **Real gauges never used in training.** The rain / no-rain call beats the
  block forecast: Brier 0.225 vs 0.293 in Maharashtra (23% better) and 0.256 vs
  0.313 in Karnataka. Also, 80–81% of wet gauge-days fall inside the published
  if-it-rains range, against a target of 80%.
- **Rain amounts** did not beat the block value on validation data. So
  FieldCast serves the official amount as-is and adds the panchayat-specific
  rain chance and range. Every variable follows this rule: nothing served was
  worse than the block forecast on validation.
- **Transfer test.** Maharashtra's models were applied to Karnataka.
  Temperatures still improved (Tmax +0.20), but rain amounts got worse, so each
  state is trained on its own data.
- **Speed.** The largest block (257 panchayats) is served in ~100 ms, as a
  53 KB gzipped response.

## The dashboard

Built for a block or district agriculture officer on a laptop or a phone.

- **Map of every gram panchayat.** Colour shows the value relative to the block,
  and texture shows confidence (plain / dots / hatching), so the two can never
  be confused. When rain amounts come from the block, the map shows the chance
  of rain.
- **Advice first.** Each panchayat shows what to tell farmers, in plain words,
  most restrictive first (✓ go ahead · ⚠ take care · ⛔ hold off).
- **Weather cards.** Each value appears with its likely range as a band, the
  block value marked, and a plain verdict.
- **"How sure are we?"** Support level, distance to the nearest gauge and the
  evidence tier. It is always visible, never behind a toggle.
- **Block summary.** Per-variable spread across panchayats, confidence counts,
  and an advice roll-up, plus a searchable, sortable panchayat list.
- **Official bulletin, date replay and print.** Officers can enter the official
  bulletin, replay past seasons or view live forecasts (yesterday to +15 days),
  and print a one-page advisory sheet for a panchayat noticeboard.
- **Evidence and How it works pages.** Skill charts with CIs, gauge checks and
  limitations, plus a plain-language method explainer.
- **Accessibility.** Keyboard accessible, colour-blind-safe palettes, and a
  mobile layout.

## Tech stack

| Layer | Tools |
|---|---|
| Modelling pipeline | Python 3.12 · LightGBM · scikit-learn (isotonic calibration) · pandas · GeoPandas · Shapely · PyArrow |
| Serving API | FastAPI · pydantic · numpy-only runtime · GZip |
| Dashboard | React 18 · TypeScript (strict) · Vite · MapLibre GL · OpenStreetMap tiles |
| Quality | pytest (231 tests) · vitest (177 tests) · ruff · eslint |
| Hosting | Vercel (FastAPI preset + CDN for the built dashboard); no Docker |

## Project structure

```
backend/
  app/            FastAPI app: routes, schemas, advisory rules
  serve/          numpy-only runtime, flattened trees, bundle export
  pipeline/
    geo/          blocks, gram panchayats (LGD join), terrain, coastline
    sources/      Open-Meteo, DEM tiles, NOAA gauges
    features/     feature tables for training and evaluation
    models/       quantile downscalers, reconciliation, support, calibration, serving policy
    evaluate/     T1 / T2 evaluation, bootstrap CIs, reports
    build_base.py · fetch.py · train.py
  tests/
frontend/src/
  components/     forecast (map + sidebar), village detail, evidence, about, shell
  lib/            colour scales, formatting, dates, advice and evidence helpers
  api/ hooks/ styles/ types/
serve_bundle/     committed model bundle the deployed API reads
reports/          evaluation reports (Markdown + JSON)
docs/             architecture, backend and frontend guides, decisions, flowchart
```

## Run it locally

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[serve,pipeline,dev]"   # .venv/bin/python on macOS/Linux
cd frontend && npm install && npm run build && cd ..
.venv/Scripts/python -m uvicorn backend.app.main:app --port 8000
```

Open http://localhost:8000: one process serves the API and the dashboard. For
frontend development, run `npm run dev` in `frontend/` (http://localhost:5173,
proxying `/api` to port 8000). With `DOWNSCALE_OFFLINE=1` the app runs without a
network for replay dates and officer-supplied bulletins.

**Tests and lint**

```bash
.venv/Scripts/python -m pytest -q && .venv/Scripts/python -m ruff check .
cd frontend && npm run lint && npm test
```

**Rebuilding the data and models (pipeline)**

```bash
# 1. Blocks, gram-panchayat units, gauge index. Put the LGD
#    "Village To Gram Panchayat Mapping" exports in data/raw/lgd/ first.
python -m backend.pipeline.build_base --region mh_ghats
# 2. Weather history: multi-day on the free Open-Meteo tier; resumes itself.
python -m backend.pipeline.fetch --region mh_ghats --region ka_ghats
# 3. Train (optionally on whatever history is complete so far).
python -m backend.pipeline.train --region mh_ghats --available-only
# 4. Evaluate: T1, gauges, calibration, and the transfer test.
python -m backend.pipeline.evaluate.run --region mh_ghats
python -m backend.pipeline.evaluate.run --region ka_ghats --model-region mh_ghats
# 5. Export the serving bundle the API reads, then commit it.
python -m backend.serve.export --region mh_ghats --region ka_ghats
```

## Deploy on Vercel

The repository is ready for Vercel's FastAPI preset; no Docker.

1. Import the GitHub repository in Vercel (or run `vercel` from the repository
   root), keeping the project root at the repository root.
2. Vercel builds the dashboard with the `buildCommand` in `vercel.json`
   (`cd frontend && npm ci && npm run build`).
3. It installs only the runtime dependencies from `pyproject.toml` (FastAPI,
   pydantic, httpx, numpy: about 86 MB).
4. It loads `[tool.vercel] entrypoint = "backend.app.main:app"` and serves the
   built dashboard from its CDN.

The API reads the committed `serve_bundle/`; training data and models are never
uploaded (`.vercelignore`). After retraining, re-export the bundle, commit it and
redeploy.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Liveness and model version |
| `GET /api/regions` | Regions, whether each is served, and the dates that can be replayed |
| `GET /api/blocks?region=` | Blocks with unit counts |
| `GET /api/blocks/{id}/panchayats` | Gram-panchayat outlines (GeoJSON) |
| `GET /api/blocks/{id}/forecast?date=` | Forecast for a replay date, or live from yesterday to +15 days |
| `POST /api/blocks/{id}/forecast` | Downscale an **official block forecast you supply** (e.g. an IMD bulletin) |
| `GET /api/evaluation`, `/api/evaluation/reports` | Skill tables and full evaluation reports |

Each variable in a forecast carries its `value`, the `block_value` and the
difference (`anomaly`), a `confidence` block (80% `lower`/`upper`, `support`,
`tier`, `nearest_gauge_km`), and for rain the `rain_probability`. `value_source`
says whether the value is the model's or the block's, and `range_basis` says
whether the range covers all days or only rainy ones.

## Data and credits

All sources are public and need no API key.

| Source | Used for | Licence / terms |
|---|---|---|
| [Open-Meteo](https://open-meteo.com) (ERA5 reanalysis, forecasts) | weather history, live forecasts | CC BY 4.0 |
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | elevation | open data (SRTM and others) |
| [Natural Earth](https://www.naturalearthdata.com) | coastline | public domain |
| [GADM 4.1](https://gadm.org) | block boundaries | free for non-commercial use |
| [datameet](https://github.com/datameet/indian_village_boundaries) | village polygons | CC BY 4.0 |
| [LGD, Government of India](https://lgdirectory.gov.in) | village → gram panchayat | government open data |
| [NOAA GHCN-Daily](https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-daily) | rain gauges | public domain |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | map background | ODbL |

## Limitations, stated plainly

1. Panchayat-level (T3) values are inference: no panchayat-scale measurements
   exist to check them against.
2. About 5% of villages could not be matched to a gram panchayat in LGD and are
   grouped into labelled village clusters.
3. The models learn from a reanalysis (ERA5), not an IMD operational forecast.
   IMD block values can be supplied through the app, but were not used in training.
4. Modern rain gauges are scarce (4 in the modelled Maharashtra blocks, 3 in
   Karnataka), so gauge results are not yet statistically significant. A
   ~100-gauge-per-state historical test (1960 monsoon) is built into the
   evaluation, and its results will be added.
5. Each state needs its own training: in a region it was not trained on,
   rainfall amounts were worse than the block value.
6. Humidity and wind have no gauge validation, so their ranges use a fixed widening.

## Documentation

- [`docs/architecture.md`](docs/architecture.md): system design and data flow
- [`docs/backend.md`](docs/backend.md): pipeline, models, serving and API in depth
- [`docs/frontend.md`](docs/frontend.md): dashboard design and components
- [`docs/decisions.md`](docs/decisions.md): the reasoning behind each technical choice

## License

Released under the [MIT licence](LICENSE).

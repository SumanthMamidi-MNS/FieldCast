<p align="center">
  <img src="docs/assets/fieldcast-logo.svg" alt="FieldCast" height="88">
</p>
<h3 align="center">
  <strong>Village-Level Weather Downscaling &bull; Honest Confidence</strong><br>
  <small>Hyperlocal Orographic Modeling &bull; Gram Panchayat Forecasts &bull; Agro-Meteorology</small>
</h3>

<p align="center">
  <a href="https://www.python.org/"><img src="docs/assets/badges/python.svg" alt="Python 3.12" height="30"></a>
  <a href="https://fastapi.tiangolo.com"><img src="docs/assets/badges/fastapi.svg" alt="FastAPI REST" height="30"></a>
  <a href="docs/backend.md#9-models-modelsdownscalerpy"><img src="docs/assets/badges/downscale.svg" alt="Downscaling: LightGBM" height="30"></a>
  <a href="docs/architecture.md"><img src="docs/assets/badges/orography.svg" alt="Orographic: 245-deg Rain Shadow" height="30"></a>
  <a href="docs/backend.md#6-geography"><img src="docs/assets/badges/coverage.svg" alt="Coverage: 9,802 Panchayats" height="30"></a>
  <a href="docs/frontend.md"><img src="docs/assets/badges/console.svg" alt="Dashboard: React + MapLibre" height="30"></a>
  <a href="docs/backend.md#13-serving"><img src="docs/assets/badges/offline.svg" alt="Engine: NumPy ~100ms" height="30"></a>
  <a href="backend/tests/"><img src="docs/assets/badges/tests.svg" alt="410 Passing" height="30"></a>
  <a href="LICENSE"><img src="docs/assets/badges/license.svg" alt="MIT License" height="30"></a>
</p>

<p align="center">
  FieldCast downscales official block-level weather forecasts to every <strong>gram panchayat</strong>,<br>
  delivering terrain-aware agro-met advice with honest prediction confidence.
</p>

<p align="center"><img src="docs/assets/divider.svg" width="100%" height="1" alt=""></p>

<details open>
<summary><strong>Table of Contents</strong></summary>

1. [Why it matters](#why-it-matters)
2. [What it does](#what-it-does)
3. [The dashboard](#the-dashboard)
4. [How it works](#how-it-works)
5. [Why it works](#why-it-works)
6. [Results](#results)
7. [Tech stack](#tech-stack)
8. [Getting started](#getting-started)
9. [Limitations](#limitations)
10. [Data sources](#data-sources)
11. [Acknowledgements](#acknowledgements)
12. [License](#license)

</details>

<p align="center"><img src="docs/assets/divider.svg" width="100%" height="1" alt=""></p>

## Why it matters

Agro-met advisories in India are issued per **block**, but one block can span a
ridge, a valley and a rain shadow. Across the Western Ghats a windward slope can
get a downpour while a village a few kilometres downwind stays dry, yet both get
the same spraying, irrigation and harvest advice.

Two things make this harder than interpolation. Rainfall is not a smooth field,
and **there is almost no panchayat-scale ground truth**. So FieldCast delivers
the panchayat value **and** how far to trust it.

## What it does

- **Refines, never replaces, the official forecast.** It predicts each
  panchayat's difference from the block value, and the panchayats always add
  back up to it.
- **Serves real gram panchayats.** It covers 9,802 of them across 134 blocks in
  Maharashtra and Karnataka, built from village boundaries joined to the
  Government's LGD directory.
- **Gives every number a range and a confidence level.** Each value has a
  calibrated 80% range, a support level (high / moderate / low) and an
  evidence tier.
- **Treats rain honestly.** It gives a chance of rain plus an *if-it-rains*
  amount range, not one misleading number.
- **Gives cautious farm advice.** Spraying, irrigation, harvest, fertiliser and
  heavy-rain advice move from *go ahead* to *take care* where confidence is low.
- **Accepts the officer's IMD bulletin.** An officer can type the official block
  forecast and get it downscaled instantly.

## The dashboard

<p align="center">
  <a href="docs/screenshots/forecast-map.jpg"><img src="docs/screenshots/forecast-map.jpg" alt="FieldCast dashboard: maximum temperature across the 257 gram panchayats of Patan block" width="100%"></a>
  <br>
  <sub>Patan block, 257 gram panchayats. Colour is the difference from the block forecast; hatching marks where confidence is low.</sub>
</p>

Built for a block agriculture officer on a laptop or a phone:
- **Advice comes first**, in plain words: ✓ go ahead · ⚠ take care · ⛔ hold off.
- **Colour shows the value and texture shows confidence**, so the two can never
  be confused.
- **Each panchayat has weather cards and a "How sure are we?" panel.** Every
  value has its range and the block value marked.
- **Officers can print a one-page advisory** for a panchayat noticeboard.
- **Past seasons can be replayed**, and live forecasts run from yesterday to
  +15 days.
- **It's accessible.** Keyboard accessible, colour-blind-safe palettes, and a
  mobile layout.

<p align="center">
  <a href="docs/screenshots/panchayat-advice.jpg"><img src="docs/screenshots/panchayat-advice.jpg" alt="A gram panchayat's advice: hold off on spraying, irrigation and harvest, with confidence caveats" width="100%"></a>
  <br>
  <sub>A gram panchayat's advice: hold off on spraying, irrigation and harvest, with confidence caveats.</sub>
</p>

## How it works

<p align="center">
  <a href="docs/flowchart/fieldcast-flowchart.png"><img src="docs/flowchart/fieldcast-flowchart.png" alt="FieldCast flowchart: from one block forecast to gram-panchayat advice" width="100%"></a>
</p>

1. **Input.** Take the official block forecast: an IMD bulletin, a live
   forecast or a past-season replay.
2. **Describe each panchayat.** Terrain features include elevation, slope,
   monsoon-facing aspect, the ridge height upwind, and the distance to the coast
   and to a rain gauge.
3. **Downscale.** LightGBM quantile models predict each panchayat's *difference*
   from the block value. Rain uses two stages: the chance of a rainy day, then
   the amount if it rains.
4. **Reconcile.** Panchayat values are adjusted so their area-weighted mean
   equals the block value.
5. **Quantify trust.** Ranges are calibrated against real rain gauges, and
   support comes from how familiar the terrain is and how near a gauge is.
6. **Advise.** Farm advice becomes more cautious wherever confidence is low.

## Why it works

| Design choice | Why |
|---|---|
| Predict the **anomaly**, not the value | If the model learns nothing, the output is exactly the official forecast |
| **Rain-shadow features** along the 245-deg monsoon flow | A village's rain shadow comes from the ridge upwind of it, not its local slope |
| **Two-stage rainfall** (IMD rainy day >= 2.5 mm, then amount) | One regressor smears drizzle everywhere; two stages allow "dry here, wet next door" |
| **Block-mean reconciliation** | Keeps every panchayat map consistent with the official block forecast |
| **Serving policy decided on validation** | If the model can't beat the block value for a variable, the block value is served |
| **Epistemic support** (chi-square-scaled Mahalanobis + gauge distance) | Tree models extrapolate with false confidence; unfamiliar terrain widens the range and downgrades advice |
| **Gauge-calibrated ranges** | "80% range" means ~80% of real gauge readings fall inside it |
| **Asymmetric-cost advice** | Irreversible steps like spraying or harvest need more certainty than reversible ones |
| **Numpy-only serving** | Trees are flattened into arrays (identical to ~1e-15), so the API runs without LightGBM, pandas or SciPy: ~100 ms for a 257-panchayat block |

## Results

Tested on seasons and whole blocks the model never saw (2022-23 dry season and
2023 monsoon), against the obvious baseline of copying the block value to every
panchayat. Skill = 1 − MAE(model) / MAE(block copy); 1 is perfect, 0 is no
better. 90% confidence intervals come from cluster bootstraps.

| | Maharashtra | Karnataka |
|---|---:|---:|
| Max temperature skill | **+0.44** [0.40, 0.48] | **+0.42** [0.35, 0.49] |
| Min temperature skill | **+0.28** [0.24, 0.32] | **+0.34** [0.25, 0.42] |
| Relative humidity skill | +0.19 | +0.03 |
| Wind speed skill | +0.05 | +0.22 |
| Rain / no-rain error (Brier) | **0.026** vs 0.043 (**40% lower**) | **0.038** vs 0.056 (**32% lower**) |
| Rain amount | block value served | block value served |

- **Against ~100 real rain gauges per state** (1960 monsoon: 97 in Maharashtra,
  100 in Karnataka, never used in training), the rain / no-rain call is **21%**
  and **19%** better than the block forecast, and **82%** and **85%** of rainy
  days fall inside the published range (target 80%, calibrated on 1958).
- **At today's few gauges** (2022-23, 3–4 per state), the rain / no-rain call is
  23% and 18% better, with 82% and 78% of rainy days inside the range.
- **Rain amounts did not beat the block value**, so FieldCast serves the
  official amount and adds the panchayat's own rain chance and range. Nothing
  served was worse than the block forecast on validation.
- **Every loss is published too**, on the app's Evidence page and in
  [`reports/`](reports/).

<p align="center">
  <a href="docs/screenshots/evidence.jpg"><img src="docs/screenshots/evidence.jpg" alt="Evidence page: skill against the block forecast with confidence intervals, and the rain loss shown just as plainly" width="100%"></a>
</p>

## Tech stack

| Layer | Tools |
|---|---|
| Modelling | Python · LightGBM (quantile regression) · scikit-learn (isotonic calibration) · pandas · GeoPandas · Shapely |
| API | FastAPI · pydantic · numpy-only runtime |
| Dashboard | React 18 · TypeScript (strict) · Vite · MapLibre GL · OpenStreetMap |
| Quality | 233 pytest + 177 Vitest tests · Ruff · ESLint |

## Getting started

> **One-click launch (Windows):** After completing setup, double-click `start.bat` at the project root — it starts the server and opens the app in your browser automatically.

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[serve,pipeline,dev]"   # .venv/bin/python on macOS/Linux
cd frontend && npm install && npm run build && cd ..
.venv/Scripts/python -m uvicorn backend.app.main:app --port 8000
```

Open **http://localhost:8000**: one process serves the API and the dashboard.

```bash
.venv/Scripts/python -m pytest -q          # backend tests
cd frontend && npm test && npm run lint    # frontend tests and lint
```

<details>
<summary><b>Model pipeline (training & evaluation)</b></summary>

```bash
# LGD "Village To Gram Panchayat Mapping" exports go in data/raw/lgd/ first.
python -m backend.pipeline.build_base --region mh_ghats                 # blocks, panchayats, gauges
python -m backend.pipeline.fetch --region mh_ghats --region ka_ghats    # weather history (resumable)
python -m backend.pipeline.train --region mh_ghats                      # models
python -m backend.pipeline.evaluate.run --region mh_ghats               # evaluation reports
python -m backend.serve.export --region mh_ghats --region ka_ghats      # serving bundle
```
</details>

<details>
<summary><b>Project structure</b></summary>

```
backend/
  app/          FastAPI routes, schemas, advisory rules
  serve/        numpy-only runtime and bundle export
  pipeline/     geo · sources · features · models · evaluate
  tests/
frontend/src/   components · lib · hooks · api · styles
serve_bundle/   model bundle the deployed API reads
reports/        evaluation reports
docs/           architecture, design decisions, flowchart
```
</details>

## Limitations

- Panchayat-level values are inference: no panchayat-scale measurements exist to
  check them against, and every response says so.
- Modern rain gauges are scarce (3–4 per state in these blocks), so the
  ~100-gauge check uses the 1960 monsoon, when the reanalysis drew on fewer
  observations. Temperature has no historical gauges and is checked at 3–4.
- The models learn from ERA5 reanalysis, not IMD operational forecasts. IMD
  bulletins can be supplied at run time.
- About 5% of villages have no LGD gram-panchayat match and are served as
  labelled village clusters.

## Data sources

| Source | Dataset & Coverage | Role in FieldCast |
| :--- | :--- | :--- |
| **[Open-Meteo](https://open-meteo.com)** | ERA5 reanalysis & forecasts (0.25 deg) | Training history & live operational forecasts |
| **[AWS Terrain](https://registry.opendata.aws/terrain-tiles/)** | Mapzen global elevation DEM (~30 m) | Terrain elevation, slope, aspect & 245-deg ridge heights |
| **[datameet](https://github.com/datameet/indian_village_boundaries)** | Indian village boundaries (MH & KA) | Spatial geometries for gram panchayats |
| **[LGD Directory](https://lgdirectory.gov.in)** | Ministry of Panchayati Raj, GoI | Official village-to-panchayat mapping (9,802 GPs) |
| **[NOAA GHCN-D](https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-daily)** | Ground station daily rain gauges | Quantile calibration & holdout evaluation |
| **[OpenStreetMap](https://www.openstreetmap.org/copyright)** | OSM GIS vectors (ODbL) | Dashboard basemap cartography & terrain context |

## Acknowledgements

- **Smart India Hackathon** and the **Ministry of Earth Sciences (MoES)** for problem statement **SIH26074** (*Downscaling of weather forecast from Block level to Panchayat level for agro-meteorological advisory services*).
- **Open-Meteo** and **Copernicus ECMWF** for open hourly ERA5 reanalysis and high-resolution atmospheric data.
- **AWS Open Data** and the **Mapzen** team for global 30-meter elevation terrain tiles.
- **DataMeet** for open spatial boundary shapefiles of Indian villages.

## License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.

<p align="center"><img src="docs/assets/divider.svg" width="100%" height="1" alt=""></p>

<p align="center">
  Designed &amp; Developed by <a href="https://github.com/SumanthMamidi-MNS">Sumanth Mamidi</a><br>
  <sub>For Smart India Hackathon (SIH26074) &bull; Ministry of Earth Sciences (MoES)</sub>
</p>

# FieldCast — Backend

Everything behind the dashboard: where the data comes from, how the models are
built and checked, and how a forecast is served. Read top to bottom once and you
should be able to explain, run or change any part of it.

> Numbers quoted here (counts, sizes, timings) are from the current build. Model
> skill numbers live in `reports/evaluation_*.md`, regenerated on every run.

---

## 1. The job, in one paragraph

India's weather forecasts are issued per **block** (a sub-district of ~30-40 km).
Farm decisions happen per **gram panchayat**, and inside one block the weather
can differ sharply: across the Western Ghats a windward slope gets a downpour
while a village in the rain shadow a few km east stays dry. FieldCast takes the
official block value and **redistributes it across the block's gram panchayats**
using terrain, then attaches to every number **how far it can be trusted** and
**what a farmer should do** about it.

Three commitments shape every module:

1. **Refine, never replace.** The model predicts the *difference* from the block
   value, and panchayat values are reconciled so they add back up to the official
   block forecast. If the model learns nothing, the output is exactly the block
   value — never worse than today.
2. **Honest uncertainty.** Every value carries a range, a support level and an
   evidence tier. Ranges are calibrated against real rain gauges.
3. **Serve cheaply.** The deployed API needs only numpy: trees are flattened,
   terrain and history are precomputed into a committed "serving bundle".

---

## 2. Two halves

```
 OFFLINE PIPELINE  (your machine, full Python stack: pip install -e ".[pipeline]")
 ─────────────────────────────────────────────────────────────────────────────
 GADM blocks ─┐
 datameet villages + LGD mapping ─► gram-panchayat units ─┐
 GHCN gauge index ───────────────────────────────────────┤
 AWS DEM tiles + coastline ─► terrain features ──────────┤
 Open-Meteo ERA5 history (multi-day, quota-paced) ───────┴─► feature tables
        ─► train (LightGBM) ─► evaluate (T1 / T2 / T2-historical / transfer)
        ─► export ─► serve_bundle/   (committed to git)

 ONLINE SERVING  (Vercel or local uvicorn; runtime deps only: fastapi, pydantic, httpx, numpy)
 ─────────────────────────────────────────────────────────────────────────────
 request (block, date | official bulletin)
   ─► block value (bulletin → replay history → live Open-Meteo forecast)
   ─► features for each panchayat (precomputed terrain + block stats + date)
   ─► numpy tree evaluation ─► finalize (reconcile, support, range)
   ─► advisory text ─► JSON (gzip)
```

The two halves share every calculation after the trees (`numerics.py`,
`finalize.py`, `reconcile.py`, `uncertainty.py`, all numpy-only). A parity test
requires the served numbers to equal the pipeline's to 1e-9, so the published
evaluation always describes the model that is actually running.

---

## 3. File map

```
backend/
  config.py                 regions, variables, seasons, constants, MODEL_VERSION, paths
  app/
    main.py                 FastAPI app: endpoints, gzip, dashboard static mount
    schemas.py              pydantic response contract (the API's shape)
    services/advisory.py    numbers → farm advice (spray, irrigate, harvest, fertilise, disease)
  serve/
    trees.py                LightGBM → flat arrays; numpy evaluation (exact parity)
    runtime.py              the deployed forecast engine; reads serve_bundle/
    export.py               writes serve_bundle/ from pipeline outputs
  pipeline/
    sources/  cache.py      disk cache + offline mode
              open_meteo.py ERA5 archive, forecast; quota pacing, 429 handling
              ghcn.py       NOAA gauge inventory + daily records (fixed-width parsing)
              dem.py        AWS terrain tiles: download, decode, bilinear sample
    geo/      boundaries.py GADM blocks, tolerant district matching
              panchayats.py village polygons → gram-panchayat units (+ cluster fallback)
              gram_panchayats.py  LGD export reader and village → GP matching
              terrain.py    9-point stencil + orographic profiles + terrain_features()
              coast.py      Natural Earth distance-to-coast
    features/build.py       feature tables, spatial/temporal split, leakage assertion
    models/   downscaler.py LightGBM training: quantiles + calibrated rain occurrence
              predictor.py  pipeline-side prediction (used by evaluation)
              numerics.py   feature columns + shared maths (numpy only)
              finalize.py   reconcile → support → range (numpy only, shared)
              reconcile.py  block-mean reconciliation (additive / multiplicative / rain)
              uncertainty.py support score, chi-square, interval widening (numpy only)
    evaluate/ baselines.py, metrics.py, run.py (reports + gauge calibration)
    build_base.py, fetch.py, train.py     CLIs
  tests/                    pytest suite (~220 tests)
serve_bundle/               what production reads (committed)
reports/                    evaluation reports (md + json, committed)
data/, models/              local pipeline data and artefacts (gitignored)
```

---

## 4. Configuration (`backend/config.py`)

- **Regions**: `mh_ghats` (7 Maharashtra districts across the Ghats: coast →
  crest → rain shadow) and `ka_ghats` (6 Karnataka districts). Adding a state is
  a new `Region` entry, not new code.
- **Variables**: rain (`precip`, two-stage, multiplicative), `tmax`, `tmin`,
  `humidity` (additive), `wind` (multiplicative). Each maps to an Open-Meteo field
  and, where one exists, a GHCN element.
- **Seasons** (`TRAINING_WINDOW`): monsoons 2019-2022 and the 2021-22 dry season
  train; the 2022-23 dry season and 2023 monsoon are **test** seasons. Historical
  gauge seasons: 1958 monsoon (interval calibration), 1960 monsoon (gauge test).
  These never enter training (guarded by tests).
- **Constants**: lapse rate −6.5 °C/km; monsoon flow from 245°; rainy day ≥2.5 mm
  (IMD); quantiles 0.1/0.5/0.9; grid spacing 0.15°; `MODEL_VERSION`.

---

## 5. Data sources and how they are fetched

| Source | What for | Access notes |
|---|---|---|
| Open-Meteo archive (ERA5 "best match" blend) | training target, replay history | free tier: 600/min, 5k/h, **10k/day** weighted calls; each location × fortnight counts |
| Open-Meteo forecast | live block values (yesterday … +15 days) | called by the deployed API, cached 30 min in memory |
| AWS Terrain Tiles (terrarium PNG, zoom 11, ~76 m) | all terrain | keyless, no quota; tiles cached under `data/raw/dem/` |
| Natural Earth 10 m coastline | distance to sea | one download, clipped to India |
| GADM 4.1 level 3 | blocks | one download; district names matched tolerantly |
| datameet village polygons | village geometry | per state GeoJSON |
| LGD "Village To Gram Panchayat Mapping" | real gram panchayats | behind a CAPTCHA: download manually into `data/raw/lgd/` |
| NOAA GHCN-Daily | rain/temperature gauges | fixed-width files; quality-flagged values dropped |

**Caching.** Every HTTP response is cached on disk (`data/cache/`), keyed by URL
and parameters. `DOWNSCALE_OFFLINE=1` turns any cache miss into a clear error
instead of a network call, so a warm machine reproduces everything offline.

**Quota handling** (`open_meteo.py`, `fetch.py`). Calls are paced by their
weight (locations × fortnights). A minutely 429 waits and retries; an hourly or
daily 429 raises `ApiBudgetExceeded`, and `fetch.py` sleeps 30 min and resumes.
The fetch plan runs in order of value across regions: test seasons → recent
training seasons → historical gauge seasons → older training seasons.
`train --available-only` trains on whatever is complete, offline.

---

## 6. Geography

**Blocks.** GADM level-3 polygons for the configured districts (MH 86, KA 48).

**Gram panchayats** (`panchayats.py` + `gram_panchayats.py`):
1. Load datameet village polygons; keep villages whose interior point falls in a
   block (a village on a shared edge is assigned to exactly one block).
2. Read the LGD export. It is found by content (its district names are matched
   to the region, including renamed districts like Ahilyanagar/Belagavi), the
   title row above the header is skipped, and local-body code `0` (no panchayat)
   is dropped.
3. Match each village to its gram panchayat, most reliable first:
   **2001 census village code** (both sources carry it; Maharashtra polygons
   embed it in an 18-digit code) → 2011 code via datameet's crosswalk → a name
   unique within its sub-district. Codes that repeat in LGD, and ambiguous
   names, are left unmatched rather than guessed.
4. Dissolve matched villages per (block, gram panchayat). Unmatched villages are
   grouped into deterministic KMeans clusters of ~6 villages.
   Every unit records `unit_type`: `gram_panchayat` or `village_cluster`.

Result: MH 8,072 real gram panchayats + 138 clusters (94% of villages matched);
KA 1,730 + 63 (96%).

**Gauges.** GHCN stations in the region's bounding box, screened for enough
valid observations; about 100 per state were active in the 1950s-60s, only a
handful today.

---

## 7. Terrain features (`terrain.py`, `dem.py`, `coast.py`)

`terrain_features(lats, lons)` is the single entry point used for grid points,
gauges and panchayats, so all three are described identically:

- **9-point stencil** (±1 km): elevation, slope, aspect, **monsoon exposure**
  (cos(aspect − 245°) × sin(slope): +1 windward, −1 leeward), terrain ruggedness,
  **detrended roughness** (what's left after removing the plane — gullies, not
  slope), local relief.
- **Orographic profile** along the monsoon flow line, 2 km steps:
  **upwind barrier** (how far the highest ground within 40 km towards 245° rises
  above the point → rain shadow), **downwind rise** (terrain rising ahead within
  16 km → forced ascent, heavy rain), **upwind max elevation**.
- **Distance to coast** (km) from the Natural Earth coastline.

Checked on real places: Chiplun (windward foot) has a large rise ahead,
Mahabaleshwar (crest) no barrier, Satara/Phaltan (lee) a 300-380 m barrier.

---

## 8. Feature tables and leakage control (`features/build.py`, `train.py`)

- **Grid**: ERA5 points every 0.15° inside the blocks (MH 305, KA 180).
- **Perfect-prognosis coarsening**: for each block and day, the **block value**
  is the mean of the block's grid points. The model learns to recover each
  point's value from the block value plus terrain — a problem we can check,
  because the fine values are known.
- **20 features** (`numerics.FEATURE_COLUMNS`): 10 terrain columns + block value,
  elevation anomaly vs block, block mean/spread of elevation, exposure anomaly,
  block mean exposure, lapse-rate prior, day-of-year sin/cos, monsoon flag.
- **Holdouts**: test = the test seasons (date ranges, so the Oct-May dry season
  can cross a year); validation = 20% of *whole blocks* (stable SHA-256 hash).
- **`assert_no_leakage`** runs before every fit: no block in both train and
  validation, no shared date between train and test, and a ≥3-day gap (weather
  is autocorrelated day to day).

---

## 9. Models (`models/downscaler.py`)

- **Target = anomaly.** Additive variables: `local − block`. Rain and wind:
  `log1p(local) − log1p(block)` (heavy-tailed, never negative).
- **Quantile LightGBM** per variable at τ = 0.1, 0.5, 0.9 (early stopping on the
  validation blocks). Crossing quantiles are sorted.
- **Rain is two-stage**: a binary classifier for a rainy day (≥2.5 mm),
  isotonic-calibrated on validation data, plus amount quantiles trained on wet
  days only. The served distribution is the mixture: below the dry probability
  the quantile is 0 — so one panchayat can be dry while its neighbour is wet.
- Conservative trees (31 leaves, ≥40 rows per leaf, L2) so the model cannot
  memorise locations.

---

## 10. From raw prediction to served value (`finalize.py`)

1. **Reconcile** to the official block value, area-weighted:
   additive shift for temperature/humidity; multiplicative for wind; for rain,
   scale the if-wet amounts so the **expected** rain Σ w·P(wet)·amount equals the
   block value (matching medians piled a 1.9 mm block into one 28 mm panchayat).
2. **Support score** (0-1): 0.6 × terrain similarity to the training data
   (Mahalanobis distance, scaled by the chi-square distribution so typical
   terrain scores high in 10-D) + 0.4 × gauge proximity (0 beyond 50 km) −
   a tier penalty. Panchayat output (T3) is capped at "moderate".
   Labels: high ≥ 0.70, moderate ≥ 0.40, low below.
3. **Range**: widen the 10-90% interval around the median by up to 2× for low
   support, then by the **point-scale factor** fitted at gauges (rain, Tmax,
   Tmin), so the published 80% range covers ~80% of real gauge readings.
   Humidity and wind (no gauges) use a fixed ×1.35.
4. Clamp rain and wind at zero.

---

## 11. Advice (`app/services/advisory.py`)

Deterministic rules with named thresholds (tunable by an agronomist):

| Activity | Avoid when | Take care when |
|---|---|---|
| Pesticide spraying | rain chance ≥40%, or wind ≥20 km/h | rain chance ≥20% or wind ≥15 km/h |
| Irrigation | ≥10 mm expected | 3-10 mm expected |
| Harvesting | rain chance ≥35% or ≥5 mm | — |
| Fertiliser | ≥25 mm (washes off) | very little rain (irrigate after) |
| Fungal disease watch | — | humidity ≥85% at 18-30 °C |
| Heavy-rain preparedness | upper range ≥115.5 mm | upper range ≥64.5 mm |

**Asymmetric cost**: when support is low, irreversible actions (spraying,
fertiliser, harvest) are downgraded from *go ahead* to *take care*; a warning is
never softened. Every advisory has a headline and an always-present uncertainty
statement.

---

## 12. Evaluation (`evaluate/`)

| Tier | Question | Data |
|---|---|---|
| **T1** | Does it recover the fine grid from the block value? | held-out seasons, dense grid |
| **T2** | Is it closer to real gauges than the block value? | 4 modern gauges, test seasons |
| **T2 historical** | Same, with enough gauges to test significance | ~100 gauges per state, 1960 monsoon |
| **Transfer** | Does a Maharashtra model work in Karnataka? | KA test seasons, MH models |

- **Baselines**: naive block copy (the bar), IDW of block values, lapse-rate
  correction (temperature).
- **Metrics**: MAE skill vs each baseline; 90% cluster-bootstrap CI (resampling
  whole blocks or gauges); interval coverage (target 0.80); PIT; Brier score for
  rain occurrence vs climatology and vs the naive block wet/dry call; **served**
  skill after reconciliation (what the API really returns).
- **Honesty rules**: no "significant" verdict with fewer than 8 gauges; losses
  are reported like wins.
- **Point-scale calibration**: fitted on the 1958 gauge season (fallback: the
  training seasons' modern gauges), written to `scale_calibration.json`, then
  evaluated on separate seasons.

Outputs: `reports/evaluation_<region>.md|json` and
`reports/evaluation_ka_ghats_from_mh_ghats.*` (transfer).

---

## 13. Serving

**Bundle** (`serve_bundle/<region>/`, ~17 MB for Maharashtra):
`manifest.json` (per-variable feature order, calibration factors, support model,
trained months), `models.npz` (flattened trees + isotonic thresholds),
`blocks.json` (block stats + grid points; blocks too small for a grid point
borrow their 3 nearest), `panchayats/<block>.json` (GeoJSON simplified to ~30 m
+ precomputed terrain), `history/<block>.json` (replay values).

**Trees** (`serve/trees.py`): every node of every tree becomes an array entry;
all rows walk all trees at once, one depth level per numpy step. Matches
LightGBM to ~1e-15, including missing-value routing.

**Runtime** (`serve/runtime.py`): loads a region's bundle lazily, picks the
block value (**officer's bulletin → replay history → live forecast**), builds
features, evaluates, finalises, writes advice. Largest block (Patan, 257 units):
~100 ms; responses gzip ~20× (1.18 MB → 53 KB).

**API** (`app/main.py`):

| Endpoint | Returns |
|---|---|
| `GET /api/health` | status, served regions, model version |
| `GET /api/regions` | regions, served flag, replay windows, live window |
| `GET /api/blocks?region=` | blocks with unit counts |
| `GET /api/blocks/{id}/panchayats` | outlines (GeoJSON) + unit type |
| `GET /api/blocks/{id}/forecast?date=` | full forecast for every unit |
| `POST /api/blocks/{id}/forecast` | same, from an officer-supplied block bulletin |
| `GET /api/evaluation`, `/api/evaluation/reports` | skill tables, full reports |

Each panchayat's variable carries `value`, `block_value`, `anomaly`,
`confidence {lower, upper, support, support_label, support_score, tier,
tier_note, nearest_gauge_km}` and, for rain, `rain_probability`. Errors are
plain sentences: 404 unknown block, 422 unservable date (with the valid dates),
503 region not served / offline without data.

**Deployment.** Vercel's FastAPI preset finds the app through
`[tool.vercel] entrypoint`; base dependencies are runtime-only (~83 MB); the
built dashboard is mounted and promoted to the CDN. A test in a fresh
interpreter fails if the serving path ever imports pandas, LightGBM, SciPy or
GeoPandas.

---

## 14. Runbook

```bash
pip install -e ".[serve,pipeline,dev]"
python -m backend.pipeline.build_base --region mh_ghats           # geography + gauges
python -m backend.pipeline.fetch --region mh_ghats --region ka_ghats   # weather (days; resumes)
python -m backend.pipeline.train --region mh_ghats --available-only
python -m backend.pipeline.evaluate.run --region mh_ghats
python -m backend.pipeline.evaluate.run --region ka_ghats --model-region mh_ghats   # transfer
python -m backend.serve.export --region mh_ghats --region ka_ghats
uvicorn backend.app.main:app --port 8000
pytest && ruff check backend/
```

---

## 15. Tests worth knowing

- **Parity**: runtime == pipeline predictor for all five variables (`test_api.py`);
  numpy trees == LightGBM incl. NaN routing (`test_trees.py`); numpy chi-square ==
  SciPy (`test_reconcile_uncertainty.py`).
- **Leakage and seasons**: block/date/embargo assertions (`test_features.py`);
  gauge seasons never overlap training (`test_config.py`).
- **Physics sign checks**: windward vs leeward exposure, rain shadow behind a
  ridge, higher panchayat is colder (`test_terrain.py`, `test_api.py`).
- **Honesty**: overconfident intervals are caught by coverage/PIT
  (`test_metrics_baselines.py`); low support never softens a warning
  (`test_advisory.py`).
- **Import boundary**: the served app imports no training library
  (`test_serving_imports.py`).

---

## 16. Limitations (the same list the README and app show)

1. Panchayat-level (T3) values are inference: no panchayat-scale measurements exist.
2. ~5% of villages have no LGD match and are grouped into labelled clusters.
3. Models learn from a reanalysis (ERA5), not IMD's operational forecast.
4. Modern gauges are scarce; the ~100-gauge test uses 1960.
5. Each state needs its own training (rain amounts did not transfer).
6. Humidity and wind have no gauge validation (fixed range widening).

## 17. Glossary

**Block**: sub-district unit that official forecasts are issued for.
**Gram panchayat (GP)**: village-level local government unit; FieldCast's output unit.
**Anomaly**: panchayat value minus block value. **Reconciliation**: adjusting
panchayat values so their area-weighted mean equals the block value.
**Support**: how familiar the panchayat's terrain is to the model and how near a
gauge is. **Tier**: which evidence backs a number (T1 grid, T2 gauge, T3 inferred).
**Skill**: 1 − MAE(model) / MAE(baseline); > 0 beats the baseline.
**Coverage**: share of real observations inside the published 80% range.

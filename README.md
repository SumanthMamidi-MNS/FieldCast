# Panchayat-Level Weather Downscaling (SIH26074)

Downscales block-level weather forecasts to **panchayat level** for
agro-meteorological advisories. Every value carries a **predictive interval**, a
**validation tier**, and a **plain-language confidence label**. The advice
becomes more cautious where the system knows less.

> Pilot: 7 districts of Maharashtra across the Western Ghats (coastal Raigad → Ghats
> crest → Marathwada rain shadow). 86 blocks, 1,955 panchayat-proxy units built from
> 11,740 real village boundaries.

---

## Why this is not an interpolation problem

Standard downscaling assumes the fine field is a smooth function of the coarse
one. Rainfall is not smooth: a windward slope can get a downpour while the leeward
village a few km away stays dry. Real panchayat-scale ground truth barely exists.
So the design goal is **the panchayat value *and* how far to trust it**.

| Design choice | Why |
|---|---|
| Predict the **anomaly** from the block value, not the absolute value | The system can only refine the official forecast; if it learns nothing, it degrades exactly to "copy the block value" |
| **Two-stage rainfall** (calibrated wet/dry classifier + amount quantiles) | A single regressor smears drizzle over every panchayat; two stages allow "dry here, wet next door" |
| **Monsoon exposure** covariate (slope aspect against the 245° SW monsoon flow) | Separates windward from rain-shadow slopes, which elevation alone cannot |
| **Epistemic support score** (terrain similarity to training data + distance to a real gauge) | Tree models extrapolate with false confidence; low support widens the interval and downgrades the advice |
| **Block-mean reconciliation** | The area-weighted panchayat mean always equals the official block value, so the agency's own forecast is never contradicted |
| **Asymmetric-cost advisories** | Under low confidence, irreversible operations (spraying, fertiliser, harvest) move from *proceed* to *caution*, never the reverse |

## What is validated and what is inferred

| Tier | Claim | Evidence |
|---|---|---|
| **T1** | Block → ~16 km grid | Held-out 2023 monsoon, dense ERA5 truth, whole blocks held out |
| **T2** | → real gauge | 9 GHCN rain gauges never used in training |
| **T3** | → panchayat | **Not validated**: no panchayat-scale truth exists. Physically-informed inference; interval inflated ×1.35 and labelled as such in every response |

## Results

Skill = 1 − MAE(model) / MAE(naive block copy); positive beats naive. 90% CIs are
cluster bootstraps over blocks (T1) or gauges (T2). Full tables:
`reports/evaluation_mh_ghats.md` and `reports/evaluation_ka_transfer_from_mh_ghats.md`.

**Maharashtra, held-out 2023 monsoon (T1, 37,210 cell-days, 86 blocks)**

| Variable | Skill vs naive | 90% CI | vs lapse-rate | 80%-interval coverage |
|---|---:|---|---:|---:|
| Max temperature | **+0.46** | [0.41, 0.49] | +0.22 | 0.88 |
| Min temperature | **+0.62** | [0.57, 0.67] | +0.32 | 0.88 |
| Humidity | +0.18 | [0.15, 0.20] | – | 0.89 |
| Wind | +0.14 | [0.11, 0.16] | – | 0.94 |
| Rainfall amount | +0.06 (served: +0.02) | [−0.03, 0.14]: **not significant** | – | 0.71 |
| Rain occurrence (≥2.5 mm) | Brier **0.058** vs 0.096 naive | | | |

**Real gauges (T2, 2023, never used in training; only 4 gauges, so significance is not testable)**

| Variable | Skill vs naive | vs lapse-rate | Coverage |
|---|---:|---:|---:|
| Max temperature | +0.54 | **−0.08 (loses)** | 0.90 |
| Min temperature | +0.43 | **−0.25 (loses)** | 0.82 |
| Rainfall amount | +0.04 | – | 0.74 |
| Rain occurrence | Brier **0.190** vs 0.265 naive (28% better) | | |

**Transfer to Karnataka (models never saw it)**

Rain occurrence and temperature transfer (occurrence Brier 0.079 vs 0.110 naive;
Tmax +0.21, Tmin +0.37). **Rainfall amount does not: it is 18–25% worse than
naive.** The API therefore serves only regions with their own trained models.

### What this means in plain terms

- **Strongest result:** the *rain / no-rain* call per panchayat, which drives
  spraying and harvest advice, is clearly better than the block forecast. This
  holds at real gauges and in a region the model never saw.
- **Temperature** refinement is large and real on the grid, but at point gauges a
  simple elevation (lapse-rate) correction does as well. The model adds little
  beyond physics there.
- **Rainfall amounts** are not reliably better than the block value. The system
  shows them with wide intervals and says so rather than implying precision.
- **Intervals** were calibrated on 2022 gauge-days and checked on 2023: gauge
  coverage is 0.74–0.90 against a 0.80 target.

## Running it

```bash
python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev]"
cd frontend && npm install && cd ..
```

Build data, train, and evaluate. This needs the network the first time; everything is cached after that:

```bash
python -m backend.pipeline.build_base --region mh_ghats
python -m backend.pipeline.train --region mh_ghats
python -m backend.pipeline.evaluate.run --region mh_ghats
```

Serve:

```bash
uvicorn backend.app.main:app --port 8000
cd frontend && npm run dev          # http://localhost:5173
```

Offline (after one warm run): set `DOWNSCALE_OFFLINE=1`.

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/blocks` | Blocks with panchayat counts |
| `GET /api/blocks/{id}/panchayats` | Panchayat outlines (GeoJSON) |
| `GET /api/blocks/{id}/forecast?date=` | Downscaled forecast: historical replay (Jun–Sep 2022/2023) or live (yesterday to +15 days) |
| `POST /api/blocks/{id}/forecast` | Downscale an **official block forecast you supply** (e.g. an IMD bulletin) |
| `GET /api/evaluation` | Model vs naive skill table |

## Data (all public, no API keys)

Open-Meteo (ERA5 reanalysis blend, forecast, elevation) · GADM 4.1 (blocks) ·
datameet village boundaries · NOAA GHCN-Daily (gauges).

## Limitations, stated plainly

1. Panchayat-scale (T3) values are inference, not measurement.
2. Panchayat units are clusters of ~6 real villages, not official panchayat boundaries.
3. Training targets come from a reanalysis, not an IMD operational product.
   The API accepts IMD block values as input, but the model was not trained on them.
4. Only 9 recent quality-screened gauges exist in the region, so gauge results carry wide confidence intervals.
5. Trained on monsoon seasons only (free API budget). Out-of-season requests are
   served, with confidence halved and a disclosure.
7. **Retrain per region.** In a region it was not trained on, rainfall-amount
   output was worse than simply using the block value (Karnataka test).
6. The distance-to-coast covariate is only valid for the peninsular west coast.

See `docs/architecture.md` for the full design and `docs/decisions.md` for the rationale behind each choice.

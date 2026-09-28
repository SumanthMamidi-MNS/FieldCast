# Evaluation — ka_ghats

Models trained on: `ka_ghats` · generated 2026-09-28T12:46:51

Skill = 1 - MAE(model)/MAE(naive block copy). Positive beats naive. CI is a 90% cluster bootstrap (blocks at T1, gauges at T2). Coverage is for the published 80% interval (target ≈ 0.80).

## T1 — held-out seasons, dense field (~16 km)

| Variable | n | MAE model | MAE naive | Skill | 90% CI | Served skill* | Coverage 80% | Verdict |
|---|---:|---:|---:|---:|---|---:|---:|---|
| Rainfall (mm) | 64,980 | 0.90 | 0.90 | 0.000 | [0.000, 0.000] | 0.000 | 0.91 | does NOT beat naive |
| Max temperature (°C) | 64,980 | 0.35 | 0.60 | 0.417 | [0.348, 0.489] | 0.420 | 0.89 | beats naive (significant) |
| Min temperature (°C) | 64,980 | 0.33 | 0.50 | 0.337 | [0.247, 0.424] | 0.339 | 0.85 | beats naive (significant) |
| Relative humidity (%) | 64,980 | 1.68 | 1.72 | 0.025 | [0.020, 0.031] | 0.025 | 0.91 | beats naive (significant) |
| Wind speed (km/h) | 64,980 | 1.00 | 1.27 | 0.217 | [0.174, 0.265] | 0.218 | 0.91 | beats naive (significant) |

*Served skill: after block-mean reconciliation, i.e. the value the API actually returns (T1 only; gauges are not a block).
- **Rainfall: block value served.** On validation data the served estimate did not beat the block value (skill -0.132), so FieldCast serves the official block value as the point estimate and uses the model for the range and the rain chance. The model alone would have scored -0.089 here.

Other baselines (skill of the model against each):

- Rainfall vs B1_idw: MAE 0.88, model skill -0.022
- Max temperature vs B1_idw: MAE 0.57, model skill 0.391
- Max temperature vs B2_lapse_rate: MAE 0.44, model skill 0.211
- Min temperature vs B1_idw: MAE 0.50, model skill 0.335
- Min temperature vs B2_lapse_rate: MAE 0.42, model skill 0.210
- Relative humidity vs B1_idw: MAE 1.56, model skill -0.077
- Wind speed vs B1_idw: MAE 1.22, model skill 0.183

Rainfall occurrence: Brier 0.038 vs naive-block 0.056, Brier skill vs climatology 0.805 (wet-day base rate 0.27).

## T2 — real gauges, held-out 2022-23 seasons (never used in training)

| Variable | n | MAE model | MAE naive | Skill | 90% CI | Served skill* | Coverage 80% | Verdict |
|---|---:|---:|---:|---:|---|---:|---:|---|
| Rainfall (mm) | 316 | 12.14 | 12.14 | 0.000 | [0.000, 0.000] | - | 0.78 | does NOT beat naive (only 3 gauges: significance not testable) |
| Max temperature (°C) | 765 | 1.85 | 1.88 | 0.015 | [-0.035, 0.081] | - | 0.86 | beats naive (only 3 gauges: significance not testable) |
| Min temperature (°C) | 836 | 1.15 | 1.25 | 0.087 | [0.024, 0.157] | - | 0.81 | beats naive (only 3 gauges: significance not testable) |

*Served skill: after block-mean reconciliation, i.e. the value the API actually returns (T1 only; gauges are not a block).
- **Rainfall: block value served.** On validation data the served estimate did not beat the block value (skill -0.132), so FieldCast serves the official block value as the point estimate and uses the model for the range and the rain chance. The model alone would have scored 0.007 here.

Other baselines (skill of the model against each):

- Max temperature vs B2_lapse_rate: MAE 1.66, model skill -0.113
- Min temperature vs B2_lapse_rate: MAE 1.17, model skill 0.020

Rainfall occurrence: Brier 0.256 vs naive-block 0.313, Brier skill vs climatology -0.030 (wet-day base rate 0.54).

## T2 (historical) — real gauges, 1960 monsoon (~100 gauges, never used in training)

| Variable | n | MAE model | MAE naive | Skill | 90% CI | Served skill* | Coverage 80% | Verdict |
|---|---:|---:|---:|---:|---|---:|---:|---|
| Rainfall (mm) | 12,149 | 11.15 | 11.15 | 0.000 | [0.000, 0.000] | - | 0.85 | does NOT beat naive |

*Served skill: after block-mean reconciliation, i.e. the value the API actually returns (T1 only; gauges are not a block).
- **Rainfall: block value served.** On validation data the served estimate did not beat the block value (skill -0.132), so FieldCast serves the official block value as the point estimate and uses the model for the range and the rain chance. The model alone would have scored 0.048 here.

Rainfall occurrence: Brier 0.285 vs naive-block 0.350, Brier skill vs climatology -0.150 (wet-day base rate 0.45).

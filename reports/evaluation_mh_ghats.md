# Evaluation — mh_ghats

Models trained on: `mh_ghats` · generated 2026-09-27T09:20:16

Skill = 1 - MAE(model)/MAE(naive block copy). Positive beats naive. CI is a 90% cluster bootstrap (blocks at T1, gauges at T2). Coverage is for the published 80% interval (target ≈ 0.80).

## T1 — held-out seasons, dense field (~16 km)

| Variable | n | MAE model | MAE naive | Skill | 90% CI | Served skill* | Coverage 80% | Verdict |
|---|---:|---:|---:|---:|---|---:|---:|---|
| Rainfall (mm) | 110,105 | 0.82 | 0.85 | 0.032 | [-0.046, 0.101] | -0.027 | 0.81 | beats naive (not significant) |
| Max temperature (°C) | 110,105 | 0.36 | 0.66 | 0.453 | [0.413, 0.488] | 0.455 | 0.91 | beats naive (significant) |
| Min temperature (°C) | 110,105 | 0.40 | 0.58 | 0.308 | [0.262, 0.352] | 0.312 | 0.89 | beats naive (significant) |
| Relative humidity (%) | 110,105 | 1.53 | 1.95 | 0.219 | [0.180, 0.256] | 0.220 | 0.89 | beats naive (significant) |
| Wind speed (km/h) | 110,105 | 1.36 | 1.39 | 0.022 | [0.017, 0.026] | 0.021 | 0.92 | beats naive (significant) |

*Served skill: after block-mean reconciliation, i.e. the value the API actually returns (T1 only; gauges are not a block).

Other baselines (skill of the model against each):

- Rainfall vs B1_idw: MAE 0.84, model skill 0.017
- Max temperature vs B1_idw: MAE 0.66, model skill 0.455
- Max temperature vs B2_lapse_rate: MAE 0.44, model skill 0.178
- Min temperature vs B1_idw: MAE 0.58, model skill 0.313
- Min temperature vs B2_lapse_rate: MAE 0.47, model skill 0.161
- Relative humidity vs B1_idw: MAE 1.78, model skill 0.145
- Wind speed vs B1_idw: MAE 1.38, model skill 0.015

Rainfall occurrence: Brier 0.028 vs naive-block 0.043, Brier skill vs climatology 0.841 (wet-day base rate 0.22).

## T2 — real gauges, held-out 2022-23 seasons (never used in training)

| Variable | n | MAE model | MAE naive | Skill | 90% CI | Served skill* | Coverage 80% | Verdict |
|---|---:|---:|---:|---:|---|---:|---:|---|
| Rainfall (mm) | 471 | 11.61 | 12.18 | 0.047 | [0.002, 0.111] | - | 0.80 | beats naive (only 4 gauges: significance not testable) |
| Max temperature (°C) | 619 | 1.11 | 1.64 | 0.325 | [0.081, 0.446] | - | 0.88 | beats naive (only 4 gauges: significance not testable) |
| Min temperature (°C) | 1,270 | 1.50 | 1.72 | 0.127 | [0.014, 0.224] | - | 0.77 | beats naive (only 4 gauges: significance not testable) |

*Served skill: after block-mean reconciliation, i.e. the value the API actually returns (T1 only; gauges are not a block).

Other baselines (skill of the model against each):

- Max temperature vs B2_lapse_rate: MAE 1.31, model skill 0.151
- Min temperature vs B2_lapse_rate: MAE 1.27, model skill -0.179

Rainfall occurrence: Brier 0.222 vs naive-block 0.293, Brier skill vs climatology 0.110 (wet-day base rate 0.53).

## T2 (historical) — real gauges, 1960 monsoon (~100 gauges, never used in training)

_Not evaluable for this region (no data)._

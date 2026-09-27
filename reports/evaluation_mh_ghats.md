# Evaluation — mh_ghats

Models trained on: `mh_ghats` · generated 2026-09-27T07:59:44

Skill = 1 - MAE(model)/MAE(naive block copy). Positive beats naive. CI is a 90% cluster bootstrap (blocks at T1, gauges at T2). Coverage is for the published 80% interval (target ≈ 0.80).

## T1 — held-out seasons, dense field (~16 km)

| Variable | n | MAE model | MAE naive | Skill | 90% CI | Served skill* | Coverage 80% | Verdict |
|---|---:|---:|---:|---:|---|---:|---:|---|
| Rainfall (mm) | 110,105 | 0.82 | 0.85 | 0.034 | [-0.040, 0.100] | -0.017 | 0.82 | beats naive (not significant) |
| Max temperature (°C) | 110,105 | 0.39 | 0.66 | 0.407 | [0.363, 0.444] | 0.411 | 0.91 | beats naive (significant) |
| Min temperature (°C) | 110,105 | 0.44 | 0.58 | 0.236 | [0.193, 0.273] | 0.238 | 0.70 | beats naive (significant) |
| Relative humidity (%) | 110,105 | 1.76 | 1.95 | 0.099 | [0.075, 0.122] | 0.101 | 0.85 | beats naive (significant) |
| Wind speed (km/h) | 110,105 | 1.32 | 1.39 | 0.049 | [0.038, 0.061] | 0.050 | 0.91 | beats naive (significant) |

*Served skill: after block-mean reconciliation, i.e. the value the API actually returns (T1 only; gauges are not a block).

Other baselines (skill of the model against each):

- Rainfall vs B1_idw: MAE 0.84, model skill 0.019
- Max temperature vs B1_idw: MAE 0.66, model skill 0.411
- Max temperature vs B2_lapse_rate: MAE 0.44, model skill 0.110
- Min temperature vs B1_idw: MAE 0.58, model skill 0.241
- Min temperature vs B2_lapse_rate: MAE 0.47, model skill 0.074
- Relative humidity vs B1_idw: MAE 1.78, model skill 0.014
- Wind speed vs B1_idw: MAE 1.38, model skill 0.043

Rainfall occurrence: Brier 0.028 vs naive-block 0.043, Brier skill vs climatology 0.841 (wet-day base rate 0.22).

## T2 — real gauges, held-out 2022-23 seasons (never used in training)

| Variable | n | MAE model | MAE naive | Skill | 90% CI | Served skill* | Coverage 80% | Verdict |
|---|---:|---:|---:|---:|---|---:|---:|---|
| Rainfall (mm) | 471 | 11.32 | 12.18 | 0.070 | [0.010, 0.112] | - | 0.74 | beats naive (only 4 gauges: significance not testable) |
| Max temperature (°C) | 619 | 1.11 | 1.64 | 0.326 | [0.085, 0.444] | - | 0.90 | beats naive (only 4 gauges: significance not testable) |
| Min temperature (°C) | 1,270 | 1.40 | 1.72 | 0.185 | [-0.052, 0.361] | - | 0.62 | beats naive (only 4 gauges: significance not testable) |

*Served skill: after block-mean reconciliation, i.e. the value the API actually returns (T1 only; gauges are not a block).

Other baselines (skill of the model against each):

- Max temperature vs B2_lapse_rate: MAE 1.31, model skill 0.152
- Min temperature vs B2_lapse_rate: MAE 1.27, model skill -0.101

Rainfall occurrence: Brier 0.222 vs naive-block 0.293, Brier skill vs climatology 0.108 (wet-day base rate 0.53).

## T2 (historical) — real gauges, 1960 monsoon (~100 gauges, never used in training)

_Not evaluable for this region (no data)._

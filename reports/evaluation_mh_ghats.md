# Evaluation — mh_ghats

Models trained on: `mh_ghats` · generated 2026-09-27T11:12:22

Skill = 1 - MAE(model)/MAE(naive block copy). Positive beats naive. CI is a 90% cluster bootstrap (blocks at T1, gauges at T2). Coverage is for the published 80% interval (target ≈ 0.80).

## T1 — held-out seasons, dense field (~16 km)

| Variable | n | MAE model | MAE naive | Skill | 90% CI | Served skill* | Coverage 80% | Verdict |
|---|---:|---:|---:|---:|---|---:|---:|---|
| Rainfall (mm) | 110,105 | 0.85 | 0.85 | 0.000 | [0.000, 0.000] | 0.000 | 0.90 | does NOT beat naive |
| Max temperature (°C) | 110,105 | 0.37 | 0.66 | 0.441 | [0.401, 0.476] | 0.444 | 0.91 | beats naive (significant) |
| Min temperature (°C) | 110,105 | 0.41 | 0.58 | 0.283 | [0.240, 0.324] | 0.286 | 0.89 | beats naive (significant) |
| Relative humidity (%) | 110,105 | 1.57 | 1.95 | 0.194 | [0.156, 0.227] | 0.197 | 0.90 | beats naive (significant) |
| Wind speed (km/h) | 110,105 | 1.32 | 1.39 | 0.046 | [0.036, 0.056] | 0.045 | 0.92 | beats naive (significant) |

*Served skill: after block-mean reconciliation, i.e. the value the API actually returns (T1 only; gauges are not a block).
- **Rainfall: block value served.** On validation data the served estimate did not beat the block value (skill -0.074), so FieldCast serves the official block value as the point estimate and uses the model for the range and the rain chance. The model alone would have scored 0.053 here.

Other baselines (skill of the model against each):

- Rainfall vs B1_idw: MAE 0.84, model skill -0.015
- Max temperature vs B1_idw: MAE 0.66, model skill 0.444
- Max temperature vs B2_lapse_rate: MAE 0.44, model skill 0.161
- Min temperature vs B1_idw: MAE 0.58, model skill 0.288
- Min temperature vs B2_lapse_rate: MAE 0.47, model skill 0.131
- Relative humidity vs B1_idw: MAE 1.78, model skill 0.118
- Wind speed vs B1_idw: MAE 1.38, model skill 0.039

Rainfall occurrence: Brier 0.026 vs naive-block 0.043, Brier skill vs climatology 0.848 (wet-day base rate 0.22).

## T2 — real gauges, held-out 2022-23 seasons (never used in training)

| Variable | n | MAE model | MAE naive | Skill | 90% CI | Served skill* | Coverage 80% | Verdict |
|---|---:|---:|---:|---:|---|---:|---:|---|
| Rainfall (mm) | 471 | 12.18 | 12.18 | 0.000 | [0.000, 0.000] | - | 0.82 | does NOT beat naive (only 4 gauges: significance not testable) |
| Max temperature (°C) | 619 | 1.10 | 1.64 | 0.329 | [0.086, 0.448] | - | 0.89 | beats naive (only 4 gauges: significance not testable) |
| Min temperature (°C) | 1,270 | 1.42 | 1.72 | 0.176 | [0.019, 0.303] | - | 0.74 | beats naive (only 4 gauges: significance not testable) |

*Served skill: after block-mean reconciliation, i.e. the value the API actually returns (T1 only; gauges are not a block).
- **Rainfall: block value served.** On validation data the served estimate did not beat the block value (skill -0.074), so FieldCast serves the official block value as the point estimate and uses the model for the range and the rain chance. The model alone would have scored 0.036 here.

Other baselines (skill of the model against each):

- Max temperature vs B2_lapse_rate: MAE 1.31, model skill 0.155
- Min temperature vs B2_lapse_rate: MAE 1.27, model skill -0.113

Rainfall occurrence: Brier 0.225 vs naive-block 0.293, Brier skill vs climatology 0.097 (wet-day base rate 0.53).

## T2 (historical) — real gauges, 1960 monsoon (~100 gauges, never used in training)

_Not evaluable for this region (no data)._

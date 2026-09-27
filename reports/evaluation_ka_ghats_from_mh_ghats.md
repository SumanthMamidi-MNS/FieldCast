# Evaluation — ka_ghats

Models trained on: `mh_ghats` · generated 2026-09-27T11:49:19

Skill = 1 - MAE(model)/MAE(naive block copy). Positive beats naive. CI is a 90% cluster bootstrap (blocks at T1, gauges at T2). Coverage is for the published 80% interval (target ≈ 0.80).

## T1 — held-out seasons, dense field (~16 km)

| Variable | n | MAE model | MAE naive | Skill | 90% CI | Served skill* | Coverage 80% | Verdict |
|---|---:|---:|---:|---:|---|---:|---:|---|
| Rainfall (mm) | 64,980 | 0.90 | 0.90 | 0.000 | [0.000, 0.000] | 0.000 | 0.86 | does NOT beat naive |
| Max temperature (°C) | 64,980 | 0.48 | 0.60 | 0.201 | [0.118, 0.275] | 0.211 | 0.86 | beats naive (significant) |
| Min temperature (°C) | 64,980 | 0.41 | 0.50 | 0.180 | [0.112, 0.246] | 0.184 | 0.87 | beats naive (significant) |
| Relative humidity (%) | 64,980 | 1.74 | 1.72 | -0.008 | [-0.035, 0.015] | 0.010 | 0.86 | does NOT beat naive |
| Wind speed (km/h) | 64,980 | 1.27 | 1.27 | 0.005 | [-0.001, 0.011] | 0.007 | 0.90 | beats naive (not significant) |

*Served skill: after block-mean reconciliation, i.e. the value the API actually returns (T1 only; gauges are not a block).
- **Rainfall: block value served.** On validation data the served estimate did not beat the block value (skill -0.074), so FieldCast serves the official block value as the point estimate and uses the model for the range and the rain chance. The model alone would have scored -0.203 here.

Other baselines (skill of the model against each):

- Rainfall vs B1_idw: MAE 0.88, model skill -0.022
- Max temperature vs B1_idw: MAE 0.57, model skill 0.165
- Max temperature vs B2_lapse_rate: MAE 0.44, model skill -0.080
- Min temperature vs B1_idw: MAE 0.50, model skill 0.177
- Min temperature vs B2_lapse_rate: MAE 0.42, model skill 0.023
- Relative humidity vs B1_idw: MAE 1.56, model skill -0.114
- Wind speed vs B1_idw: MAE 1.22, model skill -0.038

Rainfall occurrence: Brier 0.040 vs naive-block 0.056, Brier skill vs climatology 0.796 (wet-day base rate 0.27).

## T2 — real gauges, held-out 2022-23 seasons (never used in training)

| Variable | n | MAE model | MAE naive | Skill | 90% CI | Served skill* | Coverage 80% | Verdict |
|---|---:|---:|---:|---:|---|---:|---:|---|
| Rainfall (mm) | 316 | 12.14 | 12.14 | 0.000 | [0.000, 0.000] | - | 0.89 | does NOT beat naive (only 3 gauges: significance not testable) |
| Max temperature (°C) | 765 | 1.69 | 1.88 | 0.101 | [0.008, 0.210] | - | 0.84 | beats naive (only 3 gauges: significance not testable) |
| Min temperature (°C) | 836 | 1.11 | 1.25 | 0.115 | [0.039, 0.200] | - | 0.81 | beats naive (only 3 gauges: significance not testable) |

*Served skill: after block-mean reconciliation, i.e. the value the API actually returns (T1 only; gauges are not a block).
- **Rainfall: block value served.** On validation data the served estimate did not beat the block value (skill -0.074), so FieldCast serves the official block value as the point estimate and uses the model for the range and the rain chance. The model alone would have scored 0.026 here.

Other baselines (skill of the model against each):

- Max temperature vs B2_lapse_rate: MAE 1.66, model skill -0.015
- Min temperature vs B2_lapse_rate: MAE 1.17, model skill 0.050

Rainfall occurrence: Brier 0.257 vs naive-block 0.313, Brier skill vs climatology -0.035 (wet-day base rate 0.54).

## T2 (historical) — real gauges, 1960 monsoon (~100 gauges, never used in training)

_Not evaluable for this region (no data)._

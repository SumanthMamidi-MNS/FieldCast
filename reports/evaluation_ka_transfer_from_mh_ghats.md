# Evaluation — ka_transfer

Models trained on: `mh_ghats` · generated 2026-09-26T17:51:28

Skill = 1 - MAE(model)/MAE(naive block copy). Positive beats naive. CI is a 90% cluster bootstrap (blocks at T1, gauges at T2). Coverage is for the published 80% interval (target ≈ 0.80).

## T1 — held-out season, dense field (~16 km)

| Variable | n | MAE model | MAE naive | Skill | 90% CI | Served skill* | Coverage 80% | Verdict |
|---|---:|---:|---:|---:|---|---:|---:|---|
| Rainfall (mm) | 21,960 | 2.14 | 1.81 | -0.181 | [-0.254, -0.126] | -0.250 | 0.72 | does NOT beat naive |
| Max temperature (°C) | 21,960 | 0.50 | 0.64 | 0.212 | [0.131, 0.284] | 0.225 | 0.80 | beats naive (significant) |
| Min temperature (°C) | 21,960 | 0.25 | 0.39 | 0.366 | [0.259, 0.450] | 0.377 | 0.80 | beats naive (significant) |
| Relative humidity (%) | 21,960 | 1.61 | 1.62 | 0.010 | [-0.017, 0.034] | 0.015 | 0.83 | beats naive (not significant) |
| Wind speed (km/h) | 21,960 | 1.39 | 1.41 | 0.016 | [-0.001, 0.033] | 0.026 | 0.87 | beats naive (not significant) |

*Served skill: after block-mean reconciliation, i.e. the value the API actually returns (T1 only; gauges are not a block).

Other baselines (skill of the model against each):

- Rainfall vs B1_idw: MAE 1.73, model skill -0.232
- Max temperature vs B1_idw: MAE 0.59, model skill 0.149
- Max temperature vs B2_lapse_rate: MAE 0.48, model skill -0.041
- Min temperature vs B1_idw: MAE 0.40, model skill 0.374
- Min temperature vs B2_lapse_rate: MAE 0.25, model skill 0.017
- Relative humidity vs B1_idw: MAE 1.42, model skill -0.132
- Wind speed vs B1_idw: MAE 1.29, model skill -0.076

Rainfall occurrence: Brier 0.079 vs naive-block 0.110, Brier skill vs climatology 0.680 (wet-day base rate 0.55).

## T2 — real GHCN rain gauges (never used in training)

| Variable | n | MAE model | MAE naive | Skill | 90% CI | Served skill* | Coverage 80% | Verdict |
|---|---:|---:|---:|---:|---|---:|---:|---|
| Rainfall (mm) | 235 | 13.68 | 13.69 | 0.001 | [-0.023, 0.014] | - | 0.83 | beats naive (only 3 gauges: significance not testable) |
| Max temperature (°C) | 238 | 2.64 | 2.84 | 0.072 | [0.012, 0.183] | - | 0.35 | beats naive (only 3 gauges: significance not testable) |
| Min temperature (°C) | 271 | 0.83 | 0.98 | 0.161 | [0.006, 0.377] | - | 0.71 | beats naive (only 3 gauges: significance not testable) |

*Served skill: after block-mean reconciliation, i.e. the value the API actually returns (T1 only; gauges are not a block).

Other baselines (skill of the model against each):

- Max temperature vs B2_lapse_rate: MAE 2.46, model skill -0.071
- Min temperature vs B2_lapse_rate: MAE 0.78, model skill -0.056

Rainfall occurrence: Brier 0.198 vs naive-block 0.234, Brier skill vs climatology 0.147 (wet-day base rate 0.63).

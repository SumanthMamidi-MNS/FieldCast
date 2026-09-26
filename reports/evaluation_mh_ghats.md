# Evaluation — mh_ghats

Models trained on: `mh_ghats` · generated 2026-09-21T19:23:42

Skill = 1 - MAE(model)/MAE(naive block copy). Positive beats naive. CI is a 90% cluster bootstrap (blocks at T1, gauges at T2). Coverage is for the published 80% interval (target ≈ 0.80).

## T1 — held-out season, dense field (~16 km)

| Variable | n | MAE model | MAE naive | Skill | 90% CI | Coverage 80% | Verdict |
|---|---:|---:|---:|---:|---|---:|---|
| Rainfall (mm) | 37,210 | 1.83 | 2.00 | 0.087 | [0.063, 0.109] | 0.93 | beats naive (significant) |
| Max temperature (°C) | 37,210 | 0.40 | 0.73 | 0.455 | [0.409, 0.492] | 0.88 | beats naive (significant) |
| Min temperature (°C) | 37,210 | 0.17 | 0.45 | 0.623 | [0.571, 0.668] | 0.88 | beats naive (significant) |
| Relative humidity (%) | 37,210 | 1.66 | 2.02 | 0.176 | [0.153, 0.197] | 0.89 | beats naive (significant) |
| Wind speed (km/h) | 37,210 | 1.29 | 1.49 | 0.136 | [0.109, 0.161] | 0.94 | beats naive (significant) |

Other baselines (skill of the model against each):

- Rainfall vs B1_idw: MAE 1.95, model skill 0.065
- Max temperature vs B1_idw: MAE 0.69, model skill 0.421
- Max temperature vs B2_lapse_rate: MAE 0.51, model skill 0.222
- Min temperature vs B1_idw: MAE 0.46, model skill 0.632
- Min temperature vs B2_lapse_rate: MAE 0.25, model skill 0.321
- Relative humidity vs B1_idw: MAE 1.75, model skill 0.051
- Wind speed vs B1_idw: MAE 1.43, model skill 0.099

Rainfall occurrence: Brier 0.026 vs naive-block 0.030, Brier skill vs climatology 0.655 (wet-day base rate 0.92).

## T2 — real GHCN rain gauges (never used in training)

| Variable | n | MAE model | MAE naive | Skill | 90% CI | Coverage 80% | Verdict |
|---|---:|---:|---:|---:|---|---:|---|
| Rainfall (mm) | 347 | 13.24 | 13.57 | 0.024 | [0.008, 0.084] | 0.78 | beats naive (only 4 gauges: significance not testable) |
| Max temperature (°C) | 193 | 0.95 | 2.04 | 0.536 | [0.093, 0.649] | 0.90 | beats naive (only 4 gauges: significance not testable) |
| Min temperature (°C) | 411 | 0.67 | 1.16 | 0.425 | [0.103, 0.524] | 0.82 | beats naive (only 4 gauges: significance not testable) |

Other baselines (skill of the model against each):

- Max temperature vs B2_lapse_rate: MAE 0.88, model skill -0.076
- Min temperature vs B2_lapse_rate: MAE 0.53, model skill -0.246

Rainfall occurrence: Brier 0.181 vs naive-block 0.193, Brier skill vs climatology -0.176 (wet-day base rate 0.81).

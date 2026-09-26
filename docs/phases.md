# Phases — Panchayat-Level Weather Downscaling

Execution plan toward completion, not a calendar. A phase is done when its
success criterion is **demonstrated**, not when the code is written.

Status: `[ ]` not started · `[~]` in progress · `[x]` done & verified

---

## Phase 0 — Foundation `[x]`
- [x] Problem analysed; every data source verified reachable before designing
- [x] Repo, feature branch `feat/downscaling-system`, .gitignore
- [x] architecture.md (derived requirements + design), decisions.md

## Phase 1 — Data layer `[x]`
- [x] Adapters: Open-Meteo (archive/forecast/elevation), GADM, datameet, GHCN
- [x] Disk cache, retry, offline mode, hourly/minutely pacing, budget error
- [x] MH: 86 blocks, 11,740 villages → 1,955 panchayat proxies, 9 screened gauges
- [x] KA: 48 blocks, 8 screened gauges

## Phase 2 — Terrain & features `[x]`
- [x] 9-point terrain stencil incl. monsoon exposure and detrended roughness
- [x] Whole-block + whole-season holdouts; date-level leakage assertion with embargo

## Phase 3 — Models `[x]`
- [x] Anomaly formulation; two-stage rain (IMD 2.5 mm rainy day); quantile models
- [x] Expected-value rain reconciliation; chi-square support; T3 cap at moderate
- [x] Full MH training (2022 train / 2023 test, 305 grid points)

## Phase 4 — Evaluation `[x]`
- [x] T1 (held-out season) and T2 (real gauges) vs naive, IDW, lapse-rate
- [x] Point-scale interval calibration fitted on 2022 gauges, checked on 2023
- [x] Karnataka transfer test
- [x] Reports committed: `reports/evaluation_mh_ghats.md`,
      `reports/evaluation_ka_transfer_from_mh_ghats.md`

**Outcome:** beats naive at T1 for temperature, humidity, wind and rain
occurrence (significant); rain amount not significant; at gauges temperature ≈
lapse-rate; rain amount does not transfer to KA. All reported in README.

## Phase 5 — API `[x]`
- [x] Health, blocks, panchayat geometry, forecast (GET replay/live, POST official input), evaluation
- [x] Live check: 25-panchayat block in 0.4 s; offline demo path verified; clear 503s

## Phase 6 — Dashboard `[x]`
- [x] Map fitted to block, collision-free labels, confidence texture, detail panel,
      date picker, official-bulletin form, comparison view
- [x] Checked in browser at 1280 and 375 px (59 vitest tests, lint + build clean)

## Phase 7 — Hardening & delivery `[x]`
- [x] README with results, what is validated vs inferred, limitations
- [x] Offline demo path verified (`DOWNSCALE_OFFLINE=1`)
- [x] Full lint + test, both stacks; decisions.md and memory.md current

---

## Remaining / optional next work
1. Warm terrain for the demo blocks before a presentation
   (`python -m backend.app.warm --limit 10`, ~1 API-budget hour).
2. Add the 2021 monsoon to training when budget allows (the cache makes it additive).
3. Train a Karnataka model if KA is to be served; the transfer test shows rain
   amounts need per-region training.
4. Decide whether temperature output should fall back to the lapse-rate
   correction below grid scale (it matched the model at gauges).
5. Docker packaging was planned but not built (see memory.md).

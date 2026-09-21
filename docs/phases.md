# Phases — Panchayat-Level Weather Downscaling

Execution plan toward completion, not a calendar. A phase is done when its
success criterion is **demonstrated**, not when the code is written.

Status: `[ ]` not started · `[~]` in progress · `[x]` done & verified

---

## Phase 0 — Foundation `[x]`
- [x] Problem analysed; every data source verified reachable before designing
- [x] Repo, feature branch `feat/downscaling-system`, .gitignore
- [x] architecture.md (derived requirements + design), decisions.md
- [x] Python venv + deps; pytest + ruff green

## Phase 1 — Data layer `[x]`
- [x] Adapters: Open-Meteo (archive/forecast/elevation), GADM, datameet, GHCN
- [x] Disk cache, retry/backoff, offline mode, rate-limit pacing + budget error
- [x] 86 blocks (7 MH districts); 11,740 real villages → 1,955 panchayat proxies
- [x] GHCN index: 185 stations in bbox, 9 pass the record-quality screen

## Phase 2 — Terrain & features `[x]`
- [x] 9-point terrain stencil: elevation, slope, aspect, monsoon exposure, TRI,
      detrended roughness, relief; distance to coast
- [x] Block context + temporal features; whole-block + whole-season holdouts
- [x] Date-level leakage assertion with 3-day embargo (tested)

## Phase 3 — Models `[~]`
- [x] Anomaly formulation; two-stage calibrated rainfall; quantile models
- [x] Reconciliation, epistemic support, interval inflation (tested)
- [x] End-to-end smoke run on live data (1 season, 108 points) — all 5 variables trained
- [~] Full MH training run (2022 train / 2023 test, 305 points) — running,
      paced to the Open-Meteo hourly budget

## Phase 4 — Evaluation `[~]`
- [x] Baselines B0 naive, B1 IDW, B2 lapse-rate; metrics incl. coverage, PIT, Brier
- [x] Evaluation runner: T1 held-out season + T2 real gauges, cluster-bootstrap CIs
- [ ] Run it on the full MH models; commit the report with wins and losses
- [ ] Karnataka transfer test (needs KA base build + one API-budget day)

**Success:** a published table of skill vs naive at real gauges, losses reported
exactly like wins.

## Phase 5 — API `[x]`
- [x] FastAPI: health, blocks, panchayat geometry, forecast (GET replay/operational,
      POST official block input), evaluation
- [x] Every value: median + interval + tier + support label + advisory
- [x] 13 API tests on a synthetic region (differentiation, reconciliation, season)
- [ ] Live check against the trained MH models

## Phase 6 — Dashboard `[~]`
- [x] Map, confidence texture, detail panel, interval band, comparison view, mock API
      (44 vitest tests, lint clean)
- [~] main entry, TS fix, wiring to the real API, date picker, official-input form
      — frontend agent working

## Phase 7 — Hardening & delivery `[ ]`
- [ ] README: validated vs inferred, limitations, how to run
- [ ] Offline demo path verified (`DOWNSCALE_OFFLINE=1`)
- [ ] Full lint + test, both stacks; memory.md entry

---

## Next up
1. Finish the full MH training run, then run the evaluation and commit the report.
2. Frontend wired to the live API; run the app and verify in a browser.
3. Build the Karnataka base, train its grid, run the transfer evaluation.
4. README and final verification.

## Notes
- Open-Meteo free tier (5k/hour, 10k/day) is the pacing constraint on anything
  that fetches weather; runs resume from cache after a budget stop.
- Phase 4 cannot be compromised: if the model does not beat naive at gauges, we
  report it and diagnose, not tune until the number looks good.

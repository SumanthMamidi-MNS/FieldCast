# Phases — FieldCast (panchayat-level weather downscaling)

Execution plan toward completion, not a calendar. A phase is done when its
success criterion is **demonstrated**, not when the code is written.

Status: `[ ]` not started · `[~]` in progress · `[x]` done & verified

---

## Round 1 — working system `[x]`
Data layer, terrain, two-stage models, evaluation (T1/T2/transfer), API,
first dashboard. Outcome recorded in the README; limitations listed below were
the input to Round 2.

## Round 2 — remove limitations, redesign, deploy on Vercel

### A. Limitations
- [x] Terrain from keyless AWS Terrain Tiles (no quota, offline-capable), validated r=0.9985
- [x] Rain-shadow profile features (upwind barrier, downwind rise, upwind max elevation)
- [x] Real coastline distance (Natural Earth) instead of a west-coast table
- [x] Whole-year seasons (monsoon + dry) with season-based holdouts → no out-of-season penalty
- [x] Historical gauge test design: ~100 gauges per state (calibration 1958, test 1960)
- [x] Real gram panchayats from LGD when the export is present (code + tests)
- [x] LGD exports received: 8,072 (MH) and 1,730 (KA) real gram panchayats, 94% / 96% of villages matched
- [~] Weather history fetch, value-ordered (test → recent → 1958/1960 gauges → 2019-20); resumes itself
      - [x] test seasons both states; 2022 + 2021 monsoons and 2021-22 dry season, both states; MH 1958
      - [ ] MH 1960; KA 1958 and 1960 (paused by the Open-Meteo daily quota); 2019-20 monsoons
- [x] Retrain MH with new features and seasons (2021-22 monsoons + 2021-22 dry season)
- [x] Train KA's own model
- [x] Serving policy: a variable that loses to the block value on validation serves the block value
- [x] Rain as a chance + if-it-rains range (wet-day calibrated: 0.80 MH / 0.81 KA coverage); area-scale heavy-rain warnings
- [x] Evaluations: T1, T2 modern, MH→KA transfer
- [ ] T2 historical (~100 gauges, recalibrate on 1958, test on 1960)
- [x] Export serving bundles (MH + KA, real gram panchayats); README results

### B. Frontend
- [x] FieldCast brand (name, logo, favicon, tokens), app shell, control bar
- [x] Forecast page: block summary, village list, village detail, print advisory
- [x] Block-relative colour scales, collision-free labels, confidence textures
- [x] Evidence and How it works pages
- [x] Replay dates from the API, consistent number formatting, wet-day rain scale
- [x] Verified at 1440, 1280, 820 and 375 px; 149 vitest tests, lint + build clean
- [x] Forecast page scroll lock (desktop), gram-panchayat terminology, 1960-gauge evidence, 257-unit performance

### C. Vercel
- [x] Numpy-only serving runtime + committed serving bundle (parity with LightGBM ~1e-15)
- [x] Runtime-only dependencies (83 MB) vs pipeline extra; import-boundary test
- [x] `vercel.json`, `.vercelignore`, `[tool.vercel] entrypoint`, `.python-version`
- [x] Verified in a clean runtime-only environment: 57 ms cold / 13 ms warm per forecast
- [ ] First deployment (owner's Vercel account)

### D. Release
- [x] docs/frontend.md and docs/backend.md knowledge docs
- [x] .gitignore, MIT licence, full README with badges, results and flowchart
- [x] Project flowchart (docs/flowchart/, HTML source + PNG)
- [x] New logo and two-tone wordmark
- [x] History scrubbed of local AI setup files; pushed to GitHub as main
- [ ] LinkedIn post and GitHub About text (after the 1960 gauge results)

---

## Next up
1. Quota resets → MH 1960, KA 1958/1960 land → recalibrate on 1958, ~100-gauge test on 1960,
   re-export, update README + flowchart numbers, push a follow-up commit.
2. LinkedIn post and About text with the final numbers.
3. Owner: first Vercel deployment.

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
- [x] Historical gauge test design: ~100 gauges per state in 1958-61 (calibration 1958-59, test 1960-61)
- [x] Real gram panchayats from LGD when the export is present (code + tests)
- [ ] **LGD export files** — CAPTCHA-protected; needs a manual download (owner)
- [~] Weather history fetch: 5 monsoons + 2 dry seasons + 4 historical monsoons, both states
      (~45k weighted calls ≈ 4-5 days of free quota; `pipeline.fetch` resumes automatically)
- [ ] Retrain MH with the new features and seasons; train KA's own model
- [ ] Re-run evaluations: T1, T2 modern, T2 historical (~100 gauges), MH→KA transfer
- [ ] Re-export serving bundles (MH + KA); README results

### B. Frontend
- [x] FieldCast brand (name, logo, favicon, tokens), app shell, control bar
- [x] Forecast page: block summary, village list, village detail, print advisory
- [x] Block-relative colour scales, collision-free labels, confidence textures
- [x] Evidence and How it works pages
- [x] Replay dates from the API, consistent number formatting, wet-day rain scale
- [x] Verified at 1440, 1280, 820 and 375 px; 135 vitest tests, lint + build clean

### C. Vercel
- [x] Numpy-only serving runtime + committed serving bundle (parity with LightGBM ~1e-15)
- [x] Runtime-only dependencies (83 MB) vs pipeline extra; import-boundary test
- [x] `vercel.json`, `.vercelignore`, `[tool.vercel] entrypoint`, `.python-version`
- [x] Verified in a clean runtime-only environment: 57 ms cold / 13 ms warm per forecast
- [ ] First deployment (owner's Vercel account)

---

## Next up
1. When the fetch completes: retrain MH + KA, evaluate, export bundles, commit.
2. README final results and deployment instructions.
3. Owner: LGD CSVs → rebuild panchayats → re-export.

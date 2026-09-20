# Phases — Panchayat-Level Weather Downscaling

Not calendar-driven. Each phase has a success criterion; we self-verify against it
and move on. A phase is done when its criterion is *demonstrated*, not when it is
"basically written".

Status key: `[ ]` not started · `[~]` in progress · `[x]` done & verified

---

## Phase 0 — Foundation
- [x] Read PRD, verify every data source is actually reachable (not assumed)
- [x] Repo init, feature branch, .gitignore
- [x] architecture.md written and agreed
- [ ] Python/Node project scaffolding, dependencies pinned, lint + test harness green

**Success:** `pytest` and `ruff` run clean on an empty-but-wired project.

---

## Phase 1 — Data layer
- [ ] Source adapters: Open-Meteo (archive/forecast/elevation), GADM, datameet, GHCN
- [ ] Disk cache + retry/backoff + offline replay for every adapter
- [ ] Block boundaries (GADM L3) for pilot region
- [ ] Panchayat-proxy units from real village polygons
- [ ] GHCN station index filtered to region, with record-quality screening

**Success:** one command builds the full regional geo+station base offline from cache,
and a test asserts every adapter degrades gracefully when the network is gone.

---

## Phase 2 — Terrain & features
- [ ] Terrain stencil: elevation, slope, aspect, ruggedness, local relief
- [ ] Monsoon-relative aspect (windward/leeward discriminator)
- [ ] Distance to coast
- [ ] Block-context features + temporal harmonics
- [ ] Feature table assembly with strict train/test spatial separation

**Success:** feature table for the pilot region materialises; a test proves no
target leakage and that spatial splits hold out whole blocks, not random rows.

---

## Phase 3 — Models
- [ ] Residual/anomaly formulation
- [ ] Rainfall: occurrence classifier + calibrated conditional-amount quantiles
- [ ] Tmax / Tmin / RH / wind quantile models with lapse-rate prior
- [ ] Block-mean reconciliation
- [ ] Epistemic support score (Mahalanobis + gauge distance + tier)

**Success:** models train end-to-end and persist; predictions inside one block are
*differentiated* (PRD §9) and re-aggregate to the block mean within tolerance.

---

## Phase 4 — Evaluation (the phase that decides whether this project is real)
- [ ] Baselines B0 naive / B1 IDW / B2 lapse-rate / B3 bilinear
- [ ] T1 metrics (dense ERA5-Land truth)
- [ ] T2 metrics at real GHCN gauges — **the PRD §9 proof**
- [ ] Calibration: interval coverage, PIT, reliability, CRPS, Brier
- [ ] Karnataka held-out transfer test
- [ ] Evaluation report committed with the actual numbers, wins and losses both

**Success:** a published table showing skill vs B0 at real gauges, with honest
reporting of any variable or regime where we do *not* beat the baseline.

---

## Phase 5 — API
- [ ] FastAPI: blocks, panchayats, forecast, advisory, health
- [ ] Response schema carries value + interval + tier + support label
- [ ] Plain-language agro-advisory generation (spray / irrigate / harvest logic)
- [ ] API tests

**Success:** a live request for a real block returns differentiated per-panchayat
forecasts with confidence, in under a second.

---

## Phase 6 — Dashboard
- [ ] MapLibre choropleth of panchayats within a block
- [ ] Confidence rendered as a visual channel, not a footnote
- [ ] Panchayat detail: quantile band, advisory text, tier disclosure
- [ ] Baseline-vs-model comparison view (the "why this isn't just the block value" view)
- [ ] Responsive, accessible, works on a projector

**Success:** an extension officer can pick a block and act on what they see without
reading documentation.

---

## Phase 7 — Hardening & delivery
- [ ] Docker Compose, offline demo path with pre-baked artifacts
- [ ] README: what is validated, what is inference, limitations stated plainly
- [ ] Full lint + test pass, both stacks
- [ ] decisions.md and memory.md current

**Success:** a clean clone can reproduce the result, and the README would survive a
hostile reading by a domain expert.

---

## Notes
- Phase 4 is the one that cannot be compromised. If the model does not beat B0 at
  real gauges, we report that honestly and diagnose it — we do not tune until the
  number looks good.
- If a phase runs long, the schedule shifts. Nothing ships half-built to stay on plan.

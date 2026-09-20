# PRD — Panchayat-Level Weather Downscaling

### Inferring high-resolution agro-meteorological forecasts from low-resolution government data

---

## 1. Official Problem Statement (SIH26074)

**Organization:** Ministry of Earth Sciences (MoES)
**Category:** Software
**PS Number:** SIH26074
**Theme:** Disaster Management

> Downscaling of weather forecast from Block level to Panchayat level:
> Inferring high-resolution plots/data/information from low-resolution
> plot/data/information/variables for agro-meteorological advisory services.

---

## 2. The Problem, Stated Plainly

India's operational weather forecasts are issued at the **block level** —
an administrative unit covering many villages and a wide range of local
terrain (elevation, land use, water bodies, microclimates). A **panchayat**
(village-cluster) sits inside a block, often just a few kilometers from
its neighbors, but can have meaningfully different rainfall, temperature,
or humidity due to local terrain effects that a block-level forecast
cannot capture.

This matters concretely: a farmer in one panchayat may get a "moderate
rain expected" advisory that's accurate for the block average but wrong
for their specific plot — leading to a bad decision on irrigation,
pesticide spraying (which shouldn't happen before rain), or harvest
timing. The gap between "forecast resolution" and "decision resolution"
is the actual problem, not weather prediction accuracy in general.

**Why this is genuinely hard, not just an interpolation exercise:**

- Rainfall is spatially discontinuous — one field can get a downpour while
  a field a kilometer away gets nothing. Naive smoothing/interpolation
  assumes gradual spatial change, which is false for precipitation.
- Ground-truth station data at panchayat resolution is sparse or
  nonexistent in most of India — you can't just "train on the fine-grained
  answer" because it barely exists at scale.
- Terrain and land-use covariates (elevation, vegetation, water
  proximity) matter but are noisy and unevenly available.
- A wrong downscaled forecast that looks confident is worse than no
  downscaling at all, because it drives a real agricultural decision.

---

## 3. What's Expected (per the problem statement)

A system that takes coarse block-level weather variables and infers
plausible, higher-resolution panchayat-level values/information suitable
for agro-meteorological advisories.

---

## 4. Goals

- Produce panchayat-level forecasts/estimates from block-level input data
  that are meaningfully more locally accurate than simply repeating the
  block value for every panchayat inside it.
- Represent **uncertainty explicitly** — a downscaled value should come
  with an honest confidence indicator, not just a single number presented
  as fact. This matters more here than in most ML problems, because the
  output drives real farming decisions.
- Be usable by an actual agricultural extension officer or advisory
  service, not just evaluable as a benchmark number.

## 5. Non-Goals

- Not attempting to improve raw block-level forecast accuracy itself —
  the input forecast is treated as given; the task is spatial refinement,
  not meteorological prediction from scratch.
- Not building a system that requires dense panchayat-level sensor
  networks to run — most of India doesn't have that, and requiring it
  would make the system useless where it's needed most.
- Not claiming precision the data can't support — see Section 7.

## 6. Target User

An agro-meteorological advisory service, or an agricultural extension
officer, deciding what to tell farmers in a specific panchayat this week.

**Usability bar:** if this system tells a panchayat "70% chance of rain
tomorrow, but we're not confident about your specific area because we
have little terrain data here," that's more useful — and more honest —
than a system that confidently says "70%" everywhere with no distinction
between well-supported and poorly-supported panchayats.

---

## 7. The Core Design Tension (state this honestly, don't hide it)

Most downscaling approaches implicitly assume the fine-grained truth is a
**smooth** function of the coarse input — that's what makes standard
super-resolution/interpolation techniques work for images, but it's
**false for rainfall**, which is genuinely discontinuous in space.

The honest framing of this project is not "predict the exact panchayat
value" — it's "predict the panchayat value **and** how much that
prediction should be trusted, given how much local variability is
plausible for this block under these conditions." A system that hides
this uncertainty is making a false precision claim. A system that
surfaces it is solving the actual problem the way it actually needs to
be solved.

---

## 8. Data Considerations (context, not architecture)

- Block-level forecast data: available from IMD/MoES sources.
- Terrain/land-use covariates: elevation (SRTM/similar), land cover,
  water body proximity — publicly available at reasonable resolution.
- Panchayat-level ground truth: sparse. Be upfront in the eventual README
  about exactly how much real ground-truth validation was possible versus
  how much is plausible-but-unverified inference — this is a real
  limitation of the problem itself, not a flaw in the build.

---

## 9. Success Criteria

- Panchayats within the same block receive **differentiated** estimates
  that reflect real terrain/covariate differences — not a copy-pasted
  block value.
- Every panchayat-level output carries an explicit confidence/uncertainty
  indicator.
- Where real ground-truth exists (even sparse), downscaled estimates are
  demonstrably closer to it than the naive "just use the block value"
  baseline — this comparison against the naive baseline is the actual
  proof the project needs, not an abstract accuracy number.
- The README states plainly where the model is well-supported by data
  and where it's making its best inference under genuine uncertainty.

---

## 10. Note for Claude Code

This PRD deliberately does not prescribe model architecture, libraries, or
implementation approach — that's the job of `architecture.md`, planned
separately. Read this PRD to understand the problem and what "done"
means; the technical approach is yours to design and propose before any
code is written.

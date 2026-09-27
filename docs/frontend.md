# FieldCast — Frontend

The dashboard an agricultural extension officer uses: pick a block and a day,
see every gram panchayat on a map, read what to tell farmers, and see how far to
trust it. Read top to bottom once and you should be able to explain, run or
change any part of it.

---

## 1. Who it is for and what it must do

**User**: a district or block agriculture officer, often on a mid-range laptop or
a phone, deciding this week's advice for specific villages. Not a meteorologist.

**Must-haves that drove the design:**
- Show that villages **differ** from the block forecast (the product's whole point).
- Make **confidence** impossible to miss, and never confusable with the value.
- Put **the advice first**, in plain words, with the weather behind it second.
- Work on a phone, with a keyboard, for colour-blind users, and in print.

---

## 2. Stack

React 18 + TypeScript (strict) + Vite · MapLibre GL (map) · no router, no UI kit,
no chart library (charts are HTML/CSS/SVG) · vitest (tests) · eslint.
Runtime dependencies are just `react`, `react-dom`, `maplibre-gl`.

---

## 3. Pages and layout

Hash routes (`#/forecast`, `#/evidence`, `#/how-it-works`) handled by `lib/route.ts` +
`hooks/useHashRoute.ts`. Hash URLs work on any static host with no rewrite rules.
The Forecast page stays mounted when you visit other pages, so the map, block and
selected panchayat survive the round trip. Evidence and How it works are
lazy-loaded.

```
┌ TopBar: logo · FieldCast · Forecast | Evidence | How it works ────────────┐
├ ControlBar: Region ▾ · Block (search) ▾ · ◀ Date ▶ · Today · Past-season  │
│             example · [Use official bulletin]                           │
├──────────────────────────────────────────────┬──────────────────────────┤
│ MAP (MapLibre)                               │ SIDEBAR (only this scrolls)│
│  variable switch (Rain/Max/Min/Humidity/Wind)│  Block summary:           │
│  choropleth + confidence texture + labels    │   block value vs village  │
│  hover card                                  │   range per variable      │
│  legend (colour key + texture key)           │   differentiation note    │
│                                              │   confidence counts       │
│                                              │   advice roll-up          │
│                                              │   searchable/sortable list│
│                                              │  → Panchayat detail       │
└──────────────────────────────────────────────┴──────────────────────────┘
```

- **Desktop (≥768 px)**: an app-style screen. The document is locked to the
  window (`route-forecast` class on `<html>`); only the sidebar scrolls.
- **Phone (<768 px)**: controls collapse to one summary row; the map sits on top
  (~55% of the height) and the summary, list and detail stack below in one
  normal page scroll. The list's sticky search header sits under the top bar.
- **Evidence and How it works** scroll as normal documents.

---

## 4. Data flow

**`api/client.ts`** is the only module that knows where data comes from. It
calls the FastAPI backend at relative `/api/...` paths (Vite proxies them to
:8000 in development; in production the same app serves both). FastAPI's
`detail` messages are turned into one readable sentence for error cards.
`VITE_USE_MOCK=true` swaps in an in-browser mock (`api/mock*.ts`) with a visible
"Demo data" banner.

**`hooks/useAsync.ts`**: every request gives `{data, error, status, loading,
slow, reload}`. `slow` turns true after 2 s so the UI can explain long waits;
`reload` backs every "Try again" button.

**`components/forecast/ForecastPage.tsx`** orchestrates:
1. `getRegions()` → which dates each region can replay (`calendarFromRegion`).
2. `getBlocks(region)` → block list.
3. `getBlockGeometry(block)` → outlines, **then** the forecast (sequenced so a
   forecast never belongs to the previous block).
4. `getBlockForecast(block, date)`, or `postBlockForecast` when the officer has
   entered their own bulletin.
5. Derived state: per-variable colour scales, selected panchayat, source label
   ("Past-season replay", "Live forecast", "Your bulletin").

Remembered across visits (localStorage, all access wrapped in try/catch):
`fieldcast.region`, `fieldcast.block`, `fieldcast.variable`.

Types in `types/api.ts` mirror `backend/app/schemas.py` field for field.

---

## 5. The map (`components/forecast/MapView.tsx`)

- **Basemap**: OpenStreetMap raster tiles (no API key), with attribution.
- **Fit**: on load, block change and container resize the map fits the block's
  panchayat bounds (`lib/mapGeometry.ts`), animated unless reduced motion.
- **Colour = value, relative to the block** (`lib/colorScale.ts`, `lib/mapScale.ts`):
  - Temperature, humidity, wind: diverging scale centred on the **block value**,
    domain fitted to the block, with a per-variable minimum reach so rounding
    noise is not painted as a real difference.
  - Rain: when the API serves rain amounts from the block (`value_source:
    "block"`, today's case), the Rain view maps the **chance of rain** instead,
    on a block-fitted blue scale, because a uniform amount map would hide the one
    village-level rain signal (`lib/valueSource.ts`, `rainMapMode()`). When rain
    amounts come from the model it maps amounts: from 0 if any panchayat is dry,
    otherwise fitted to the panchayats' own range.
  - Never a rainbow; diverging ramps chosen to survive colour blindness.
- **Texture = confidence** (`lib/confidenceTexture.ts`, `lib/mapPatterns.ts`):
  well supported = plain fill, moderate = dots, low = hatching + dashed outline.
  Opacity is never used for confidence: to a non-expert, faded reads as "less".
- **Labels**: values drawn to canvas images (`lib/mapLabels.ts`) in a MapLibre
  symbol layer with collision detection, so crowded labels are dropped, not
  stacked (text labels would need a hosted font server). Names appear on hover
  or selection only.
- **Outlines**: white casing under a dark line so boundaries show on pale fills;
  a thick high-contrast ring marks the selected panchayat.
- **Hover card** (`MapTooltip.tsx`): positioned imperatively, so mouse moves don't
  re-render React.

---

## 6. The sidebar

**Block summary** (`BlockSummary.tsx`, `lib/blockSummary.ts`):
- per variable: the official block value, the range across panchayats and a
  mini bar on the map's scale (`VariableSpreadList.tsx`); click to switch the map;
- the backend's differentiation note ("Villages genuinely differ today…" or,
  honestly, "nearly identical to the block value");
- confidence counts ("24 moderate · 1 low");
- **advice roll-up** (`AdviceRollup.tsx`): per activity, how many panchayats
  should avoid / take care / go ahead, as a stacked bar plus words;
- **panchayat list** (`VillageList.tsx`, `lib/villageList.ts`): search, sort by
  name or value, a confidence chip and the difference from the block
  ("+0.8 °C"); village clusters carry a small "cluster" tag.

**Panchayat detail** (`components/village/`), in the order an officer needs it:
1. **What to tell farmers**: headline + actions, most restrictive first
   (`AdvisoryActions.tsx`). Each action is shape + colour + word
   (✓ Go ahead, ⚠ Take care, ⛔ Hold off), with confidence caveats.
2. **Weather for this panchayat** (`VariableCard.tsx`, `lib/intervalBand.ts`):
   the value, its likely range (8 days in 10) as a band, the block value marked
   on the same scale, and a plain verdict ("within the uncertainty: treat as the
   same as the block"). **Rain is two linked statements**: "X% chance of rain
   (2.5 mm or more)" and "If it rains: about L–U mm" (`range_basis: "if_rain"`),
   with the block amount marked for reference. A value served from the block
   (`value_source: "block"`) shows a "Block value" tag and a note explaining why.
3. **How sure are we?** (`ConfidencePanel.tsx`): support level in words, distance
   to the nearest real gauge, support score, evidence tier, and the backend's
   uncertainty statement (always visible, never behind a toggle).
4. **Print advisory**: `styles/print.css` produces a branded one-page sheet for a
   panchayat noticeboard.

**Official bulletin** (`BulletinDialog.tsx`, `lib/bulletin.ts`): the officer can
type the IMD block forecast; values are validated (numbers only, physical
bounds, min ≤ max temperature) and POSTed; a banner marks the view as theirs.

**Dates** (`DateControl.tsx`, `lib/dates.ts`): day steppers skip gaps between
servable windows; the hint is generated from the API ("Replay: Jun–Sep 2022,
Oct 2022–Sep 2023 · Live: yesterday to +15 days"); a refused date shows the
API's reason and a one-click way back to a valid day.

---

## 7. Evidence and How it works

**Evidence** (`components/evidence/`, `lib/evidence.ts`) reads
`/api/evaluation/reports` and shows, per region and tier: skill vs the naive
block copy as a dot with a 90% CI whisker on a shared axis (`SkillChart.tsx`),
interval coverage against the 80% target, rain-occurrence Brier scores, the real
gauges (modern and the ~100-gauge 1960 test), and the transfer test. Losses are
shown as prominently as wins; missing tiers say "Not available yet". Where a
variable is served from the block value, a note gives the model's own validation
and test skill and explains why the official value is served.

**How it works** (`components/about/`) explains the method in plain language:
the terrain diagram (windward vs rain shadow, the upwind ridge), real gram
panchayats from LGD, whole-year training, the three evidence tiers, data
sources, and the same limitations list as the README.

---

## 8. Design system (`styles/tokens.css`)

- **Colour**: deep green-teal brand (`--brand-*`), warm ochre accent
  (`--accent-*`), green-grey neutrals; contrast ratios noted beside tokens (AA).
- **Type**: Inter (Google Fonts) with a defined scale; tabular numbers for values.
- **Layout**: `--topbar-h` 56 px, `--sidebar-w` 400 px (340 px on tablets),
  `--control-h` 38 px; one breakpoint at 768 px (`hooks/useMediaQuery.ts`).
- **Styles split by area**: `base`, `shell`, `controls`, `forecast`, `sidebar`,
  `village`, `evidence`, `about`, `print`.
- **Brand**: `components/brand/Logo.tsx` + `public/favicon.svg`: a raindrop
  holding two field furrows, with a warm dot for the village.

## 9. Formatting and wording rules (`lib/format.ts`, `lib/variables.ts`)

One module formats every number: rain and temperature 1 decimal, humidity whole
%, wind 1 decimal, probability whole %, distance whole km, area 1 decimal,
support "/ 100". Differences are computed from the *displayed* values, so
value − block always adds up on screen. Units are called **gram panchayats**
(or "panchayats" where space is tight); "cluster" marks approximate units.

## 10. Accessibility and performance

- Keyboard: skip link, focus rings, a combobox with the full select keyboard
  contract, native `<dialog>`, the list as the accessible twin of the map.
- Screen readers: aria labels on charts and scales, sentence versions of every
  chart, uncertainty text in plain HTML.
- Colour is never the only cue (texture, glyph, word); `prefers-reduced-motion`
  respected.
- Up to 257 panchayats per block: memoised list rows, `content-visibility: auto`,
  labels drawn on demand, lazy-loaded pages → interactions around 80 ms. The main
  bundle is ~72 kB gzipped; MapLibre is a separate cached chunk.

## 11. Tests (`npm test`, ~180 tests)

Pure logic is tested, not snapshots: colour scales and relative domains,
confidence textures, interval-band geometry, date windows and hints, number
formatting and deltas, block summary roll-ups, list search/sort, bulletin
validation, evidence classification, map bounds/label ordering, route classes,
rain map mode and value-source notes, if-it-rains bands and wording.

## 12. Run, build, deploy

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, proxies /api to http://localhost:8000
npm test && npm run lint && npm run build     # build → frontend/dist
```

Environment variables (`.env.example`): `VITE_USE_MOCK` (in-browser demo data),
`VITE_API_BASE_URL` (API on another origin), `VITE_REGION` (default region).

In production there is no separate frontend server: the FastAPI app mounts
`frontend/dist`, and on Vercel that mount is promoted to the CDN
(`vercel.json` builds it with `npm ci && npm run build`).

## 13. How to extend

- **New variable**: add it to `lib/variables.ts` (label, unit, decimals, scale
  kind) and `types/api.ts`; the map, legend, lists and cards pick it up.
- **New region**: nothing to change; it appears once the API reports it as served.
- **New page**: add a route in `lib/route.ts`, a nav link in `TopBar.tsx`, and a
  lazy import in `App.tsx`.

/**
 * Mock data generation.
 *
 * The backend does not exist yet (phases.md: Phase 5 is unbuilt), so the
 * dashboard is developed against data shaped *exactly* like `schemas.py`. Two
 * rules kept this from becoming a lie:
 *
 * 1. **Every field comes from the schema.** Nothing extra, nothing renamed.
 * 2. **The physics is the real physics**, not random noise. Rainfall follows the
 *    Western Ghats windward/leeward gradient (architecture.md §2: ~3000 mm to
 *    ~500 mm inside 50 km), temperature follows the -6.5 °C/km lapse rate
 *    (§3.3), and every variable is reconciled back to the official block value
 *    (§3.6) — multiplicative for rainfall, additive for the rest.
 *
 * That last point matters for the comparison view: if the mock did not
 * reconcile, the "why not just the block value?" screen would show a spread that
 * the real model would never produce.
 */

import type {
  Advisory,
  BaselineComparison,
  BlockForecastResponse,
  BlockSummary,
  Confidence,
  Differentiation,
  GeoJsonPolygon,
  PanchayatForecast,
  PanchayatGeometry,
  SupportLevel,
  Tier,
  VariableForecast,
} from '../types/api'
import { buildAdvisory } from './mockAdvisory'
import { buildLattice, polygonAreaKm2, polygonCentroid } from './mockGeometry'

export const MODEL_VERSION = 'downscale-lgbm-0.4.2-mock'

interface BlockSpec {
  block_id: string
  block_name: string
  district: string
  state: string
  /** [west, south, east, north] */
  bbox: [number, number, number, number]
  cols: number
  rows: number
  /** Elevation at the western (windward) edge and the eastern (leeward) edge. */
  elevWest: number
  elevEast: number
  /** How strong the rain-shadow gradient is across this block. 0 = flat plain. */
  gradient: number
  /** Official block-level forecast — the coarse input we refine. */
  block: {
    precip: number
    tmax: number
    tmin: number
    humidity: number
    wind: number
    rainProb: number
  }
  names: string[]
}

/**
 * Pilot region only (architecture.md §2). These are real block and district
 * names; the polygons and the numbers are mock.
 */
const BLOCKS: BlockSpec[] = [
  {
    block_id: 'MH-PUN-BHOR',
    block_name: 'Bhor',
    district: 'Pune',
    state: 'Maharashtra',
    bbox: [73.62, 18.02, 74.02, 18.28],
    cols: 4,
    rows: 2,
    elevWest: 1180,
    elevEast: 610,
    gradient: 1,
    block: { precip: 24.1, tmax: 29.4, tmin: 20.8, humidity: 79, wind: 13.2, rainProb: 0.58 },
    names: [
      'Ambavane',
      'Hirdoshi',
      'Nigade',
      'Kambre',
      'Velu',
      'Bhongavali',
      'Sangavi',
      'Kurungavali',
    ],
  },
  {
    block_id: 'MH-PUN-VELHE',
    block_name: 'Velhe',
    district: 'Pune',
    state: 'Maharashtra',
    bbox: [73.48, 18.18, 73.86, 18.46],
    cols: 3,
    rows: 2,
    elevWest: 1240,
    elevEast: 720,
    gradient: 0.92,
    block: { precip: 31.6, tmax: 27.8, tmin: 19.4, humidity: 84, wind: 15.1, rainProb: 0.66 },
    names: ['Panshet', 'Vinzar', 'Ketkavane', 'Margasani', 'Pasali', 'Kondhavale'],
  },
  {
    block_id: 'MH-PUN-MULSHI',
    block_name: 'Mulshi',
    district: 'Pune',
    state: 'Maharashtra',
    bbox: [73.36, 18.4, 73.78, 18.66],
    cols: 4,
    rows: 2,
    elevWest: 1090,
    elevEast: 640,
    gradient: 0.88,
    block: { precip: 28.4, tmax: 28.6, tmin: 20.1, humidity: 82, wind: 14.4, rainProb: 0.62 },
    names: [
      'Tamhini',
      'Mose',
      'Kolvan',
      'Paud',
      'Dasave',
      'Ghotawade',
      'Pirangut',
      'Male',
    ],
  },
  {
    block_id: 'MH-PUN-HAVELI',
    block_name: 'Haveli',
    district: 'Pune',
    state: 'Maharashtra',
    bbox: [73.72, 18.4, 74.08, 18.62],
    cols: 3,
    rows: 2,
    elevWest: 680,
    elevEast: 560,
    gradient: 0.18,
    block: { precip: 6.2, tmax: 32.1, tmin: 21.9, humidity: 62, wind: 10.8, rainProb: 0.24 },
    names: ['Wagholi', 'Uruli Kanchan', 'Khed Shivapur', 'Theur', 'Loni Kalbhor', 'Shivane'],
  },
  {
    block_id: 'MH-SAT-MAHABALESHWAR',
    block_name: 'Mahabaleshwar',
    district: 'Satara',
    state: 'Maharashtra',
    bbox: [73.6, 17.82, 73.94, 18.04],
    cols: 3,
    rows: 2,
    elevWest: 1380,
    elevEast: 780,
    gradient: 1,
    block: { precip: 52.8, tmax: 24.2, tmin: 16.8, humidity: 91, wind: 18.6, rainProb: 0.81 },
    names: ['Lingmala', 'Taped', 'Metgutad', 'Dhavali', 'Godavli', 'Achali'],
  },
  {
    block_id: 'MH-SAT-PATAN',
    block_name: 'Patan',
    district: 'Satara',
    state: 'Maharashtra',
    bbox: [73.62, 17.28, 74.06, 17.56],
    cols: 4,
    rows: 2,
    elevWest: 1120,
    elevEast: 620,
    gradient: 0.86,
    block: { precip: 22.7, tmax: 28.9, tmin: 20.2, humidity: 80, wind: 13.9, rainProb: 0.55 },
    names: ['Koyna', 'Navja', 'Morgiri', 'Tarale', 'Malharpeth', 'Kadave', 'Dhebewadi', 'Mendh'],
  },
  {
    block_id: 'MH-SAT-MAN',
    block_name: 'Man',
    district: 'Satara',
    state: 'Maharashtra',
    bbox: [74.28, 17.5, 74.7, 17.78],
    cols: 3,
    rows: 2,
    elevWest: 720,
    elevEast: 640,
    gradient: 0.12,
    block: { precip: 3.4, tmax: 34.6, tmin: 22.7, humidity: 48, wind: 16.2, rainProb: 0.16 },
    names: ['Dahivadi', 'Mhaswad', 'Gondavale', 'Pulkoti', 'Shindi', 'Andhali'],
  },
  {
    block_id: 'MH-AHM-AKOLE',
    block_name: 'Akole',
    district: 'Ahmednagar',
    state: 'Maharashtra',
    bbox: [73.74, 19.38, 74.18, 19.66],
    cols: 4,
    rows: 2,
    elevWest: 1420,
    elevEast: 660,
    gradient: 0.95,
    block: { precip: 19.8, tmax: 29.8, tmin: 18.9, humidity: 74, wind: 12.6, rainProb: 0.51 },
    names: [
      'Bhandardara',
      'Ratanwadi',
      'Samrad',
      'Kotul',
      'Rajur',
      'Shendi',
      'Ambit',
      'Virgaon',
    ],
  },
  {
    block_id: 'MH-AHM-SANGAMNER',
    block_name: 'Sangamner',
    district: 'Ahmednagar',
    state: 'Maharashtra',
    bbox: [74.06, 19.44, 74.48, 19.7],
    cols: 3,
    rows: 2,
    elevWest: 780,
    elevEast: 580,
    gradient: 0.24,
    block: { precip: 5.1, tmax: 33.2, tmin: 20.6, humidity: 55, wind: 14.8, rainProb: 0.21 },
    names: ['Ghargaon', 'Ashvi', 'Samnapur', 'Talegaon', 'Nimon', 'Jorve'],
  },
  {
    block_id: 'MH-NAS-IGATPURI',
    block_name: 'Igatpuri',
    district: 'Nashik',
    state: 'Maharashtra',
    bbox: [73.36, 19.58, 73.76, 19.84],
    cols: 3,
    rows: 2,
    elevWest: 1290,
    elevEast: 700,
    gradient: 0.97,
    block: { precip: 38.9, tmax: 26.4, tmin: 18.2, humidity: 88, wind: 17.2, rainProb: 0.74 },
    names: ['Ghoti', 'Tringalwadi', 'Vaitarna', 'Mundhegaon', 'Talegaon', 'Adhwan'],
  },
  {
    block_id: 'MH-NAS-SINNAR',
    block_name: 'Sinnar',
    district: 'Nashik',
    state: 'Maharashtra',
    bbox: [73.94, 19.76, 74.32, 20.02],
    cols: 3,
    rows: 2,
    elevWest: 720,
    elevEast: 600,
    gradient: 0.15,
    block: { precip: 4.6, tmax: 33.8, tmin: 20.1, humidity: 52, wind: 15.4, rainProb: 0.19 },
    names: ['Dapur', 'Musalgaon', 'Wavi', 'Panchale', 'Shah', 'Nandur Shingote'],
  },
]

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Deterministic pseudo-random in [-1, 1]. */
function noise(key: string): number {
  return (hash(key) % 20000) / 10000 - 1
}

function round(n: number, d = 1): number {
  const f = Math.pow(10, d)
  return Math.round(n * f) / f
}

function findBlock(blockId: string): BlockSpec | undefined {
  return BLOCKS.find((b) => b.block_id === blockId)
}

export function listBlocks(): BlockSummary[] {
  return BLOCKS.map((b) => {
    const [w, s, e, n] = b.bbox
    return {
      block_id: b.block_id,
      block_name: b.block_name,
      district: b.district,
      state: b.state,
      panchayat_count: b.cols * b.rows,
      centroid_lat: round((s + n) / 2, 4),
      centroid_lon: round((w + e) / 2, 4),
    }
  })
}

interface Unit {
  id: string
  name: string
  polygon: GeoJsonPolygon
  lon: number
  lat: number
  elevation: number
  areaKm2: number
  /** 1 at the windward (western) edge, 0 at the leeward (eastern) edge. */
  windward: number
  /** Distance to the nearest real observing station, km. */
  gaugeKm: number
  support: SupportLevel
  supportScore: number
}

function buildUnits(spec: BlockSpec): Unit[] {
  const polygons = buildLattice({
    seed: spec.block_id,
    cols: spec.cols,
    rows: spec.rows,
    bbox: spec.bbox,
  })
  const [west, , east] = spec.bbox
  const lonSpan = east - west

  return polygons.map((polygon, index) => {
    const centroid = polygonCentroid(polygon)
    const name = spec.names[index] ?? `Panchayat ${index + 1}`
    const id = `${spec.block_id}-P${String(index + 1).padStart(2, '0')}`

    // Windwardness: west edge = 1. The Western Ghats crest is the western rim,
    // so this single axis carries the rain-shadow story.
    const windward = lonSpan > 0 ? clamp01(1 - (centroid.lon - west) / lonSpan) : 0.5
    const elevation = Math.round(
      spec.elevEast + (spec.elevWest - spec.elevEast) * windward + noise(`${id}:elev`) * 45,
    )

    // Gauges cluster in the accessible east; the high western terrain is exactly
    // where we have the least ground truth. That is the real pattern, and it is
    // why the wettest panchayats are often the least-supported ones.
    const gaugeKm = round(4 + windward * 34 + noise(`${id}:gauge`) * 4.5, 1)

    // Epistemic support: gauge distance plus how unusual the terrain is.
    const terrainPenalty = clamp01((elevation - 600) / 900) * 0.45
    const supportScore = clamp01(
      0.94 - clamp01((gaugeKm - 4) / 36) * 0.55 - terrainPenalty + noise(`${id}:sup`) * 0.07,
    )
    const support: SupportLevel =
      supportScore >= 0.66 ? 'high' : supportScore >= 0.36 ? 'medium' : 'low'

    return {
      id,
      name,
      polygon,
      lon: centroid.lon,
      lat: centroid.lat,
      elevation,
      areaKm2: polygonAreaKm2(polygon),
      windward,
      gaugeKm,
      support,
      supportScore: round(supportScore, 2),
    }
  })
}

function clamp01(n: number): number {
  return !Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n
}

const unitCache = new Map<string, Unit[]>()

function unitsFor(spec: BlockSpec): Unit[] {
  const cached = unitCache.get(spec.block_id)
  if (cached) return cached
  const built = buildUnits(spec)
  unitCache.set(spec.block_id, built)
  return built
}

export function listGeometry(blockId: string): PanchayatGeometry[] | null {
  const spec = findBlock(blockId)
  if (!spec) return null
  return unitsFor(spec).map((u) => ({
    panchayat_id: u.id,
    panchayat_name: u.name,
    unit_type: 'village_cluster',
    block_id: spec.block_id,
    geometry: u.polygon,
    centroid_lat: u.lat,
    centroid_lon: u.lon,
    elevation_m: u.elevation,
    area_km2: u.areaKm2,
  }))
}

// ---------------------------------------------------------------------------
// Variable generation
// ---------------------------------------------------------------------------

const SUPPORT_LABELS: Record<SupportLevel, string> = {
  high: 'Well supported — similar terrain is well represented in training data',
  medium: 'Moderate support — use the range, not the single number',
  low: 'Low support — treat as indicative, verify locally',
}

/** Interval widening applied on top of the aleatoric spread, by support level. */
const SUPPORT_WIDENING: Record<SupportLevel, number> = { high: 1, medium: 1.35, low: 1.85 }

function tierFor(_gaugeKm: number): Tier {
  // Matches the real backend: every panchayat-scale value is T3 — inferred
  // below the validated scale. T1/T2 exist only in the evaluation rows.
  return 'T3'
}

function tierNote(tier: Tier, gaugeKm: number): string {
  if (tier === 'T2') {
    return (
      `Checked against real rain-gauge records — the nearest station is ${gaugeKm.toFixed(0)} km ` +
      `away, close enough that errors here have been measured, not assumed.`
    )
  }
  return (
    'No ground-truth measurements exist at village scale here (the nearest station is ' +
    `${gaugeKm.toFixed(0)} km away), so this number is physically-informed inference below the ` +
    'scale we can validate. It is our best estimate, not a measured result.'
  )
}

function makeConfidence(
  unit: Unit,
  lower: number,
  upper: number,
): Confidence {
  const tier = tierFor(unit.gaugeKm)
  return {
    lower: round(lower, 1),
    upper: round(upper, 1),
    interval_pct: 80,
    support: unit.support,
    support_label: SUPPORT_LABELS[unit.support],
    support_score: unit.supportScore,
    tier,
    tier_note: tierNote(tier, unit.gaugeKm),
    nearest_gauge_km: unit.gaugeKm,
  }
}

function makeVariable(args: {
  variable: string
  label: string
  unit: string
  value: number
  blockValue: number
  lower: number
  upper: number
  unitRef: Unit
  rainProbability?: number
}): VariableForecast {
  const blockValue = round(args.blockValue, 1)
  // Mirrors the backend's serving policy today: the rain amount did not beat
  // the block value on validation, so rain's point value is the block value
  // (its range and rain chance still vary by panchayat).
  const fromBlock = args.variable === 'precip'
  const value = fromBlock ? blockValue : round(args.value, 1)
  return {
    variable: args.variable,
    label: args.label,
    unit: args.unit,
    value,
    block_value: blockValue,
    anomaly: round(value - blockValue, 1),
    confidence: makeConfidence(args.unitRef, args.lower, args.upper),
    rain_probability:
      args.rainProbability === undefined ? null : round(clamp01(args.rainProbability), 2),
    value_source: fromBlock ? 'block' : 'model',
    // Rain's range is the amount on a day it rains (>= 2.5 mm), like the backend.
    range_basis: args.variable === 'precip' ? 'if_rain' : 'all_days',
  }
}

/** Multiplicative reconciliation: area-weighted mean must equal the block value. */
function reconcileMultiplicative(raw: number[], areas: number[], target: number): number[] {
  const totalArea = areas.reduce((a, b) => a + b, 0)
  if (totalArea <= 0) return raw
  const weighted = raw.reduce((acc, v, i) => acc + v * (areas[i] as number), 0) / totalArea
  if (weighted <= 1e-9) return raw
  const factor = target / weighted
  return raw.map((v) => Math.max(0, v * factor))
}

/** Additive reconciliation, for variables where a ratio makes no sense. */
function reconcileAdditive(raw: number[], areas: number[], target: number): number[] {
  const totalArea = areas.reduce((a, b) => a + b, 0)
  if (totalArea <= 0) return raw
  const weighted = raw.reduce((acc, v, i) => acc + v * (areas[i] as number), 0) / totalArea
  const offset = target - weighted
  return raw.map((v) => v + offset)
}

function dateSeed(date: string): number {
  return (hash(date) % 1000) / 1000
}

export function buildForecast(
  blockId: string,
  date: string,
  overrides: Record<string, number> = {},
): BlockForecastResponse | null {
  const spec = findBlock(blockId)
  if (!spec) return null
  const units = unitsFor(spec)
  const areas = units.map((u) => u.areaKm2)
  const day = dateSeed(date)

  // Day-to-day variation on the official block forecast itself.
  // Officer-supplied bulletin values (POST) replace the generated ones.
  const blockPrecip = overrides.precip ?? Math.max(0.2, spec.block.precip * (0.72 + day * 0.6))
  const blockTmax = overrides.tmax ?? spec.block.tmax + (day - 0.5) * 2.4
  const blockTmin = overrides.tmin ?? spec.block.tmin + (day - 0.5) * 1.8
  const blockHumidity =
    overrides.humidity ?? clamp01((spec.block.humidity + (day - 0.5) * 9) / 100) * 100
  const blockWind = overrides.wind ?? Math.max(1.5, spec.block.wind + (day - 0.5) * 4)
  const blockRainProb = clamp01(spec.block.rainProb + (day - 0.5) * 0.18)

  const meanElev = units.reduce((a, u) => a + u.elevation, 0) / Math.max(1, units.length)

  // --- Rainfall: orographic multiplier along the windward axis. -------------
  const rawPrecip = units.map((u) => {
    const orographic = Math.exp(spec.gradient * (u.windward - 0.42) * 2.55)
    const local = 1 + noise(`${u.id}:${date}:p`) * 0.14
    return blockPrecip * orographic * local
  })
  const precip = reconcileMultiplicative(rawPrecip, areas, blockPrecip)

  const rainProb = units.map((u) =>
    clamp01(blockRainProb + spec.gradient * (u.windward - 0.45) * 0.62 + noise(`${u.id}:${date}:rp`) * 0.05),
  )

  // --- Temperature: lapse rate against the block-mean elevation. ------------
  const rawTmax = units.map(
    (u) => blockTmax - ((u.elevation - meanElev) / 1000) * 6.5 + noise(`${u.id}:${date}:tx`) * 0.5,
  )
  const tmax = reconcileAdditive(rawTmax, areas, blockTmax)

  const rawTmin = units.map(
    (u) => blockTmin - ((u.elevation - meanElev) / 1000) * 4.8 + noise(`${u.id}:${date}:tn`) * 0.4,
  )
  const tmin = reconcileAdditive(rawTmin, areas, blockTmin)

  const rawHumidity = units.map(
    (u) => blockHumidity + spec.gradient * (u.windward - 0.45) * 17 + noise(`${u.id}:${date}:rh`) * 2.2,
  )
  const humidity = reconcileAdditive(rawHumidity, areas, blockHumidity).map((v) =>
    Math.max(12, Math.min(100, v)),
  )

  const rawWind = units.map(
    (u) =>
      blockWind * (1 + ((u.elevation - meanElev) / 1000) * 0.42) + noise(`${u.id}:${date}:ws`) * 1.1,
  )
  const wind = reconcileMultiplicative(rawWind, areas, blockWind)

  const panchayats: PanchayatForecast[] = units.map((u, i) => {
    const w = SUPPORT_WIDENING[u.support]
    const p = precip[i] as number
    const tx = tmax[i] as number
    const tn = tmin[i] as number
    const rh = humidity[i] as number
    const ws = wind[i] as number

    // Rain's range is "if it rains": the likely amount on a rainy day, so it is
    // built from the mean wet-day amount, and never starts below 2.5 mm.
    // Asymmetric on purpose: wet-day amounts are right-skewed.
    const rp = rainProb[i] as number
    const wetDay = p / Math.max(0.15, rp)
    const wetLower = Math.max(2.5, wetDay * 0.3)
    const wetUpper = Math.max(wetLower + 4, wetDay * (1.6 + 0.5 * w) + 2)

    const variables: Record<string, VariableForecast> = {
      precip: makeVariable({
        variable: 'precip',
        label: 'Rainfall',
        unit: 'mm',
        value: p,
        blockValue: blockPrecip,
        lower: wetLower,
        upper: wetUpper,
        unitRef: u,
        rainProbability: rp,
      }),
      tmax: makeVariable({
        variable: 'tmax',
        label: 'Maximum temperature',
        unit: '°C',
        value: tx,
        blockValue: blockTmax,
        lower: tx - 1.15 * w,
        upper: tx + 1.15 * w,
        unitRef: u,
      }),
      tmin: makeVariable({
        variable: 'tmin',
        label: 'Minimum temperature',
        unit: '°C',
        value: tn,
        blockValue: blockTmin,
        lower: tn - 0.95 * w,
        upper: tn + 0.95 * w,
        unitRef: u,
      }),
      humidity: makeVariable({
        variable: 'humidity',
        label: 'Relative humidity',
        unit: '%',
        value: rh,
        blockValue: blockHumidity,
        lower: Math.max(5, rh - 5.5 * w),
        upper: Math.min(100, rh + 5.5 * w),
        unitRef: u,
      }),
      wind: makeVariable({
        variable: 'wind',
        label: 'Wind speed',
        unit: 'km/h',
        value: ws,
        blockValue: blockWind,
        lower: Math.max(0, ws - 2.6 * w),
        upper: ws + 3.1 * w,
        unitRef: u,
      }),
    }

    const advisory: Advisory = buildAdvisory(variables)

    return {
      panchayat_id: u.id,
      panchayat_name: u.name,
      unit_type: 'village_cluster',
      block_id: spec.block_id,
      block_name: spec.block_name,
      latitude: u.lat,
      longitude: u.lon,
      elevation_m: u.elevation,
      area_km2: u.areaKm2,
      date,
      variables,
      advisory,
    }
  })

  return {
    block_id: spec.block_id,
    block_name: spec.block_name,
    district: spec.district,
    state: spec.state,
    date,
    panchayat_count: panchayats.length,
    panchayats,
    differentiation: buildDifferentiation(panchayats),
    model_version: MODEL_VERSION,
    generated_at: new Date().toISOString(),
  }
}

/** Below these, a spread is indistinguishable from model noise. */
const MEANINGFUL_SPREAD: Record<string, number> = {
  precip: 2,
  tmax: 0.8,
  tmin: 0.8,
  humidity: 4,
  wind: 1.5,
}

function buildDifferentiation(panchayats: PanchayatForecast[]): Differentiation {
  const spread: Record<string, number> = {}
  const keys = new Set<string>()
  for (const p of panchayats) for (const k of Object.keys(p.variables)) keys.add(k)

  for (const key of keys) {
    const values = panchayats
      .map((p) => p.variables[key]?.value)
      .filter((v): v is number => v !== undefined && Number.isFinite(v))
    spread[key] = values.length === 0 ? 0 : round(Math.max(...values) - Math.min(...values), 1)
  }

  const meaningful = Object.entries(spread).some(
    ([k, v]) => v >= (MEANINGFUL_SPREAD[k] ?? Number.POSITIVE_INFINITY),
  )

  const rain = spread.precip ?? 0
  const note = meaningful
    ? `Rainfall varies by ${rain.toFixed(1)} mm across this block — villages inside one block are ` +
      `not getting the same weather, which is exactly what a single block figure hides.`
    : 'Panchayats in this block are barely differentiated today. The block figure is close to ' +
      'the whole story here, and we say so rather than dressing up noise as detail.'

  return { variable_spread: spread, meaningful, note }
}

// ---------------------------------------------------------------------------
// Baseline comparison (Phase 4 numbers, mocked in the same shape)
// ---------------------------------------------------------------------------

const VAR_META: { variable: string; label: string; unit: string }[] = [
  { variable: 'precip', label: 'Rainfall', unit: 'mm' },
  { variable: 'tmax', label: 'Maximum temperature', unit: '°C' },
  { variable: 'tmin', label: 'Minimum temperature', unit: '°C' },
  { variable: 'humidity', label: 'Relative humidity', unit: '%' },
  { variable: 'wind', label: 'Wind speed', unit: 'km/h' },
]

/**
 * Deliberately includes a loss. Rainfall skill at real gauges is modest and wind
 * transfer to Karnataka is slightly *negative* — the PRD (§9) asks for honest
 * reporting of where we do not beat the baseline, and a dashboard that only ever
 * shows wins is not the dashboard this project said it would build.
 */
const BASELINE_ROWS: BaselineComparison[] = [
  mkBaseline('precip', 4.86, 7.12, 0.79, 41280, 'T1', 'Maharashtra (pilot)'),
  mkBaseline('tmax', 0.71, 1.44, 0.82, 41280, 'T1', 'Maharashtra (pilot)'),
  mkBaseline('tmin', 0.64, 1.12, 0.81, 41280, 'T1', 'Maharashtra (pilot)'),
  mkBaseline('humidity', 3.42, 5.86, 0.8, 41280, 'T1', 'Maharashtra (pilot)'),
  mkBaseline('wind', 0.94, 1.37, 0.78, 41280, 'T1', 'Maharashtra (pilot)'),

  mkBaseline('precip', 6.83, 9.41, 0.77, 5164, 'T2', 'Maharashtra (gauges)'),
  mkBaseline('tmax', 1.12, 1.68, 0.79, 5164, 'T2', 'Maharashtra (gauges)'),
  mkBaseline('tmin', 0.97, 1.24, 0.8, 5164, 'T2', 'Maharashtra (gauges)'),
  mkBaseline('humidity', 5.14, 6.32, 0.76, 4820, 'T2', 'Maharashtra (gauges)'),
  mkBaseline('wind', 1.38, 1.52, 0.74, 3910, 'T2', 'Maharashtra (gauges)'),

  mkBaseline('precip', 8.02, 9.96, 0.73, 2188, 'T2', 'Karnataka (held-out)'),
  mkBaseline('tmax', 1.31, 1.72, 0.76, 2188, 'T2', 'Karnataka (held-out)'),
  mkBaseline('tmin', 1.09, 1.28, 0.77, 2188, 'T2', 'Karnataka (held-out)'),
  mkBaseline('humidity', 5.88, 6.41, 0.72, 2010, 'T2', 'Karnataka (held-out)'),
  mkBaseline('wind', 1.61, 1.55, 0.7, 1704, 'T2', 'Karnataka (held-out)'),
]

function mkBaseline(
  variable: string,
  modelMae: number,
  naiveMae: number,
  coverage: number,
  n: number,
  tier: Tier,
  region: string,
): BaselineComparison {
  const meta = VAR_META.find((m) => m.variable === variable) ?? VAR_META[0]!
  return {
    variable,
    label: meta.label,
    unit: meta.unit,
    model_mae: modelMae,
    naive_mae: naiveMae,
    skill_score: round(1 - modelMae / naiveMae, 3),
    interval_coverage: coverage,
    n_observations: n,
    tier,
    region,
  }
}

export function listBaselines(): BaselineComparison[] {
  return BASELINE_ROWS
}

export function health() {
  return {
    status: 'ok',
    model_loaded: true,
    model_version: MODEL_VERSION,
    regions_available: ['Maharashtra (pilot)', 'Karnataka (held-out)'],
    offline_mode: true,
  }
}

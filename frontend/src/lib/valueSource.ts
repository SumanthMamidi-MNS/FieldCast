/**
 * Where a served value comes from, and what the map should paint because of it.
 *
 * The backend serves a variable's point value from the model only when the
 * model beat the official block value on validation data. Otherwise it serves
 * the block value itself (`value_source: "block"`): every panchayat then shows
 * the same number, with a zero delta. The range, and for rain the chance of
 * rain, still come from the model and still differ by panchayat.
 *
 * For rain that matters: an amount map would be one flat colour and hide the
 * one village-level rain signal FieldCast has, so the Rain view switches to
 * the chance of rain. Every surface that shows the map's quantity (map, legend,
 * labels, hover card, list, list sort, summary row) asks this module, so they
 * can never disagree.
 */

import type { PanchayatForecast, VariableForecast } from '../types/api'
import type { RelativeDomain } from './colorScale'
import { fixed, formatValue } from './format'
import type { VariableKey } from './variables'

/** What the map shows for the active variable: its amount/value, or (rain only) the chance of rain. */
export type MapMetric = 'amount' | 'chance'

/**
 * Smallest spread of rain chance, in percentage points, that the scale will
 * stretch across the full ramp. Narrower spreads stay pale, so 41% vs 43% is
 * not painted as a real difference.
 */
export const CHANCE_MIN_REACH = 10

/** Rain counts as "rain" at 2.5 mm or more (the backend's occurrence threshold). */
export const RAIN_CHANCE_TITLE = 'Chance of rain (2.5 mm or more)'

/** True when this value is the official block value, not FieldCast's panchayat estimate. */
export function isBlockSourced(v: VariableForecast | undefined | null): boolean {
  return v?.value_source === 'block'
}

/**
 * The variable's source across the block. The backend decides per variable per
 * region, so every panchayat agrees; "block" only when every panchayat that
 * carries the variable says so, and "model" otherwise (including no data).
 */
export function variableSource(panchayats: PanchayatForecast[], key: VariableKey): 'model' | 'block' {
  let seen = 0
  for (const p of panchayats) {
    const v = p.variables[key]
    if (!v) continue
    seen += 1
    if (!isBlockSourced(v)) return 'model'
  }
  return seen > 0 ? 'block' : 'model'
}

/** Rain chance as a whole-number-ready percentage (0–100), or NaN when absent. */
export function chancePct(v: VariableForecast | undefined | null): number {
  const p = v?.rain_probability
  if (p === null || p === undefined || !Number.isFinite(p)) return Number.NaN
  return Math.min(100, Math.max(0, p * 100))
}

/**
 * What the Rain view paints. Chance of rain when rain's point value is the
 * block value (so the amount is identical everywhere) and the panchayats carry
 * a rain chance; the amount otherwise. Every other variable shows its value.
 */
export function rainMapMode(panchayats: PanchayatForecast[], key: VariableKey): MapMetric {
  if (key !== 'precip') return 'amount'
  if (variableSource(panchayats, key) !== 'block') return 'amount'
  const hasChance = panchayats.some((p) => Number.isFinite(chancePct(p.variables[key])))
  return hasChance ? 'chance' : 'amount'
}

/** The number the map, list and labels use for one panchayat. NaN when missing. */
export function metricValue(v: VariableForecast | undefined | null, metric: MapMetric): number {
  if (!v) return Number.NaN
  if (metric === 'chance') return chancePct(v)
  return Number.isFinite(v.value) ? v.value : Number.NaN
}

/** Every panchayat's map number for one variable, skipping missing ones. */
export function metricValues(panchayats: PanchayatForecast[], key: VariableKey, metric: MapMetric): number[] {
  const out: number[] = []
  for (const p of panchayats) {
    const v = metricValue(p.variables[key], metric)
    if (Number.isFinite(v)) out.push(v)
  }
  return out
}

/**
 * A sequential domain for rain chance, fitted to the block's own lowest and
 * highest panchayat, and never narrower than `minReach` points (kept inside
 * 0–100). There is no official block chance, so `block` is NaN: the legend
 * must not mark one.
 */
export function chanceDomain(values: number[], minReach = CHANCE_MIN_REACH): RelativeDomain {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) {
    return { min: 0, max: 100, dataMin: Number.NaN, dataMax: Number.NaN, block: Number.NaN, fit: 'range' }
  }
  const dataMin = Math.min(...finite)
  const dataMax = Math.max(...finite)
  let lo = dataMin
  let hi = dataMax
  const reach = Math.min(Math.max(minReach, 0), 100)
  if (hi - lo < reach) {
    const centre = (lo + hi) / 2
    lo = centre - reach / 2
    hi = centre + reach / 2
    if (lo < 0) {
      hi -= lo
      lo = 0
    }
    if (hi > 100) {
      lo -= hi - 100
      hi = 100
    }
  }
  return { min: lo, max: hi, dataMin, dataMax, block: Number.NaN, fit: 'range' }
}

/**
 * How a summary row should read:
 * - `range`: the usual block value plus the panchayats' range (model values);
 * - `chance`: the block amount plus the panchayats' rain-chance range;
 * - `same`: the block value, the same in every panchayat.
 */
export type SpreadMode = 'range' | 'chance' | 'same'

export function spreadMode(panchayats: PanchayatForecast[], key: VariableKey): SpreadMode {
  if (rainMapMode(panchayats, key) === 'chance') return 'chance'
  return variableSource(panchayats, key) === 'block' ? 'same' : 'range'
}

/** The quiet note shown wherever a block-sourced value appears. */
export function blockValueNote(hasRainChance: boolean, ifRain = false): string {
  const range = ifRain ? 'The if-it-rains range' : 'The range'
  return (
    "Official block value: FieldCast's panchayat estimate did not beat it in testing, so the block " +
    `forecast is shown. ${hasRainChance ? `${range} and rain chance are` : `${range} is`} panchayat-specific.`
  )
}

/** The map number as text: "62%" for chance, "12.4 mm" for a value. */
export function formatMetric(value: number, key: VariableKey, metric: MapMetric, unit?: string): string {
  if (metric === 'chance') return Number.isFinite(value) ? `${fixed(value, 0)}%` : '—'
  return formatValue(value, key, unit)
}

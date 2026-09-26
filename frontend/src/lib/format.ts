/**
 * Every number the dashboard shows goes through here, so one quantity always
 * reads the same way on every surface. Precision is chosen for what an
 * extension officer can act on, not for what the model emits:
 *
 *   rain            1 decimal   "12.4 mm"
 *   temperature     1 decimal   "28.3°C"
 *   humidity        integer     "82%"
 *   wind            1 decimal   "14.3 km/h"
 *   probability     integer     "70%"
 *   distance        integer     "12 km"
 *   area            1 decimal   "80.5 km²"
 *   elevation       integer     "612 m"
 *   support score   out of 100  "64 / 100"
 *
 * Per-variable decimals live in `VARIABLES` (lib/variables.ts). Negative
 * numbers use a true minus sign, and nothing ever reads "-0".
 */

import { variableMeta } from './variables'

const MINUS = '−'
const DASH = '—'

/** Round half away from zero, and never return -0. */
function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals
  const r = (Math.sign(value) * Math.round(Math.abs(value) * f)) / f
  return r === 0 ? 0 : r
}

/** Fixed decimals, thousands grouped (en-IN), true minus sign. */
export function fixed(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return DASH
  const r = roundTo(value, decimals)
  const body = Math.abs(r).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return r < 0 ? `${MINUS}${body}` : body
}

/** Units are written tight ("28.0°C", "82%") or spaced ("12.0 mm"). */
function spacer(unit: string): string {
  return unit === '%' || unit === '°C' ? '' : ' '
}

function withUnit(text: string, unit: string): string {
  return unit ? `${text}${spacer(unit)}${unit}` : text
}

// --- Forecast variables -----------------------------------------------------

/** A bare number at the variable's precision, no unit. */
export function formatNumber(value: number, key: string): string {
  return fixed(value, variableMeta(key).decimals)
}

/** A value the way the officer should read it, with unit: "12.4 mm", "82%". */
export function formatValue(value: number, key: string, unit?: string): string {
  const u = unit ?? variableMeta(key).fallbackUnit
  if (!Number.isFinite(value)) return `${DASH} ${u}`
  return withUnit(formatNumber(value, key), u)
}

/**
 * The village-minus-block difference as the officer can check it on screen:
 * both values are rounded to display precision first, so "30.4 vs block 31.7"
 * always reads "−1.3", never a figure that disagrees with the two numbers
 * shown beside it. NaN when either value is missing.
 */
export function displayDelta(value: number, block: number, key: string): number {
  if (!Number.isFinite(value) || !Number.isFinite(block)) return Number.NaN
  const d = variableMeta(key).decimals
  return roundTo(roundTo(value, d) - roundTo(block, d), d)
}

/**
 * Difference from the block value, signed and with unit: "+0.8°C", "−1.2 mm".
 * Computed with `displayDelta`, so a village whose displayed value equals the
 * displayed block value reads "±0" and never looks like it moved.
 */
export function formatDelta(value: number, block: number, key: string, unit?: string): string {
  const meta = variableMeta(key)
  const u = unit ?? meta.fallbackUnit
  const r = displayDelta(value, block, key)
  if (!Number.isFinite(r)) return DASH
  if (r === 0) return withUnit('±0', u)
  return withUnit(`${r > 0 ? '+' : MINUS}${fixed(Math.abs(r), meta.decimals)}`, u)
}

/** CSS modifier for a difference, matching its displayed sign. */
export function deltaClass(value: number, block: number, key: string): string {
  const r = displayDelta(value, block, key)
  return r > 0 ? ' is-up' : r < 0 ? ' is-down' : ''
}

/** "22.0–25.0 mm": a range at the variable's precision. */
export function formatRange(lo: number, hi: number, key: string, unit?: string): string {
  const u = unit ?? variableMeta(key).fallbackUnit
  return withUnit(`${formatNumber(lo, key)}–${formatNumber(hi, key)}`, u)
}

// --- Other quantities -------------------------------------------------------

/** A 0–1 probability or fraction as a whole percentage, clamped: 0.704 -> 70. */
export function percentOf(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0
  return Math.min(100, Math.max(0, Math.round(fraction * 100)))
}

/** "70%". */
export function formatPercent(fraction: number): string {
  return Number.isFinite(fraction) ? `${percentOf(fraction)}%` : DASH
}

/** "12 km"; anything under half a kilometre reads "under 1 km". */
export function formatDistanceKm(km: number): string {
  if (!Number.isFinite(km)) return DASH
  if (km < 0.5) return 'under 1 km'
  return `${fixed(km, 0)} km`
}

/** "80.5 km²". */
export function formatArea(km2: number): string {
  return Number.isFinite(km2) ? `${fixed(km2, 1)} km²` : DASH
}

/** "612 m", "1,204 m". */
export function formatElevation(m: number): string {
  return Number.isFinite(m) ? `${fixed(m, 0)} m` : DASH
}

/** A 0–1 support score as "64 / 100". */
export function formatSupportScore(score: number): string {
  return Number.isFinite(score) ? `${percentOf(score)} / 100` : DASH
}

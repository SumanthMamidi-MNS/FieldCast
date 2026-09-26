/**
 * The variable registry.
 *
 * Keys match the keys of `PanchayatForecast.variables` produced by the backend
 * (`backend/app/services/advisory.py` reads `precip`, `tmax`, `tmin`,
 * `humidity`, `wind`). Labels and units still come from the API response at
 * render time — this registry only supplies presentation concerns the API does
 * not carry: which colour scale to use, how many decimals to show, and the
 * plain-language sentence a non-meteorologist needs.
 */

import type { ScaleKind } from './colorScale'

export type VariableKey = 'precip' | 'tmax' | 'tmin' | 'humidity' | 'wind'

export interface VariableMeta {
  key: VariableKey
  /** Fallback label; the API's own `label` wins when present. */
  label: string
  /** Short label for tight spaces (phone, legend). */
  shortLabel: string
  fallbackUnit: string
  scale: ScaleKind
  decimals: number
  /** Sequential scales start at zero; diverging ones centre on the block value. */
  zeroAnchored: boolean
  /** One line an extension officer can read without training. */
  plain: string
  /**
   * Smallest difference worth colouring, in the variable's unit. The map's
   * block-relative scale never stretches a narrower spread across the full
   * ramp (see `relativeDomain`).
   */
  resolution: number
  /** Words for the two ends of the scale, lowest first. */
  ends: [string, string]
}

export const VARIABLE_ORDER: VariableKey[] = ['precip', 'tmax', 'tmin', 'humidity', 'wind']

export const VARIABLES: Record<VariableKey, VariableMeta> = {
  precip: {
    key: 'precip',
    label: 'Rainfall',
    shortLabel: 'Rain',
    fallbackUnit: 'mm',
    scale: 'sequential-blue',
    decimals: 1,
    zeroAnchored: true,
    plain: 'Expected rain over the day. Darker blue means more rain.',
    resolution: 1,
    ends: ['Drier', 'Wetter'],
  },
  tmax: {
    key: 'tmax',
    label: 'Maximum temperature',
    shortLabel: 'Max temp',
    fallbackUnit: '°C',
    scale: 'diverging-temp',
    decimals: 1,
    zeroAnchored: false,
    plain: 'Hottest part of the day. Red is warmer than the block forecast, blue is cooler.',
    resolution: 0.3,
    ends: ['Cooler', 'Warmer'],
  },
  tmin: {
    key: 'tmin',
    label: 'Minimum temperature',
    shortLabel: 'Min temp',
    fallbackUnit: '°C',
    scale: 'diverging-temp',
    decimals: 1,
    zeroAnchored: false,
    plain: 'Coldest part of the night. Red is warmer than the block forecast, blue is cooler.',
    resolution: 0.3,
    ends: ['Cooler', 'Warmer'],
  },
  humidity: {
    key: 'humidity',
    label: 'Relative humidity',
    shortLabel: 'Humidity',
    fallbackUnit: '%',
    scale: 'diverging-humidity',
    decimals: 0,
    zeroAnchored: false,
    plain: 'How damp the air is. Teal is more humid than the block forecast, brown is drier.',
    resolution: 1,
    ends: ['Drier air', 'More humid'],
  },
  wind: {
    key: 'wind',
    label: 'Wind speed',
    shortLabel: 'Wind',
    fallbackUnit: 'km/h',
    scale: 'diverging-wind',
    decimals: 1,
    zeroAnchored: false,
    plain: 'Wind strength. Purple is windier than the block forecast, orange is calmer.',
    resolution: 0.5,
    ends: ['Calmer', 'Windier'],
  },
}

export function isVariableKey(value: string): value is VariableKey {
  return value in VARIABLES
}

export function variableMeta(key: string): VariableMeta {
  return isVariableKey(key) ? VARIABLES[key] : VARIABLES.precip
}

/** Units are written tight ("28.0°C", "82%") or spaced ("12.0 mm"). */
function spacer(unit: string): string {
  return unit === '%' || unit === '°C' ? '' : ' '
}

/**
 * Difference from the block value, signed and with unit: "+0.8°C", "−1.2 mm".
 * Differences that round to zero read "±0", so a flat village never looks
 * like it moved. Uses a true minus sign for legibility.
 */
export function formatDelta(delta: number, key: string, unit?: string): string {
  const meta = variableMeta(key)
  const u = unit ?? meta.fallbackUnit
  if (!Number.isFinite(delta)) return '—'
  const rounded = Number(delta.toFixed(meta.decimals))
  if (rounded === 0) return `±0${spacer(u)}${u}`
  const sign = rounded > 0 ? '+' : '\u2212'
  return `${sign}${Math.abs(rounded).toFixed(meta.decimals)}${spacer(u)}${u}`
}

/** A bare number at the variable's precision, no unit. */
export function formatNumber(value: number, key: string): string {
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(variableMeta(key).decimals)
}

/** Format a value the way the officer should read it, with unit. */
export function formatValue(value: number, key: string, unit?: string): string {
  const meta = variableMeta(key)
  const u = unit ?? meta.fallbackUnit
  if (!Number.isFinite(value)) return `— ${u}`
  return `${value.toFixed(meta.decimals)}${spacer(u)}${u}`
}

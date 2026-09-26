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
    plain: 'How much rain is expected over the day. Darker blue means more rain.',
  },
  tmax: {
    key: 'tmax',
    label: 'Maximum temperature',
    shortLabel: 'Max temp',
    fallbackUnit: '°C',
    scale: 'diverging-temp',
    decimals: 1,
    zeroAnchored: false,
    plain: 'The hottest part of the day. Red is warmer than the block forecast, blue is cooler.',
  },
  tmin: {
    key: 'tmin',
    label: 'Minimum temperature',
    shortLabel: 'Min temp',
    fallbackUnit: '°C',
    scale: 'diverging-temp',
    decimals: 1,
    zeroAnchored: false,
    plain: 'The coldest part of the night. Red is warmer than the block forecast, blue is cooler.',
  },
  humidity: {
    key: 'humidity',
    label: 'Relative humidity',
    shortLabel: 'Humidity',
    fallbackUnit: '%',
    scale: 'sequential-teal',
    decimals: 0,
    zeroAnchored: false,
    plain: 'How damp the air is. Darker green means more humid — and more fungal disease risk.',
  },
  wind: {
    key: 'wind',
    label: 'Wind speed',
    shortLabel: 'Wind',
    fallbackUnit: 'km/h',
    scale: 'sequential-purple',
    decimals: 1,
    zeroAnchored: true,
    plain: 'How strong the wind is. Darker purple means stronger wind — worse for spraying.',
  },
}

export function isVariableKey(value: string): value is VariableKey {
  return value in VARIABLES
}

export function variableMeta(key: string): VariableMeta {
  return isVariableKey(key) ? VARIABLES[key] : VARIABLES.precip
}

/** Format a value the way the officer should read it, with unit. */
export function formatValue(value: number, key: string, unit?: string): string {
  const meta = variableMeta(key)
  const u = unit ?? meta.fallbackUnit
  if (!Number.isFinite(value)) return `— ${u}`
  const spacer = u === '%' || u === '°C' ? '' : ' '
  return `${value.toFixed(meta.decimals)}${spacer}${u}`
}

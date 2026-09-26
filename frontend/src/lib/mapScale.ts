/**
 * The colour scale the map, legend, list swatches and summary bars all share
 * for one variable in one block. Built in one place so every surface agrees.
 */

import type { PanchayatForecast } from '../types/api'
import { buildScale, isDiverging, relativeDomain, type ColorScale, type RelativeDomain } from './colorScale'
import { VARIABLES, type VariableKey } from './variables'

export interface BlockScale {
  scale: ColorScale
  domain: RelativeDomain
}

/** Village values for one variable, skipping villages that lack it. */
export function valuesOf(panchayats: PanchayatForecast[], key: VariableKey): number[] {
  const out: number[] = []
  for (const p of panchayats) {
    const v = p.variables[key]?.value
    if (v !== undefined && Number.isFinite(v)) out.push(v)
  }
  return out
}

/** The official block value (identical on every village), or NaN. */
export function blockValueOf(panchayats: PanchayatForecast[], key: VariableKey): number {
  for (const p of panchayats) {
    const v = p.variables[key]?.block_value
    if (v !== undefined && Number.isFinite(v)) return v
  }
  return Number.NaN
}

export function blockScale(panchayats: PanchayatForecast[], key: VariableKey): BlockScale {
  const meta = VARIABLES[key]
  const domain = relativeDomain(valuesOf(panchayats, key), blockValueOf(panchayats, key), {
    diverging: isDiverging(meta.scale),
    minReach: meta.resolution,
    ...(meta.dryBelow !== undefined ? { dryBelow: meta.dryBelow } : {}),
  })
  return { scale: buildScale(meta.scale, domain), domain }
}

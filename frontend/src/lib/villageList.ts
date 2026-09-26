/**
 * Search and sort for the village list. Pure, so the ordering an officer sees
 * is pinned down by tests rather than by whatever Array.sort happens to do.
 */

import type { PanchayatForecast } from '../types/api'
import type { VariableKey } from './variables'

export type VillageSort = 'value-desc' | 'value-asc' | 'name'

export const SORT_LABELS: Record<VillageSort, string> = {
  'value-desc': 'Highest first',
  'value-asc': 'Lowest first',
  name: 'Name (A–Z)',
}

/** Lower-case and strip diacritics, so "Rahuri" finds "Rāhurī". */
export function normalise(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Villages whose name contains every word of the query, in any order. */
export function searchVillages(rows: PanchayatForecast[], query: string): PanchayatForecast[] {
  const words = normalise(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return rows
  return rows.filter((r) => {
    const name = normalise(r.panchayat_name)
    return words.every((w) => name.includes(w))
  })
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/**
 * Sort without mutating the input. Villages missing the variable always sink
 * to the bottom whichever direction is chosen; ties break by name so the order
 * is stable across renders.
 */
export function sortVillages(
  rows: PanchayatForecast[],
  sort: VillageSort,
  key: VariableKey,
): PanchayatForecast[] {
  const byName = (a: PanchayatForecast, b: PanchayatForecast) =>
    collator.compare(a.panchayat_name, b.panchayat_name)
  if (sort === 'name') return [...rows].sort(byName)
  const dir = sort === 'value-desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const av = a.variables[key]?.value
    const bv = b.variables[key]?.value
    const aOk = av !== undefined && Number.isFinite(av)
    const bOk = bv !== undefined && Number.isFinite(bv)
    if (!aOk || !bOk) return aOk === bOk ? byName(a, b) : aOk ? -1 : 1
    return av === bv ? byName(a, b) : (av - bv) * dir
  })
}

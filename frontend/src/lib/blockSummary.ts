/**
 * Block-level roll-ups for the summary sidebar: what the official value is,
 * how far villages stray from it, how sure we are, and what the advice adds up
 * to. Pure functions over the forecast response, so they are tested directly.
 */

import type { AdvisoryAction, PanchayatForecast, SupportLevel } from '../types/api'
import { VARIABLE_ORDER, VARIABLES, type VariableKey } from './variables'
import { metricValues, spreadMode, type SpreadMode } from './valueSource'

export interface VariableStats {
  key: VariableKey
  label: string
  unit: string
  block: number
  min: number
  max: number
  /** max - min across villages. */
  spread: number
  /** Villages that carry this variable. */
  count: number
  /**
   * How the row reads (see `spreadMode`): the panchayats' range, their
   * rain-chance range (rain served from the block), or "same across panchayats".
   */
  mode: SpreadMode
  /** Lowest and highest rain chance in percent; NaN unless `mode` is 'chance'. */
  chanceMin: number
  chanceMax: number
}

export function variableStats(panchayats: PanchayatForecast[], key: VariableKey): VariableStats | null {
  let min = Infinity
  let max = -Infinity
  let block = Number.NaN
  let label: string = VARIABLES[key].label
  let unit = VARIABLES[key].fallbackUnit
  let count = 0
  for (const p of panchayats) {
    const v = p.variables[key]
    if (!v || !Number.isFinite(v.value)) continue
    count += 1
    if (v.value < min) min = v.value
    if (v.value > max) max = v.value
    if (Number.isNaN(block) && Number.isFinite(v.block_value)) block = v.block_value
    label = v.label || label
    unit = v.unit || unit
  }
  if (count === 0) return null
  const mode = spreadMode(panchayats, key)
  const chances = mode === 'chance' ? metricValues(panchayats, key, 'chance') : []
  const chanceMin = chances.length ? Math.min(...chances) : Number.NaN
  const chanceMax = chances.length ? Math.max(...chances) : Number.NaN
  return { key, label, unit, block, min, max, spread: max - min, count, mode, chanceMin, chanceMax }
}

export function allVariableStats(panchayats: PanchayatForecast[]): VariableStats[] {
  return VARIABLE_ORDER.map((k) => variableStats(panchayats, k)).filter(
    (s): s is VariableStats => s !== null,
  )
}

export type SupportCounts = Record<SupportLevel, number>

/** How many villages sit at each support level for one variable. */
export function supportCounts(panchayats: PanchayatForecast[], key: VariableKey): SupportCounts {
  const counts: SupportCounts = { high: 0, medium: 0, low: 0 }
  for (const p of panchayats) {
    const s = p.variables[key]?.confidence.support
    if (s && s in counts) counts[s] += 1
  }
  return counts
}

const SUPPORT_WORD: Record<SupportLevel, string> = {
  high: 'well supported',
  medium: 'moderate',
  low: 'low',
}

/** "18 moderate · 7 low" — zero counts are left out. */
export function describeSupportCounts(counts: SupportCounts): string {
  const parts = (['high', 'medium', 'low'] as SupportLevel[])
    .filter((l) => counts[l] > 0)
    .map((l) => `${counts[l]} ${SUPPORT_WORD[l]}`)
  return parts.length ? parts.join(' · ') : 'No confidence data'
}

export type ActionCounts = Record<AdvisoryAction, number>

export interface ActivityRollup {
  /** Activity name as the API writes it, e.g. "Pesticide spraying". */
  activity: string
  /** Short name for tight spaces, e.g. "Spraying". */
  short: string
  counts: ActionCounts
  total: number
}

const SHORT_ACTIVITY: Record<string, string> = {
  'Pesticide spraying': 'Spraying',
  'Fertiliser application': 'Fertiliser',
  Harvesting: 'Harvest',
  Irrigation: 'Irrigation',
}

export function shortActivity(activity: string): string {
  return SHORT_ACTIVITY[activity] ?? activity
}

/** Most restrictive first — the order an officer needs to read them in. */
export const ACTION_ORDER: AdvisoryAction[] = ['avoid', 'caution', 'proceed', 'no_guidance']

/**
 * Count each advisory action per activity across every gram panchayat, keeping
 * activities in the order the API first lists them.
 */
export function rollupAdvice(panchayats: PanchayatForecast[]): ActivityRollup[] {
  const byActivity = new Map<string, ActivityRollup>()
  for (const p of panchayats) {
    for (const item of p.advisory.items) {
      let row = byActivity.get(item.activity)
      if (!row) {
        row = {
          activity: item.activity,
          short: shortActivity(item.activity),
          counts: { avoid: 0, caution: 0, proceed: 0, no_guidance: 0 },
          total: 0,
        }
        byActivity.set(item.activity, row)
      }
      const action: AdvisoryAction = item.action in row.counts ? item.action : 'no_guidance'
      row.counts[action] += 1
      row.total += 1
    }
  }
  return [...byActivity.values()]
}

const ACTION_WORD: Record<AdvisoryAction, string> = {
  avoid: 'avoid',
  caution: 'caution',
  proceed: 'ok',
  no_guidance: 'no advice',
}

export function actionWord(action: AdvisoryAction): string {
  return ACTION_WORD[action]
}

/** "Spraying: avoid in 12 panchayats, caution in 8, ok in 5". */
export function describeRollup(row: ActivityRollup): string {
  const parts = ACTION_ORDER.filter((a) => row.counts[a] > 0).map(
    (a, i) => `${ACTION_WORD[a]} in ${row.counts[a]}${i === 0 ? (row.counts[a] === 1 ? ' panchayat' : ' panchayats') : ''}`,
  )
  return `${row.short}: ${parts.join(', ')}`
}

/** Replace the API's variable keys with readable names in a free-text note. */
export function humaniseNote(note: string): string {
  const names: Record<string, string> = {
    precip: 'rain',
    tmax: 'max temperature',
    tmin: 'min temperature',
    humidity: 'humidity',
    wind: 'wind',
  }
  return note.replace(/\b(precip|tmax|tmin)\b/g, (m) => names[m] ?? m)
}

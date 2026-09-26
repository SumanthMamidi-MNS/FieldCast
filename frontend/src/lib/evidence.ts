/**
 * Turns the raw evaluation reports into what the Evidence page shows: one
 * honest outcome per variable, a shared chart axis, and plain sentences.
 * Losses are classified with the same care as wins.
 */

import type { EvaluationReport, EvaluationReports, EvaluationRow } from '../types/api'
import { VARIABLE_ORDER } from './variables'

export type Outcome = 'clear-win' | 'uncertain-win' | 'even' | 'loss'

/**
 * - **loss**: skill <= 0, or the evaluator says it does not beat naive.
 * - **clear-win**: positive skill and the whole 90% interval is above zero,
 *   and significance was actually testable.
 * - **uncertain-win**: positive but not established (interval crosses zero,
 *   or too few gauges to test).
 * - **even**: within 1% of the block value either way — no real difference.
 */
export const EVEN_BAND = 0.01

export function classifyOutcome(row: EvaluationRow): Outcome {
  const verdict = (row.verdict ?? '').toLowerCase()
  if (row.skill_vs_naive <= 0 || verdict.includes('not beat')) {
    return row.skill_vs_naive > -EVEN_BAND && !verdict.includes('not beat') ? 'even' : 'loss'
  }
  // Rounds to 0%: calling it "better" would overclaim.
  if (row.skill_vs_naive < EVEN_BAND) return 'even'
  const ciLow = row.skill_ci90?.[0]
  const untestable = verdict.includes('not testable') || verdict.includes('not significant')
  if (ciLow !== undefined && ciLow > 0 && !untestable) return 'clear-win'
  return 'uncertain-win'
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  'clear-win': 'Better than block value',
  'uncertain-win': 'Slightly better, not proven',
  even: 'No real difference',
  loss: 'Not better than block value',
}

/** Skill as a signed percentage: 0.455 -> "+46%", -0.18 -> "−18%". */
export function formatSkill(skill: number): string {
  if (!Number.isFinite(skill)) return '—'
  const pct = Math.round(skill * 100)
  if (pct === 0) return '0%'
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`
}

/** Rows of one tier in the app's variable order, unknown variables last. */
export function orderedRows(tier: Record<string, EvaluationRow> | undefined): EvaluationRow[] {
  if (!tier) return []
  const rows = Object.values(tier)
  const rank = (v: string) => {
    const i = (VARIABLE_ORDER as string[]).indexOf(v)
    return i === -1 ? 99 : i
  }
  return rows.sort((a, b) => rank(a.variable) - rank(b.variable))
}

/**
 * One symmetric-ish axis for a set of rows: always includes zero (the naive
 * baseline) and every interval end, padded and rounded out to 10% steps.
 */
export function skillAxis(rows: EvaluationRow[]): { min: number; max: number } {
  let min = 0
  let max = 0
  for (const r of rows) {
    const lo = r.skill_ci90?.[0] ?? r.skill_vs_naive
    const hi = r.skill_ci90?.[1] ?? r.skill_vs_naive
    for (const v of [r.skill_vs_naive, lo, hi]) {
      if (!Number.isFinite(v)) continue
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  const step = 0.1
  min = Math.floor((min - 0.02) / step) * step
  max = Math.ceil((max + 0.02) / step) * step
  if (max - min < 0.4) max = min + 0.4
  // Tidy float noise (e.g. -0.30000000000000004).
  return { min: Number(min.toFixed(2)), max: Number(max.toFixed(2)) }
}

/** Rain / no-rain improvement over the naive block call: 1 - brier/brier_naive. */
export function occurrenceGain(row: EvaluationRow): number | null {
  const o = row.occurrence
  if (!o || !Number.isFinite(o.brier) || !Number.isFinite(o.brier_naive_block) || o.brier_naive_block <= 0) {
    return null
  }
  return 1 - o.brier / o.brier_naive_block
}

export interface BaselineLoss {
  name: string
  skill: number
}

const BASELINE_NAMES: Record<string, string> = {
  B1_idw: 'distance-weighted average of nearby blocks',
  B2_lapse_rate: 'simple elevation (lapse-rate) correction',
  B3_bilinear: 'bilinear regrid',
}

export function baselineName(key: string): string {
  return BASELINE_NAMES[key] ?? key
}

/** Smarter baselines the model does not beat — shown, never hidden. */
export function baselineLosses(row: EvaluationRow): BaselineLoss[] {
  return Object.entries(row.baselines ?? {})
    .filter(([, b]) => Number.isFinite(b.model_skill_vs_this) && b.model_skill_vs_this <= 0)
    .map(([k, b]) => ({ name: baselineName(k), skill: b.model_skill_vs_this }))
}

const REGION_NAMES: Record<string, string> = {
  mh_ghats: 'Maharashtra Western Ghats',
  ka_ghats: 'Karnataka Western Ghats',
  ka_transfer: 'Karnataka Western Ghats',
}

export function regionName(key: string | undefined): string {
  if (!key) return 'Unknown region'
  return REGION_NAMES[key] ?? key.replace(/_/g, ' ')
}

export interface SortedReports {
  home: [string, EvaluationReport][]
  transfer: [string, EvaluationReport][]
}

/** Split reports into in-region evaluations and transfer tests. */
export function splitReports(reports: EvaluationReports | null): SortedReports {
  const entries = Object.entries(reports ?? {}).filter(
    ([, r]) => r && typeof r === 'object' && (r.T1 || r.T2),
  )
  return {
    home: entries.filter(([, r]) => !r.transfer),
    transfer: entries.filter(([, r]) => r.transfer),
  }
}

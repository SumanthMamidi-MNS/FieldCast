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

/** New transfer reports are named `evaluation_<region>_from_<model region>`. */
const TRANSFER_STEM = /_from_[a-z0-9_]+$/i

function isTransfer(key: string, r: EvaluationReport): boolean {
  return r.transfer === true || TRANSFER_STEM.test(key)
}

function hasRows(tier: Record<string, EvaluationRow> | undefined): boolean {
  return !!tier && typeof tier === 'object' && Object.keys(tier).length > 0
}

/**
 * Split reports into in-region evaluations and transfer tests.
 *
 * Transfer reports are recognised by their `transfer` flag or by the new
 * `_from_` file name. An older transfer report (e.g. `evaluation_ka_transfer`)
 * is still shown, unless a new-style report covers the same pair of regions,
 * in which case the newer one wins rather than the page repeating itself.
 */
export function splitReports(reports: EvaluationReports | null): SortedReports {
  const entries = Object.entries(reports ?? {}).filter(
    ([, r]) => r && typeof r === 'object' && (hasRows(r.T1) || hasRows(r.T2) || hasRows(r.T2_hist)),
  )
  const transfer = entries.filter(([k, r]) => isTransfer(k, r))
  const pair = (r: EvaluationReport) => `${regionName(r.region)}|${regionName(r.model_region)}`
  const newPairs = new Set(transfer.filter(([k]) => TRANSFER_STEM.test(k)).map(([, r]) => pair(r)))
  return {
    home: entries.filter(([k, r]) => !isTransfer(k, r)),
    transfer: transfer
      .filter(([k, r]) => TRANSFER_STEM.test(k) || !newPairs.has(pair(r)))
      .sort(([a], [b]) => a.localeCompare(b)),
  }
}

/** Every row a report carries, across all tiers, for the summary and shared axis. */
export function allReportRows(r: EvaluationReport): EvaluationRow[] {
  return [...orderedRows(r.T1), ...orderedRows(r.T2), ...orderedRows(r.T2_hist)]
}

/** The most gauges any row of a gauge tier was scored at (null when unknown). */
export function gaugeCount(rows: EvaluationRow[]): number | null {
  const counts = rows.map((r) => r.n_clusters).filter((n): n is number => typeof n === 'number' && n > 0)
  return counts.length ? Math.max(...counts) : null
}

/** "~100": a round, honest figure for a historical gauge count. */
export function approxCount(n: number): string {
  if (n < 20) return String(n)
  return `~${Math.round(n / 10) * 10}`
}

/** How close an 80% range came to holding the truth 8 times in 10. */
export type CoverageFit = 'near' | 'narrow' | 'wide'

/** Within 5 points of 80% counts as near; below is too narrow, above too cautious. */
export const COVERAGE_TOLERANCE = 0.05

export function coverageFit(coverage: number): CoverageFit {
  if (coverage < 0.8 - COVERAGE_TOLERANCE) return 'narrow'
  if (coverage > 0.8 + COVERAGE_TOLERANCE) return 'wide'
  return 'near'
}

/** True when the report says its range widening was fitted on the 1958 monsoon. */
export function calibratedOn1958(r: EvaluationReport): boolean {
  return Object.values(r.scale_calibration ?? {}).some((c) =>
    (c.periods ?? []).some(([start]) => typeof start === 'string' && start.startsWith('1958')),
  )
}

/**
 * The plain sentence shown beside a row whose point value the API serves from
 * the official block value (`point_is_block`), or null for model-served rows.
 * Scores the report does not carry are left out rather than guessed.
 */
export function blockServedNote(row: EvaluationRow): { lead: string; rest: string } | null {
  if (row.point_is_block !== true) return null
  const val = row.validation_served_skill
  const raw = row.raw_model_skill_vs_naive
  const scored = typeof val === 'number' && Number.isFinite(val)
  const lead = scored
    ? `Block value served: the model scored ${formatSkill(val)} on validation, so FieldCast serves the official value (skill 0 by design).`
    : 'Block value served: the model did not beat the block value on validation, so FieldCast serves the official value (skill 0 by design).'
  const rest =
    typeof raw === 'number' && Number.isFinite(raw) ? `The model alone scored ${formatSkill(raw)} on the test data.` : ''
  return { lead, rest }
}

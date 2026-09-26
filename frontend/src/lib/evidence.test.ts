import { describe, expect, it } from 'vitest'
import type { EvaluationRow } from '../types/api'
import {
  baselineLosses,
  classifyOutcome,
  formatSkill,
  occurrenceGain,
  skillAxis,
  splitReports,
} from './evidence'
import { parseRoute } from './route'

function row(partial: Partial<EvaluationRow>): EvaluationRow {
  return {
    variable: 'tmax',
    label: 'Max temperature',
    unit: '°C',
    n: 100,
    model_mae: 1,
    naive_mae: 2,
    skill_vs_naive: 0.5,
    ...partial,
  }
}

describe('classifyOutcome', () => {
  it('calls a significant positive result a clear win', () => {
    expect(
      classifyOutcome(row({ skill_ci90: [0.41, 0.49], verdict: 'beats naive (significant)' })),
    ).toBe('clear-win')
  })

  it('does not overclaim when the interval crosses zero', () => {
    expect(
      classifyOutcome(
        row({ skill_vs_naive: 0.06, skill_ci90: [-0.03, 0.14], verdict: 'beats naive (not significant)' }),
      ),
    ).toBe('uncertain-win')
  })

  it('does not overclaim when significance was untestable', () => {
    expect(
      classifyOutcome(
        row({ skill_ci90: [0.09, 0.65], verdict: 'beats naive (only 4 gauges: significance not testable)' }),
      ),
    ).toBe('uncertain-win')
  })

  it('calls a result that rounds to 0% even, not better', () => {
    expect(classifyOutcome(row({ skill_vs_naive: 0.0007, skill_ci90: [-0.02, 0.01] }))).toBe('even')
    expect(classifyOutcome(row({ skill_vs_naive: -0.004 }))).toBe('even')
  })

  it('reports losses as losses', () => {
    expect(classifyOutcome(row({ skill_vs_naive: -0.18, verdict: 'does NOT beat naive' }))).toBe('loss')
  })
})

describe('skillAxis', () => {
  it('always includes zero and every interval end', () => {
    const axis = skillAxis([
      row({ skill_vs_naive: 0.62, skill_ci90: [0.57, 0.67] }),
      row({ skill_vs_naive: -0.18, skill_ci90: [-0.25, -0.13] }),
    ])
    expect(axis.min).toBeLessThanOrEqual(-0.25)
    expect(axis.max).toBeGreaterThanOrEqual(0.67)
    expect(axis.min).toBe(-0.3)
    expect(axis.max).toBe(0.7)
  })
})

describe('formatting and derived numbers', () => {
  it('formats skill as a signed percentage', () => {
    expect(formatSkill(0.455)).toBe('+46%')
    expect(formatSkill(-0.181)).toBe('−18%')
    expect(formatSkill(0.001)).toBe('0%')
  })

  it('computes rain/no-rain gain over the naive call', () => {
    const gain = occurrenceGain(row({ occurrence: { brier: 0.19, brier_naive_block: 0.265 } }))
    expect(gain).toBeCloseTo(0.283, 3)
    expect(occurrenceGain(row({}))).toBeNull()
  })

  it('surfaces smarter baselines the model loses to', () => {
    const losses = baselineLosses(
      row({
        baselines: {
          B1_idw: { mae: 1, model_skill_vs_this: 0.4 },
          B2_lapse_rate: { mae: 0.88, model_skill_vs_this: -0.076 },
        },
      }),
    )
    expect(losses).toHaveLength(1)
    expect(losses[0]!.name).toMatch(/lapse-rate/)
  })

  it('splits home and transfer reports and ignores empty ones', () => {
    const split = splitReports({
      a: { region: 'mh_ghats', transfer: false, T1: {} },
      b: { region: 'ka_transfer', transfer: true, T2: {} },
      c: { region: 'x' },
    })
    expect(split.home.map(([k]) => k)).toEqual(['a'])
    expect(split.transfer.map(([k]) => k)).toEqual(['b'])
    expect(splitReports(null).home).toEqual([])
  })
})

describe('parseRoute', () => {
  it('maps hashes to pages and defaults to the forecast', () => {
    expect(parseRoute('#/evidence')).toBe('evidence')
    expect(parseRoute('#/how-it-works')).toBe('how')
    expect(parseRoute('#/evidence?x=1')).toBe('evidence')
    expect(parseRoute('')).toBe('forecast')
    expect(parseRoute('#/nope')).toBe('forecast')
  })
})

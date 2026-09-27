import { describe, expect, it } from 'vitest'
import type { EvaluationRow } from '../types/api'
import {
  approxCount,
  baselineLosses,
  calibratedOn1958,
  classifyOutcome,
  coverageFit,
  gaugeCount,
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
      a: { region: 'mh_ghats', transfer: false, T1: { tmax: row({}) } },
      b: { region: 'ka_transfer', transfer: true, T2: { tmax: row({}) } },
      c: { region: 'x' },
      d: { region: 'y', T1: {}, T2: {}, T2_hist: {} },
    })
    expect(split.home.map(([k]) => k)).toEqual(['a'])
    expect(split.transfer.map(([k]) => k)).toEqual(['b'])
    expect(splitReports(null).home).toEqual([])
  })

  it('keeps a report whose only results are the historical gauges', () => {
    const split = splitReports({ evaluation_mh_ghats: { region: 'mh_ghats', T2_hist: { precip: row({}) } } })
    expect(split.home).toHaveLength(1)
  })

  it('recognises the new transfer report name and prefers it over the old one', () => {
    const t = { tmax: row({}) }
    const both = splitReports({
      evaluation_mh_ghats: { region: 'mh_ghats', transfer: false, T1: t },
      evaluation_ka_transfer: { region: 'ka_transfer', model_region: 'mh_ghats', transfer: true, T1: t },
      evaluation_ka_ghats_from_mh_ghats: { region: 'ka_ghats', model_region: 'mh_ghats', T1: t },
    })
    expect(both.home.map(([k]) => k)).toEqual(['evaluation_mh_ghats'])
    expect(both.transfer.map(([k]) => k)).toEqual(['evaluation_ka_ghats_from_mh_ghats'])

    const oldOnly = splitReports({
      evaluation_ka_transfer: { region: 'ka_transfer', model_region: 'mh_ghats', transfer: true, T1: t },
    })
    expect(oldOnly.transfer.map(([k]) => k)).toEqual(['evaluation_ka_transfer'])
  })

  it("does not mistake Karnataka's own model for a transfer test", () => {
    const split = splitReports({
      evaluation_ka_ghats: { region: 'ka_ghats', model_region: 'ka_ghats', transfer: false, T1: { tmax: row({}) } },
    })
    expect(split.home).toHaveLength(1)
    expect(split.transfer).toHaveLength(0)
  })
})

describe('historical gauges', () => {
  it('reads the gauge count from n_clusters and rounds it honestly', () => {
    expect(gaugeCount([row({ n_clusters: 97 }), row({ n_clusters: 101 })])).toBe(101)
    expect(gaugeCount([row({})])).toBeNull()
    expect(approxCount(97)).toBe('~100')
    expect(approxCount(4)).toBe('4')
  })

  it('says whether the 80% range coverage is near 80%', () => {
    expect(coverageFit(0.78)).toBe('near')
    expect(coverageFit(0.85)).toBe('near')
    expect(coverageFit(0.7)).toBe('narrow')
    expect(coverageFit(0.92)).toBe('wide')
  })

  it('knows when the range widening was fitted on 1958', () => {
    const base = { region: 'mh_ghats' }
    expect(calibratedOn1958({ ...base, scale_calibration: { precip: { factor: 2, periods: [['1958-06-01', '1958-09-30']] } } })).toBe(true)
    expect(calibratedOn1958({ ...base, scale_calibration: { precip: { factor: 2, periods: [['2019-06-01', '2019-09-30']] } } })).toBe(false)
    expect(calibratedOn1958(base)).toBe(false)
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

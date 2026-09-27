import { describe, expect, it } from 'vitest'
import {
  describeRollup,
  describeSupportCounts,
  humaniseNote,
  rollupAdvice,
  supportCounts,
  variableStats,
} from './blockSummary'
import { item, variable, village } from './testFixtures'

const rows = [
  village('a', 'A', { tmax: variable('tmax', 27.3, 27.6, 'medium') }, [
    item('Pesticide spraying', 'avoid'),
    item('Irrigation', 'proceed'),
  ]),
  village('b', 'B', { tmax: variable('tmax', 28.4, 27.6, 'low') }, [
    item('Pesticide spraying', 'avoid'),
    item('Irrigation', 'caution'),
  ]),
  village('c', 'C', { tmax: variable('tmax', 26.9, 27.6, 'medium') }, [
    item('Pesticide spraying', 'caution'),
    item('Irrigation', 'proceed'),
  ]),
  village('d', 'D', {}, [item('Pesticide spraying', 'proceed')]),
]

describe('variableStats', () => {
  it('reports block value, range and spread over villages that have the variable', () => {
    const s = variableStats(rows, 'tmax')!
    expect(s.block).toBe(27.6)
    expect(s.min).toBe(26.9)
    expect(s.max).toBe(28.4)
    expect(s.spread).toBeCloseTo(1.5, 6)
    expect(s.count).toBe(3)
  })

  it('returns null for a variable no village has', () => {
    expect(variableStats(rows, 'wind')).toBeNull()
  })
})

describe('supportCounts', () => {
  it('counts villages per support level', () => {
    const c = supportCounts(rows, 'tmax')
    expect(c).toEqual({ high: 0, medium: 2, low: 1 })
    expect(describeSupportCounts(c)).toBe('2 moderate · 1 low')
  })
})

describe('advice roll-up', () => {
  const rollup = rollupAdvice(rows)

  it('counts every action per activity, in the order the API lists them', () => {
    expect(rollup.map((r) => r.activity)).toEqual(['Pesticide spraying', 'Irrigation'])
    expect(rollup[0]!.counts).toEqual({ avoid: 2, caution: 1, proceed: 1, no_guidance: 0 })
    expect(rollup[0]!.total).toBe(4)
    expect(rollup[1]!.counts.proceed).toBe(2)
  })

  it('reads as one plain sentence, most restrictive first', () => {
    expect(describeRollup(rollup[0]!)).toBe('Spraying: avoid in 2 panchayats, caution in 1, ok in 1')
    expect(describeRollup(rollup[1]!)).toBe('Irrigation: caution in 1 panchayat, ok in 2')
  })
})

describe('humaniseNote', () => {
  it('replaces variable keys with words', () => {
    expect(humaniseNote('Differentiated for: precip, tmax, wind.')).toBe(
      'Differentiated for: rain, max temperature, wind.',
    )
  })
})

import { describe, expect, it } from 'vitest'
import { variableStats } from './blockSummary'
import { blockServedNote } from './evidence'
import { blockScale } from './mapScale'
import { variable, village } from './testFixtures'
import {
  CHANCE_MIN_REACH,
  blockValueNote,
  chanceDomain,
  formatMetric,
  isBlockSourced,
  metricValue,
  rainMapMode,
  spreadMode,
  variableSource,
} from './valueSource'
import { sortVillages } from './villageList'

const blockRain = (id: string, chance: number | null) =>
  village(id, id.toUpperCase(), {
    precip: variable('precip', 12.4, 12.4, 'medium', { source: 'block', chance }),
    tmax: variable('tmax', 27 + (chance ?? 0) * 2, 27.5),
  })

const modelRain = (id: string, mm: number) =>
  village(id, id.toUpperCase(), { precip: variable('precip', mm, 10, 'medium', { chance: 0.5 }) })

describe('isBlockSourced / variableSource', () => {
  it('reads value_source', () => {
    expect(isBlockSourced(variable('precip', 1, 1, 'medium', { source: 'block' }))).toBe(true)
    expect(isBlockSourced(variable('precip', 1, 1))).toBe(false)
    expect(isBlockSourced(undefined)).toBe(false)
  })

  it('is "block" only when every panchayat carrying the variable says so', () => {
    const rows = [blockRain('a', 0.3), blockRain('b', 0.6), village('c', 'C', {})]
    expect(variableSource(rows, 'precip')).toBe('block')
    expect(variableSource(rows, 'tmax')).toBe('model')
    expect(variableSource([...rows, modelRain('d', 3)], 'precip')).toBe('model')
    expect(variableSource([], 'precip')).toBe('model')
  })
})

describe('rainMapMode', () => {
  it('shows chance of rain when the rain amount is the block value', () => {
    expect(rainMapMode([blockRain('a', 0.3), blockRain('b', 0.6)], 'precip')).toBe('chance')
  })

  it('keeps the amount map when rain comes from the model', () => {
    expect(rainMapMode([modelRain('a', 3), modelRain('b', 9)], 'precip')).toBe('amount')
  })

  it('keeps the amount when no panchayat carries a rain chance', () => {
    expect(rainMapMode([blockRain('a', null), blockRain('b', null)], 'precip')).toBe('amount')
  })

  it('never applies to other variables, even block-sourced ones', () => {
    const rows = [village('a', 'A', { wind: variable('wind', 9, 9, 'medium', { source: 'block' }) })]
    expect(rainMapMode(rows, 'wind')).toBe('amount')
  })
})

describe('metricValue / formatMetric', () => {
  const v = variable('precip', 12.4, 12.4, 'medium', { source: 'block', chance: 0.624 })
  it('gives chance in percent or the value', () => {
    expect(metricValue(v, 'chance')).toBeCloseTo(62.4)
    expect(metricValue(v, 'amount')).toBe(12.4)
    expect(metricValue(undefined, 'amount')).toBeNaN()
    expect(metricValue(variable('tmax', 30, 30), 'chance')).toBeNaN()
  })
  it('formats chance as a whole percentage', () => {
    expect(formatMetric(62.4, 'precip', 'chance')).toBe('62%')
    expect(formatMetric(12.4, 'precip', 'amount', 'mm')).toBe('12.4 mm')
    expect(formatMetric(Number.NaN, 'precip', 'chance')).toBe('—')
  })
})

describe('chanceDomain', () => {
  it("fits the block's own lowest and highest chance", () => {
    const d = chanceDomain([30, 45, 62])
    expect([d.min, d.max, d.dataMin, d.dataMax]).toEqual([30, 62, 30, 62])
    expect(d.block).toBeNaN()
  })

  it('never stretches a spread narrower than the minimum reach', () => {
    const d = chanceDomain([41, 43])
    expect(d.max - d.min).toBeCloseTo(CHANCE_MIN_REACH)
    expect(d.min).toBeCloseTo(37)
  })

  it('stays inside 0–100', () => {
    expect(chanceDomain([1, 2])).toMatchObject({ min: 0, max: CHANCE_MIN_REACH })
    expect(chanceDomain([99, 100])).toMatchObject({ min: 100 - CHANCE_MIN_REACH, max: 100 })
  })

  it('degrades to 0–100 with no data', () => {
    expect(chanceDomain([])).toMatchObject({ min: 0, max: 100 })
  })
})

describe('blockScale in chance mode', () => {
  const rows = [blockRain('a', 0.3), blockRain('b', 0.45), blockRain('c', 0.62)]
  it('reports the metric and colours drier-looking villages paler', () => {
    const { metric, scale, domain } = blockScale(rows, 'precip')
    expect(metric).toBe('chance')
    expect(domain.dataMin).toBeCloseTo(30)
    expect(domain.dataMax).toBeCloseTo(62)
    expect(scale.normalize(30)).toBe(0)
    expect(scale.normalize(62)).toBe(1)
  })
  it('leaves other variables on their value', () => {
    expect(blockScale(rows, 'tmax').metric).toBe('amount')
  })
})

describe('summary row and list follow the same mode', () => {
  const rows = [blockRain('a', 0.3), blockRain('b', 0.62), blockRain('c', 0.45)]

  it('summary: rain shows the rain-chance range', () => {
    expect(spreadMode(rows, 'precip')).toBe('chance')
    const s = variableStats(rows, 'precip')!
    expect(s.mode).toBe('chance')
    expect(s.block).toBe(12.4)
    expect([s.chanceMin, s.chanceMax]).toEqual([30, 62])
  })

  it('summary: any other block-sourced variable reads "same"', () => {
    const w = [village('a', 'A', { wind: variable('wind', 9, 9, 'medium', { source: 'block' }) })]
    expect(spreadMode(w, 'wind')).toBe('same')
    expect(spreadMode(rows, 'tmax')).toBe('range')
  })

  it('list: sorts by chance of rain when the map does', () => {
    const ids = (r: typeof rows) => r.map((x) => x.panchayat_id)
    expect(ids(sortVillages(rows, 'value-desc', 'precip', 'chance'))).toEqual(['b', 'c', 'a'])
    expect(ids(sortVillages(rows, 'value-asc', 'precip', 'chance'))).toEqual(['a', 'c', 'b'])
    // Amount is identical everywhere, so the old sort falls back to names.
    expect(ids(sortVillages(rows, 'value-desc', 'precip'))).toEqual(['a', 'b', 'c'])
  })
})

describe('wording', () => {
  it('names the rain chance only when there is one', () => {
    expect(blockValueNote(true)).toContain('The range and rain chance are panchayat-specific.')
    expect(blockValueNote(false)).toContain('The range is panchayat-specific.')
    expect(blockValueNote(false)).toMatch(/^Official block value: /)
  })

  it('explains a block-served evidence row with both scores', () => {
    const note = blockServedNote({
      variable: 'precip',
      label: 'Rainfall',
      unit: 'mm',
      n: 1,
      model_mae: 1,
      naive_mae: 1,
      skill_vs_naive: 0,
      point_is_block: true,
      validation_served_skill: -0.0745,
      raw_model_skill_vs_naive: 0.0527,
    })!
    expect(note.lead).toBe(
      'Block value served: the model scored −7% on validation, so FieldCast serves the official value (skill 0 by design).',
    )
    expect(note.rest).toBe('The model alone scored +5% on the test data.')
  })

  it('says nothing for model-served rows', () => {
    expect(
      blockServedNote({ variable: 'tmax', label: 'T', unit: '°C', n: 1, model_mae: 1, naive_mae: 2, skill_vs_naive: 0.5 }),
    ).toBeNull()
  })
})

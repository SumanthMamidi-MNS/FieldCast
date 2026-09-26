import { describe, expect, it } from 'vitest'
import { isDiverging, luminance, relativeDomain } from './colorScale'
import { blockScale } from './mapScale'
import { variable, village } from './testFixtures'
import { formatDelta } from './variables'

describe('relativeDomain — diverging', () => {
  it('centres on the block value and reaches the furthest village', () => {
    const d = relativeDomain([30.8, 31.2, 32.8], 31.7, { diverging: true, minReach: 0.5 })
    expect(d.mid).toBe(31.7)
    expect(d.min).toBeCloseTo(30.6, 6) // reach = max(1.1, 0.9)
    expect(d.max).toBeCloseTo(32.8, 6)
    expect(d.dataMin).toBe(30.8)
    expect(d.dataMax).toBe(32.8)
  })

  it('never stretches sub-resolution noise across the full ramp', () => {
    const d = relativeDomain([22.01, 22.02], 22.0, { diverging: true, minReach: 0.3 })
    expect(d.max - d.mid!).toBeCloseTo(0.3, 6)
  })

  it('survives an empty block and a missing block value', () => {
    const d = relativeDomain([], Number.NaN, { diverging: true, minReach: 1 })
    expect(d.max).toBeGreaterThan(d.min)
    expect(Number.isNaN(d.dataMin)).toBe(true)
  })
})

describe('relativeDomain — sequential rain', () => {
  it('runs from zero to the block maximum', () => {
    const d = relativeDomain([0, 3.2, 8.61], 1.92, { diverging: false, minReach: 1 })
    expect(d.min).toBe(0)
    expect(d.max).toBe(8.61)
    expect(d.mid).toBeUndefined()
  })

  it('keeps the block value inside when it exceeds every village', () => {
    expect(relativeDomain([1, 2], 5, { diverging: false, minReach: 1 }).max).toBe(5)
  })

  it('does not paint a dry block dark blue', () => {
    expect(relativeDomain([0, 0.1], 0, { diverging: false, minReach: 1 }).max).toBe(1)
  })
})

describe('blockScale on the wind case the owner reported', () => {
  // 30.8-32.8 km/h used to render as one purple on a 0-35 scale.
  const rows = [30.8, 31.3, 31.9, 32.8].map((v, i) =>
    village(`p${i}`, `V${i}`, { wind: variable('wind', v, 31.72) }),
  )
  const { scale, domain } = blockScale(rows, 'wind')

  it('uses a diverging scale for wind', () => {
    expect(isDiverging(scale.kind)).toBe(true)
    expect(domain.mid).toBe(31.72)
  })

  it('spreads the block across most of the ramp', () => {
    expect(scale.normalize(30.8)).toBeLessThan(0.1)
    expect(scale.normalize(32.8)).toBeGreaterThan(0.9)
    expect(scale.normalize(31.72)).toBeCloseTo(0.5, 6)
  })

  it('makes the calmest and windiest villages visibly different', () => {
    const lo = scale.color(30.8)
    const hi = scale.color(32.8)
    expect(lo).not.toBe(hi)
    expect(Math.abs(luminance(lo) - luminance(hi))).toBeGreaterThan(0.05)
  })
})

describe('formatDelta', () => {
  it('signs and units the difference from the block', () => {
    expect(formatDelta(0.84, 'tmax', '°C')).toBe('+0.8°C')
    expect(formatDelta(-1.26, 'precip', 'mm')).toBe('−1.3 mm')
  })

  it('never shows a flat village as having moved', () => {
    expect(formatDelta(0.04, 'tmax', '°C')).toBe('±0°C')
    expect(formatDelta(-0.4, 'humidity', '%')).toBe('±0%')
  })
})

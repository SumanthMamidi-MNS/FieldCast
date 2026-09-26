import { describe, expect, it } from 'vitest'
import { isDiverging, luminance, relativeDomain } from './colorScale'
import { blockScale } from './mapScale'
import { variable, village } from './testFixtures'

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
    expect(d.fit).toBe('zero')
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

describe('relativeDomain — rain when every village is wet', () => {
  const opts = { diverging: false, minReach: 1, dryBelow: 0.5 }

  it('fits the villages range instead of starting at zero', () => {
    const d = relativeDomain([22.1, 23.4, 24.9], 24, opts)
    expect(d.fit).toBe('range')
    expect(d.min).toBeCloseTo(22.1, 6)
    expect(d.max).toBeCloseTo(24.9, 6)
  })

  it('stays zero-anchored while any village is dry', () => {
    const d = relativeDomain([0.2, 6, 12], 5, opts)
    expect(d.fit).toBe('zero')
    expect(d.min).toBe(0)
    expect(d.max).toBe(12)
  })

  it('keeps the block value inside the fitted range', () => {
    const d = relativeDomain([22, 23], 25, opts)
    expect(d.min).toBe(22)
    expect(d.max).toBe(25)
  })

  it('does not amplify a sub-resolution spread', () => {
    const d = relativeDomain([23.1, 23.3], 23.2, opts)
    expect(d.max - d.min).toBeCloseTo(1, 6)
    expect(d.min).toBeCloseTo(22.7, 6)
  })

  it('makes the 24 mm bulletin case visibly different on the map', () => {
    const rows = [22, 23, 24, 25].map((v, i) => village(`p${i}`, `V${i}`, { precip: variable('precip', v, 24) }))
    const { scale, domain } = blockScale(rows, 'precip')
    expect(domain.fit).toBe('range')
    expect(scale.normalize(22)).toBeLessThan(0.05)
    expect(scale.normalize(25)).toBeGreaterThan(0.95)
    expect(Math.abs(luminance(scale.color(22)) - luminance(scale.color(25)))).toBeGreaterThan(0.3)
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

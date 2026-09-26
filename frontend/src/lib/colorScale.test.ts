import { describe, expect, it } from 'vitest'
import {
  NO_DATA_COLOR,
  buildScale,
  clamp01,
  luminance,
  niceDomain,
  readableInk,
  sampleRamp,
} from './colorScale'

describe('clamp01', () => {
  it('clamps outside [0,1] and survives non-finite input', () => {
    expect(clamp01(-3)).toBe(0)
    expect(clamp01(1.7)).toBe(1)
    expect(clamp01(0.25)).toBe(0.25)
    expect(clamp01(Number.NaN)).toBe(0)
  })
})

describe('sampleRamp', () => {
  const ramp = ['#000000', '#808080', '#ffffff']

  it('returns ramp endpoints exactly at t=0 and t=1', () => {
    expect(sampleRamp(ramp, 0)).toBe('#000000')
    expect(sampleRamp(ramp, 1)).toBe('#ffffff')
  })

  it('interpolates linearly between stops', () => {
    // Halfway between #000000 and #808080 is #404040.
    expect(sampleRamp(ramp, 0.25)).toBe('#404040')
  })

  it('clamps rather than extrapolating past the ends', () => {
    expect(sampleRamp(ramp, -5)).toBe('#000000')
    expect(sampleRamp(ramp, 42)).toBe('#ffffff')
  })
})

describe('sequential rainfall scale', () => {
  const scale = buildScale('sequential-blue', { min: 0, max: 60 })

  it('maps more rain to a darker blue, monotonically', () => {
    const steps = [0, 10, 20, 30, 40, 50, 60]
    const lums = steps.map((mm) => luminance(scale.color(mm)))
    for (let i = 1; i < lums.length; i++) {
      expect(lums[i] as number).toBeLessThan(lums[i - 1] as number)
    }
  })

  it('normalises to the domain and clamps beyond it', () => {
    expect(scale.normalize(0)).toBeCloseTo(0, 6)
    expect(scale.normalize(30)).toBeCloseTo(0.5, 6)
    expect(scale.normalize(60)).toBeCloseTo(1, 6)
    expect(scale.normalize(-20)).toBe(0)
    expect(scale.normalize(500)).toBe(1)
  })

  it('never returns a ramp colour for a missing value', () => {
    expect(scale.color(Number.NaN)).toBe(NO_DATA_COLOR)
    expect(scale.color(Number.POSITIVE_INFINITY)).toBe(NO_DATA_COLOR)
  })

  it('does not divide by zero when every panchayat has the same value', () => {
    const flat = buildScale('sequential-blue', { min: 12, max: 12 })
    const c = flat.color(12)
    expect(c).toMatch(/^#[0-9a-f]{6}$/)
    expect(flat.normalize(12)).toBe(0.5)
  })
})

describe('diverging temperature scale', () => {
  // Block forecast 31 °C, panchayats spanning 28.5 – 33 °C.
  const scale = buildScale('diverging-temp', { min: 28.5, max: 33, mid: 31 })

  it('puts the neutral colour exactly on the block value', () => {
    expect(scale.normalize(31)).toBeCloseTo(0.5, 6)
  })

  it('sends cooler-than-block one way and warmer-than-block the other', () => {
    expect(scale.normalize(29)).toBeLessThan(0.5)
    expect(scale.normalize(33)).toBeGreaterThan(0.5)
  })

  it('stays symmetric about the midpoint even when the data is lopsided', () => {
    // reach = max(|33-31|, |31-28.5|) = 2.5, so ±1 °C is ±0.2 either side.
    expect(scale.normalize(32)).toBeCloseTo(0.7, 6)
    expect(scale.normalize(30)).toBeCloseTo(0.3, 6)
  })

  it('is not a rainbow: endpoints are cool blue and warm red, mid is neutral', () => {
    const cold = scale.color(28.5)
    const warm = scale.color(33)
    const mid = scale.color(31)
    expect(cold).not.toBe(warm)
    // Neutral middle must be lighter than both ends (diverging lightness profile).
    expect(luminance(mid)).toBeGreaterThan(luminance(cold))
    expect(luminance(mid)).toBeGreaterThan(luminance(warm))
  })
})

describe('readableInk', () => {
  it('picks dark ink on light fills and light ink on dark fills', () => {
    expect(readableInk('#eff6fb')).toBe('#121417')
    expect(readableInk('#083070')).toBe('#ffffff')
  })
})

describe('niceDomain', () => {
  it('anchors rainfall at zero and keeps the block value inside the domain', () => {
    const d = niceDomain([8, 22, 61], { zeroAnchored: true, diverging: false, blockValue: 24 })
    expect(d.min).toBe(0)
    expect(d.max).toBeGreaterThan(61)
    expect(d.mid).toBeUndefined()
  })

  it('uses the block value as the diverging midpoint', () => {
    const d = niceDomain([28.5, 31.2, 33], { zeroAnchored: false, diverging: true, blockValue: 31 })
    expect(d.mid).toBe(31)
    expect(d.min).toBeLessThan(28.5)
    expect(d.max).toBeGreaterThan(33)
  })

  it('widens a degenerate domain instead of producing a zero span', () => {
    const d = niceDomain([5, 5, 5], { zeroAnchored: false, diverging: false, blockValue: 5 })
    expect(d.max - d.min).toBeGreaterThan(0)
  })

  it('handles an empty value list without producing NaN', () => {
    const d = niceDomain([], { zeroAnchored: true, diverging: false })
    expect(Number.isFinite(d.min)).toBe(true)
    expect(Number.isFinite(d.max)).toBe(true)
    expect(d.max).toBeGreaterThan(d.min)
  })
})

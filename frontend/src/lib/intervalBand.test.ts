import { describe, expect, it } from 'vitest'
import {
  MIN_BAND_PX,
  computeBand,
  computeBasisBand,
  rangeBasisOf,
  rangeWording,
  refinementSignal,
} from './intervalBand'

const W = 300

describe('computeBand', () => {
  it('orders the band around the median and keeps it inside the box', () => {
    const g = computeBand({ lower: 40, upper: 78, value: 58, blockValue: 24, width: W })
    expect(g.bandStart).toBeGreaterThanOrEqual(0)
    expect(g.bandStart + g.bandWidth).toBeLessThanOrEqual(W)
    expect(g.valueX).toBeGreaterThanOrEqual(g.bandStart)
    expect(g.valueX).toBeLessThanOrEqual(g.bandStart + g.bandWidth)
    expect(g.valueClamped).toBe(false)
  })

  it('always keeps the block-value tick on the drawn scale', () => {
    // Block value well outside the panchayat interval — the interesting case,
    // because this is exactly what "the refinement is large" looks like.
    const g = computeBand({ lower: 55, upper: 70, value: 61, blockValue: 24, width: W })
    expect(g.blockX).toBeGreaterThanOrEqual(0)
    expect(g.blockX).toBeLessThanOrEqual(W)
    expect(g.scaleMin).toBeLessThanOrEqual(24)
    expect(g.scaleMax).toBeGreaterThanOrEqual(70)
  })

  it('positions the block tick left of the band when the block is drier', () => {
    const g = computeBand({ lower: 55, upper: 70, value: 61, blockValue: 24, width: W })
    expect(g.blockX).toBeLessThan(g.bandStart)
  })

  it('positions the block tick right of the band when the block is wetter', () => {
    const g = computeBand({ lower: 2, upper: 9, value: 5, blockValue: 24, width: W })
    expect(g.blockX).toBeGreaterThan(g.bandStart + g.bandWidth)
  })

  it('gives a zero-width interval a visible minimum width', () => {
    const g = computeBand({ lower: 12, upper: 12, value: 12, blockValue: 12, width: W })
    expect(g.bandWidth).toBeGreaterThanOrEqual(MIN_BAND_PX)
    expect(g.bandStart).toBeGreaterThanOrEqual(0)
    expect(g.bandStart + g.bandWidth).toBeLessThanOrEqual(W)
    expect(Number.isFinite(g.scaleMin)).toBe(true)
    expect(g.scaleMax).toBeGreaterThan(g.scaleMin)
  })

  it('never lets a floored scale put rainfall below zero', () => {
    const g = computeBand({ lower: 0, upper: 3, value: 0.4, blockValue: 1.2, width: W, floor: 0 })
    expect(g.scaleMin).toBe(0)
    expect(g.scaleMax).toBeGreaterThan(g.scaleMin)
    expect(g.valueX).toBeGreaterThanOrEqual(0)
  })

  it('clamps and flags a median that sits outside its own interval', () => {
    // Possible after block-mean reconciliation nudges the median.
    const g = computeBand({ lower: 10, upper: 20, value: 26, blockValue: 15, width: W })
    expect(g.valueClamped).toBe(true)
    expect(g.valueX).toBeLessThanOrEqual(W)
    expect(g.valueX).toBeGreaterThanOrEqual(0)
  })

  it('tolerates reversed bounds without inverting the band', () => {
    const g = computeBand({ lower: 30, upper: 10, value: 20, blockValue: 15, width: W })
    expect(g.bandWidth).toBeGreaterThan(0)
    expect(g.bandStart).toBeGreaterThanOrEqual(0)
    expect(g.bandStart + g.bandWidth).toBeLessThanOrEqual(W)
  })

  it('pads symmetrically so the band never touches the edges', () => {
    const g = computeBand({ lower: 10, upper: 20, value: 15, blockValue: 15, width: W })
    const leftGap = g.bandStart
    const rightGap = W - (g.bandStart + g.bandWidth)
    expect(leftGap).toBeGreaterThan(0)
    expect(rightGap).toBeGreaterThan(0)
    expect(Math.abs(leftGap - rightGap)).toBeLessThan(1e-6)
  })

  it('reports percentages consistent with the pixel positions', () => {
    const g = computeBand({ lower: 40, upper: 78, value: 58, blockValue: 24, width: W })
    expect(g.bandStartPct).toBeCloseTo((g.bandStart / W) * 100, 6)
    expect(g.bandWidthPct).toBeCloseTo((g.bandWidth / W) * 100, 6)
    expect(g.valuePct).toBeCloseTo((g.valueX / W) * 100, 6)
    expect(g.blockPct).toBeCloseTo((g.blockX / W) * 100, 6)
  })

  it('degrades safely on a zero width and on non-finite inputs', () => {
    const zero = computeBand({ lower: 1, upper: 2, value: 1.5, blockValue: 1.2, width: 0 })
    expect(Number.isFinite(zero.bandWidth)).toBe(true)
    expect(Number.isFinite(zero.valueX)).toBe(true)

    const nan = computeBand({
      lower: Number.NaN,
      upper: Number.NaN,
      value: Number.NaN,
      blockValue: Number.NaN,
      width: W,
    })
    expect(Number.isFinite(nan.bandStart)).toBe(true)
    expect(Number.isFinite(nan.bandWidth)).toBe(true)
    expect(nan.bandWidth).toBeGreaterThan(0)
  })

  it('scales positions linearly with the drawing width', () => {
    const a = computeBand({ lower: 40, upper: 78, value: 58, blockValue: 24, width: 200 })
    const b = computeBand({ lower: 40, upper: 78, value: 58, blockValue: 24, width: 400 })
    expect(b.valueX).toBeCloseTo(a.valueX * 2, 6)
    expect(b.bandWidth).toBeCloseTo(a.bandWidth * 2, 6)
  })
})

describe('refinementSignal', () => {
  it('is above 1 when the shift exceeds the model uncertainty', () => {
    // Moved 36 mm off the block value with a ±19 mm half-interval.
    expect(refinementSignal({ value: 60, blockValue: 24, lower: 41, upper: 79 })).toBeGreaterThan(1)
  })

  it('is below 1 when the shift is inside the noise', () => {
    expect(refinementSignal({ value: 25, blockValue: 24, lower: 5, upper: 45 })).toBeLessThan(1)
  })

  it('is zero when nothing was refined', () => {
    expect(refinementSignal({ value: 24, blockValue: 24, lower: 5, upper: 45 })).toBe(0)
  })

  it('treats a shift with no interval as an unbounded signal, not a crash', () => {
    expect(refinementSignal({ value: 30, blockValue: 24, lower: 7, upper: 7 })).toBe(Infinity)
    expect(refinementSignal({ value: 24, blockValue: 24, lower: 7, upper: 7 })).toBe(0)
  })
})

describe('rangeBasisOf', () => {
  it('defaults to all_days for older data without the field', () => {
    expect(rangeBasisOf({})).toBe('all_days')
    expect(rangeBasisOf({ range_basis: null })).toBe('all_days')
    expect(rangeBasisOf(null)).toBe('all_days')
    expect(rangeBasisOf(undefined)).toBe('all_days')
  })

  it('reads both bases', () => {
    expect(rangeBasisOf({ range_basis: 'all_days' })).toBe('all_days')
    expect(rangeBasisOf({ range_basis: 'if_rain' })).toBe('if_rain')
  })
})

describe('computeBasisBand', () => {
  it('matches computeBand exactly for all_days and shows the value dot', () => {
    const input = { lower: 40, upper: 78, value: 58, blockValue: 24, width: W }
    const g = computeBasisBand({ ...input, basis: 'all_days' })
    const { showValue, ...geometry } = g
    expect(showValue).toBe(true)
    expect(geometry).toEqual(computeBand(input))
  })

  it('draws the if-it-rains range with the block amount as a reference only', () => {
    // A light day: block amount 1.9 mm, if-it-rains range 2.5–25 mm.
    const g = computeBasisBand({
      basis: 'if_rain',
      lower: 2.5,
      upper: 25,
      value: 1.9,
      blockValue: 1.9,
      width: W,
      floor: 0,
    })
    expect(g.showValue).toBe(false)
    expect(g.valueClamped).toBe(false)
    expect(g.scaleMin).toBeGreaterThanOrEqual(0)
    expect(g.scaleMin).toBeLessThanOrEqual(1.9)
    expect(g.scaleMax).toBeGreaterThanOrEqual(25)
    // The block tick stays on the drawn scale, below the band on a light day.
    expect(g.blockX).toBeGreaterThanOrEqual(0)
    expect(g.blockX).toBeLessThan(g.bandStart)
  })

  it('leaves a model value that differs from the block off the if_rain scale', () => {
    const withFar = computeBasisBand({
      basis: 'if_rain',
      lower: 10,
      upper: 60,
      value: 400,
      blockValue: 30,
      width: W,
      floor: 0,
    })
    const withBlock = computeBasisBand({
      basis: 'if_rain',
      lower: 10,
      upper: 60,
      value: 30,
      blockValue: 30,
      width: W,
      floor: 0,
    })
    expect(withFar.scaleMax).toBe(withBlock.scaleMax)
    expect(withFar.bandStart).toBe(withBlock.bandStart)
    expect(withFar.showValue).toBe(false)
  })

  it('keeps a heavy-day block amount inside the drawing', () => {
    const g = computeBasisBand({
      basis: 'if_rain',
      lower: 18,
      upper: 140,
      value: 96,
      blockValue: 96,
      width: W,
      floor: 0,
    })
    expect(g.blockX).toBeGreaterThanOrEqual(g.bandStart)
    expect(g.blockX).toBeLessThanOrEqual(g.bandStart + g.bandWidth)
    expect(g.bandStart + g.bandWidth).toBeLessThanOrEqual(W)
  })
})

describe('rangeWording', () => {
  it('keeps the all_days wording unchanged', () => {
    const w = rangeWording('all_days', '20', '24', '°C')
    expect(w.foot).toBe('Likely 20–24')
    expect(w.key).toBe('likely range (8 days in 10)')
    expect(w.spoken).toBe('likely between 20 and 24 °C')
  })

  it('words rain as "if it rains" and never as a likely range', () => {
    const w = rangeWording('if_rain', '2.5', '25', 'mm')
    expect(w.foot).toBe('If it rains 2.5–25 mm')
    expect(w.key).toContain('if it rains')
    expect(w.spoken).toBe('If it rains, about 2.5 to 25 mm, on 8 rainy days in 10')
    for (const text of [w.foot, w.key, w.spoken]) {
      expect(text).not.toMatch(/likely range/i)
      expect(text).not.toMatch(/likely between/i)
    }
  })
})

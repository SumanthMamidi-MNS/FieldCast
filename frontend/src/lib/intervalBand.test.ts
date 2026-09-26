import { describe, expect, it } from 'vitest'
import { MIN_BAND_PX, computeBand, refinementSignal } from './intervalBand'

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

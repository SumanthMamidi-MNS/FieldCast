import { describe, expect, it } from 'vitest'
import {
  FILL_OPACITY,
  SUPPORT_LEVELS,
  confidenceStyle,
  supportFromScore,
  texturePatternName,
} from './confidenceTexture'

describe('confidence → texture mapping', () => {
  it('gives each support level its own texture', () => {
    const textures = SUPPORT_LEVELS.map((s) => confidenceStyle(s).texture)
    expect(new Set(textures).size).toBe(SUPPORT_LEVELS.length)
    expect(confidenceStyle('high').texture).toBe('none')
    expect(confidenceStyle('medium').texture).toBe('stipple-medium')
    expect(confidenceStyle('low').texture).toBe('hatch-low')
  })

  /**
   * The product requirement, as an executable assertion. If someone later
   * encodes confidence with opacity, a paler blue will read as "less rain" to a
   * non-expert and this test is the thing that stops it.
   */
  it('never encodes confidence in fill opacity', () => {
    const opacities = SUPPORT_LEVELS.map((s) => confidenceStyle(s).fillOpacity)
    expect(new Set(opacities).size).toBe(1)
    expect(opacities[0]).toBe(FILL_OPACITY)
  })

  it('carries a second, non-texture channel for low support', () => {
    const low = confidenceStyle('low')
    const high = confidenceStyle('high')
    // Dashed outline: redundant encoding, so texture is not the only cue.
    expect(low.outlineDash).not.toBeNull()
    expect(high.outlineDash).toBeNull()
    expect(low.outlineWidth).toBeGreaterThan(high.outlineWidth)
  })

  it('always supplies words alongside the visual cue', () => {
    for (const level of SUPPORT_LEVELS) {
      const style = confidenceStyle(level)
      expect(style.shortLabel.length).toBeGreaterThan(0)
      expect(style.legendExplanation.length).toBeGreaterThan(20)
    }
  })

  it('ranks worse support higher, so the list can surface risky panchayats', () => {
    expect(confidenceStyle('high').rank).toBeLessThan(confidenceStyle('medium').rank)
    expect(confidenceStyle('medium').rank).toBeLessThan(confidenceStyle('low').rank)
  })

  it('falls back to the low-support style for an unknown level', () => {
    // Simulates the backend adding a level the dashboard has not shipped yet:
    // the safe default is to under-claim confidence, never to over-claim it.
    const unknown = confidenceStyle('unknown' as never)
    expect(unknown.texture).toBe('hatch-low')
  })
})

describe('texturePatternName', () => {
  it('returns no pattern image for well-supported areas', () => {
    expect(texturePatternName('none')).toBeNull()
  })

  it('returns a stable image name for textured areas', () => {
    expect(texturePatternName('hatch-low')).toBe('confidence-hatch-low')
    expect(texturePatternName('stipple-medium')).toBe('confidence-stipple-medium')
  })
})

describe('supportFromScore', () => {
  it('bands the 0..1 score', () => {
    expect(supportFromScore(0.9)).toBe('high')
    expect(supportFromScore(0.5)).toBe('medium')
    expect(supportFromScore(0.1)).toBe('low')
  })

  it('treats a missing score as low support, not high', () => {
    expect(supportFromScore(Number.NaN)).toBe('low')
  })

  it('puts the band edges on the safe side', () => {
    expect(supportFromScore(0.66)).toBe('high')
    expect(supportFromScore(0.659)).toBe('medium')
    expect(supportFromScore(0.33)).toBe('medium')
    expect(supportFromScore(0.329)).toBe('low')
  })
})

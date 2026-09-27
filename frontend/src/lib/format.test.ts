import { describe, expect, it } from 'vitest'
import {
  deltaClass,
  displayDelta,
  fixed,
  formatArea,
  formatDelta,
  formatDistanceKm,
  formatElevation,
  formatNumber,
  formatPercent,
  formatRange,
  formatSupportScore,
  formatUnitCount,
  formatValue,
  percentOf,
} from './format'

describe('forecast variables', () => {
  it('rain and temperature to 1 decimal', () => {
    expect(formatValue(12.44, 'precip', 'mm')).toBe('12.4 mm')
    expect(formatValue(0, 'precip', 'mm')).toBe('0.0 mm')
    expect(formatValue(28.26, 'tmax', '°C')).toBe('28.3°C')
    expect(formatValue(19.95, 'tmin', '°C')).toBe('20.0°C')
  })

  it('humidity as an integer, wind to 1 decimal', () => {
    expect(formatValue(81.6, 'humidity', '%')).toBe('82%')
    expect(formatValue(14.49, 'wind', 'km/h')).toBe('14.5 km/h')
    expect(formatNumber(31.72, 'wind')).toBe('31.7')
  })

  it('falls back to the registry unit and handles missing values', () => {
    expect(formatValue(3.21, 'precip')).toBe('3.2 mm')
    expect(formatValue(Number.NaN, 'precip', 'mm')).toBe('— mm')
    expect(formatNumber(Number.POSITIVE_INFINITY, 'tmax')).toBe('—')
  })

  it('never shows negative zero', () => {
    expect(formatNumber(-0.04, 'tmax')).toBe('0.0')
    expect(formatNumber(-1.26, 'tmax')).toBe('−1.3')
  })

  it('signs deltas and flattens rounding noise', () => {
    expect(formatDelta(28.44, 27.6, 'tmax', '°C')).toBe('+0.8°C')
    expect(formatDelta(1.2, 2.46, 'precip', 'mm')).toBe('−1.3 mm')
    expect(formatDelta(22.04, 22.0, 'tmax', '°C')).toBe('±0°C')
    expect(formatDelta(82.2, 82.4, 'humidity', '%')).toBe('±0%')
    expect(formatDelta(Number.NaN, 31.7, 'wind')).toBe('—')
  })

  it('always matches the difference of the displayed numbers', () => {
    // The case the owner flagged: raw delta −1.3 used to sit beside "30" and "32".
    expect(formatValue(30.4, 'wind', 'km/h')).toBe('30.4 km/h')
    expect(formatValue(31.72, 'wind', 'km/h')).toBe('31.7 km/h')
    expect(formatDelta(30.4, 31.72, 'wind', 'km/h')).toBe('−1.3 km/h')
    // Raw delta 0.9 rounds to 0.9, but the shown values 82 and 81 differ by 1.
    expect(formatDelta(81.6, 80.7, 'humidity', '%')).toBe('+1%')
    // Raw delta 0.1 (> 0.05) would read +0.1; the shown values 20.0 and 20.0 say ±0.
    expect(formatDelta(20.04, 19.95, 'tmax', '°C')).toBe('±0°C')
    for (const [v, b, k] of [
      [12.46, 11.34, 'precip'],
      [27.25, 26.849, 'tmin'],
      [83.5, 81.49, 'humidity'],
      [18.05, 17.96, 'wind'],
    ] as const) {
      const shown = Number(formatNumber(v, k)) - Number(formatNumber(b, k))
      expect(displayDelta(v, b, k)).toBeCloseTo(shown, 9)
    }
  })

  it('colours the difference by its displayed sign', () => {
    expect(deltaClass(20.04, 19.95, 'tmax')).toBe('')
    expect(deltaClass(30.4, 31.72, 'wind')).toBe(' is-down')
    expect(deltaClass(81.6, 80.7, 'humidity')).toBe(' is-up')
  })

  it('writes ranges at the variable precision', () => {
    expect(formatRange(21.96, 25.04, 'precip', 'mm')).toBe('22.0–25.0 mm')
  })
})

describe('other quantities', () => {
  it('probability as a whole, clamped percentage', () => {
    expect(formatPercent(0.704)).toBe('70%')
    expect(formatPercent(0.995)).toBe('100%')
    expect(percentOf(1.2)).toBe(100)
    expect(percentOf(-0.1)).toBe(0)
    expect(formatPercent(Number.NaN)).toBe('—')
  })

  it('distance as whole kilometres', () => {
    expect(formatDistanceKm(12.4)).toBe('12 km')
    expect(formatDistanceKm(4.6)).toBe('5 km')
    expect(formatDistanceKm(0.2)).toBe('under 1 km')
  })

  it('area to 1 decimal', () => {
    expect(formatArea(80.477)).toBe('80.5 km²')
    expect(formatArea(3)).toBe('3.0 km²')
  })

  it('elevation as whole metres, grouped', () => {
    expect(formatElevation(612.4)).toBe('612 m')
    expect(formatElevation(1204)).toBe('1,204 m')
  })

  it('support score out of 100', () => {
    expect(formatSupportScore(0.638)).toBe('64 / 100')
    expect(formatSupportScore(1)).toBe('100 / 100')
  })

  it('fixed groups thousands and uses a true minus', () => {
    expect(fixed(-1234.5, 1)).toBe('−1,234.5')
    expect(fixed(0.1234, 3)).toBe('0.123')
  })
})

describe('formatUnitCount', () => {
  it('counts gram panchayats, singular and plural', () => {
    expect(formatUnitCount(104)).toBe('104 gram panchayats')
    expect(formatUnitCount(1)).toBe('1 gram panchayat')
    expect(formatUnitCount(257, true)).toBe('257 panchayats')
    expect(formatUnitCount(8072)).toBe('8,072 gram panchayats')
  })
})

import { describe, expect, it } from 'vitest'
import { addDays, dateKind, isIsoDate, isServableDate, stepDate, todayIso } from './dates'

const TODAY = '2026-09-26'

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2023-06-30', 1)).toBe('2023-07-01')
    expect(addDays('2023-01-01', -1)).toBe('2022-12-31')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
  })
})

describe('todayIso', () => {
  it('uses the local calendar date', () => {
    expect(todayIso(new Date(2026, 8, 26, 23, 59))).toBe('2026-09-26')
  })
})

describe('valid-date checks', () => {
  it('accepts the replay monsoons', () => {
    expect(dateKind('2022-06-01', TODAY)).toBe('replay')
    expect(dateKind('2023-07-20', TODAY)).toBe('replay')
    expect(dateKind('2023-09-30', TODAY)).toBe('replay')
  })

  it('accepts yesterday to 15 days ahead as live', () => {
    expect(dateKind('2026-09-25', TODAY)).toBe('live')
    expect(dateKind('2026-10-11', TODAY)).toBe('live')
  })

  it('rejects everything else', () => {
    expect(isServableDate('2022-05-31', TODAY)).toBe(false)
    expect(isServableDate('2023-01-15', TODAY)).toBe(false)
    expect(isServableDate('2026-09-24', TODAY)).toBe(false)
    expect(isServableDate('2026-10-12', TODAY)).toBe(false)
    expect(isServableDate('2023-02-30', TODAY)).toBe(false)
    expect(isIsoDate('2023-7-20')).toBe(false)
  })
})

describe('stepDate', () => {
  it('moves one day inside a window', () => {
    expect(stepDate('2023-07-20', 1, TODAY)).toBe('2023-07-21')
    expect(stepDate('2023-07-20', -1, TODAY)).toBe('2023-07-19')
  })

  it('jumps the gap between seasons instead of landing on a refused day', () => {
    expect(stepDate('2022-09-30', 1, TODAY)).toBe('2023-06-01')
    expect(stepDate('2023-06-01', -1, TODAY)).toBe('2022-09-30')
    expect(stepDate('2023-09-30', 1, TODAY)).toBe('2026-09-25')
  })

  it('finds the nearest window from an unavailable date', () => {
    expect(stepDate('2023-01-15', 1, TODAY)).toBe('2023-06-01')
    expect(stepDate('2023-01-15', -1, TODAY)).toBe('2022-09-30')
  })

  it('stops at the ends', () => {
    expect(stepDate('2022-06-01', -1, TODAY)).toBeNull()
    expect(stepDate('2026-10-11', 1, TODAY)).toBeNull()
    expect(stepDate('garbage', 1, TODAY)).toBeNull()
  })
})

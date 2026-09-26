import { describe, expect, it } from 'vitest'
import { isIsoDate, validateBulletin } from './bulletin'

describe('validateBulletin', () => {
  it('accepts a partial bulletin and omits blank fields', () => {
    const r = validateBulletin({ precip: '24', tmax: '29.5', tmin: '', humidity: ' ' })
    expect(r.ok).toBe(true)
    expect(r.values).toEqual({ precip: 24, tmax: 29.5 })
  })

  it('rejects non-numeric text rather than coercing it', () => {
    const r = validateBulletin({ precip: '24mm', wind: '1e3' })
    expect(r.ok).toBe(false)
    expect(r.errors.precip).toMatch(/number/)
    expect(r.errors.wind).toMatch(/number/)
    expect(r.values).toEqual({})
  })

  it('catches physically implausible values (typos)', () => {
    const r = validateBulletin({ tmax: '295', humidity: '140', precip: '-3' })
    expect(r.ok).toBe(false)
    expect(Object.keys(r.errors).sort()).toEqual(['humidity', 'precip', 'tmax'])
  })

  it('rejects a minimum temperature above the maximum', () => {
    const r = validateBulletin({ tmax: '28', tmin: '31' })
    expect(r.ok).toBe(false)
    expect(r.errors.tmin).toBeDefined()
    expect(r.values.tmin).toBeUndefined()
  })

  it('requires at least one value', () => {
    const r = validateBulletin({})
    expect(r.ok).toBe(false)
    expect(r.errors._form).toBeDefined()
  })
})

describe('isIsoDate', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isIsoDate('2023-07-20')).toBe(true)
    expect(isIsoDate('2023-02-30')).toBe(false)
    expect(isIsoDate('20-07-2023')).toBe(false)
    expect(isIsoDate('')).toBe(false)
  })
})

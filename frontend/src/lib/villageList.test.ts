import { describe, expect, it } from 'vitest'
import { normalise, searchVillages, sortVillages } from './villageList'
import { variable, village } from './testFixtures'

const rows = [
  village('1', 'Nimgaon Wagha', { precip: variable('precip', 0, 1.9) }),
  village('2', 'Rāhurī', { precip: variable('precip', 8.6, 1.9) }),
  village('3', 'Chas', { precip: variable('precip', 3.1, 1.9) }),
  village('4', 'Akolner', {}),
  village('5', 'Babhulgaon', { precip: variable('precip', 3.1, 1.9) }),
]
const names = (list: typeof rows) => list.map((r) => r.panchayat_name)

describe('searchVillages', () => {
  it('matches case- and accent-insensitively', () => {
    expect(names(searchVillages(rows, 'rahuri'))).toEqual(['Rāhurī'])
    expect(normalise('  RĀHURĪ ')).toBe('rahuri')
  })

  it('requires every word, in any order', () => {
    expect(names(searchVillages(rows, 'wagha nim'))).toEqual(['Nimgaon Wagha'])
    expect(searchVillages(rows, 'nim xyz')).toHaveLength(0)
  })

  it('returns everything for an empty query', () => {
    expect(searchVillages(rows, '   ')).toHaveLength(rows.length)
  })
})

describe('sortVillages', () => {
  it('sorts by value, highest first, ties by name, missing last', () => {
    expect(names(sortVillages(rows, 'value-desc', 'precip'))).toEqual([
      'Rāhurī',
      'Babhulgaon',
      'Chas',
      'Nimgaon Wagha',
      'Akolner',
    ])
  })

  it('keeps missing values last when sorting lowest first too', () => {
    expect(names(sortVillages(rows, 'value-asc', 'precip'))).toEqual([
      'Nimgaon Wagha',
      'Babhulgaon',
      'Chas',
      'Rāhurī',
      'Akolner',
    ])
  })

  it('sorts by name without mutating the input', () => {
    const before = names(rows)
    expect(names(sortVillages(rows, 'name', 'precip'))[0]).toBe('Akolner')
    expect(names(rows)).toEqual(before)
  })
})

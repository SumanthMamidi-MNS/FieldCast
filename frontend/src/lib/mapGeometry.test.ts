import { describe, expect, it } from 'vitest'
import type { PanchayatGeometry } from '../types/api'
import {
  FIT_PADDING_MAX,
  FIT_PADDING_MIN,
  boundsOf,
  fitPadding,
  labelImageId,
  labelSortKey,
} from './mapGeometry'

function poly(id: string, coordinates: number[][][]): PanchayatGeometry {
  return {
    panchayat_id: id,
    panchayat_name: id,
    unit_type: 'village_cluster',
    block_id: 'b',
    geometry: { type: 'Polygon', coordinates },
    centroid_lat: 0,
    centroid_lon: 0,
    elevation_m: 0,
  } as PanchayatGeometry
}

describe('boundsOf', () => {
  it('returns null for no geometry', () => {
    expect(boundsOf([])).toBeNull()
  })

  it('spans every panchayat, not just the first', () => {
    const a = poly('a', [
      [
        [74.6, 19.0],
        [74.7, 19.0],
        [74.7, 19.1],
        [74.6, 19.0],
      ],
    ])
    const b = poly('b', [
      [
        [74.9, 18.8],
        [74.95, 18.8],
        [74.95, 19.3],
        [74.9, 18.8],
      ],
    ])
    expect(boundsOf([a, b])).toEqual([
      [74.6, 18.8],
      [74.95, 19.3],
    ])
  })

  it('walks MultiPolygon parts', () => {
    const m = {
      ...poly('m', []),
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [1, 1],
              [2, 2],
            ],
          ],
          [
            [
              [-3, 5],
              [0, 0],
            ],
          ],
        ],
      },
    } as PanchayatGeometry
    expect(boundsOf([m])).toEqual([
      [-3, 0],
      [2, 5],
    ])
  })

  it('ignores non-finite vertices', () => {
    const a = poly('a', [
      [
        [1, 1],
        [Number.NaN, 50],
        [2, 2],
      ],
    ])
    expect(boundsOf([a])).toEqual([
      [1, 1],
      [2, 2],
    ])
  })
})

describe('fitPadding', () => {
  it('stays within the 24–40 px band', () => {
    expect(fitPadding(375, 320)).toBe(FIT_PADDING_MIN)
    expect(fitPadding(1600, 1000)).toBe(FIT_PADDING_MAX)
    const mid = fitPadding(750, 500)
    expect(mid).toBeGreaterThanOrEqual(FIT_PADDING_MIN)
    expect(mid).toBeLessThanOrEqual(FIT_PADDING_MAX)
  })

  it('is safe on a zero-size container', () => {
    expect(fitPadding(0, 0)).toBe(FIT_PADDING_MIN)
    expect(fitPadding(Number.NaN, 400)).toBe(FIT_PADDING_MIN)
  })
})

describe('labelSortKey', () => {
  it('places larger panchayats first', () => {
    expect(labelSortKey(80)).toBeLessThan(labelSortKey(20))
  })
  it('handles missing area', () => {
    expect(labelSortKey(Number.NaN)).toBe(0)
  })
})

describe('labelImageId', () => {
  it('is stable and distinguishes kinds and text', () => {
    expect(labelImageId('value', '28.0°C')).toBe(labelImageId('value', '28.0°C'))
    expect(labelImageId('value', '28.0°C')).not.toBe(labelImageId('focus', '28.0°C'))
    expect(labelImageId('focus', 'A', 'B C')).not.toBe(labelImageId('focus', 'A B', 'C'))
  })
})

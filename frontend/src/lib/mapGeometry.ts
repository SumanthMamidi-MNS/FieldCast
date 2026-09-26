/**
 * Pure helpers for framing the block on the map and for naming label images.
 *
 * Kept free of MapLibre and the DOM so the parts that decide *what the officer
 * sees first* — the camera fit and which label wins a collision — are testable.
 */

import type { PanchayatGeometry } from '../types/api'

/** [[west, south], [east, north]] in lon/lat. */
export type Bounds = [[number, number], [number, number]]

/** Bounding box of every vertex of every panchayat outline; `null` if empty. */
export function boundsOf(geometry: PanchayatGeometry[]): Bounds | null {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  for (const g of geometry) {
    const rings =
      g.geometry.type === 'Polygon' ? g.geometry.coordinates : g.geometry.coordinates.flat()
    for (const ring of rings) {
      for (const pt of ring) {
        const lon = pt[0]
        const lat = pt[1]
        if (lon === undefined || lat === undefined) continue
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
        if (lon < west) west = lon
        if (lon > east) east = lon
        if (lat < south) south = lat
        if (lat > north) north = lat
      }
    }
  }

  if (!Number.isFinite(west) || !Number.isFinite(south)) return null
  return [
    [west, south],
    [east, north],
  ]
}

export const FIT_PADDING_MIN = 24
export const FIT_PADDING_MAX = 40

/**
 * Padding around the block when fitting the camera: tight on a phone so the
 * block still fills the screen, a little more breathing room on a desktop.
 */
export function fitPadding(width: number, height: number): number {
  const short = Math.min(width, height)
  if (!Number.isFinite(short) || short <= 0) return FIT_PADDING_MIN
  const p = Math.round(short * 0.06)
  return Math.max(FIT_PADDING_MIN, Math.min(FIT_PADDING_MAX, p))
}

/**
 * Collision priority for value labels (MapLibre `symbol-sort-key`: lower is
 * placed first). Larger panchayats win, because they have room for the label
 * and a label hanging over a small neighbour reads as that neighbour's value.
 */
export function labelSortKey(areaKm2: number): number {
  return Number.isFinite(areaKm2) && areaKm2 > 0 ? -areaKm2 : 0
}

/** Stable MapLibre image id for a rendered label. */
export function labelImageId(kind: 'value' | 'focus', ...parts: string[]): string {
  return `label:${kind}:${parts.join('␟')}`
}

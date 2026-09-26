/**
 * Synthetic panchayat outlines for the mock API.
 *
 * The real system uses datameet village polygons (architecture.md §2). Those are
 * a backend concern and are not vendored here. What this module produces is a
 * *topologically correct* stand-in: a lattice of cells whose shared edges are
 * genuinely shared (same jittered vertices from both sides), so the map has no
 * slivers or overlaps and the choropleth reads exactly as it will with real
 * geometry.
 *
 * It is deterministic: same block id, same shapes every reload. A map that
 * reshuffles itself between refreshes is not a map you can point at in a room.
 */

import type { GeoJsonPolygon } from '../types/api'

/** Small deterministic string hash → 32-bit int. */
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Deterministic pseudo-random in [-1, 1] from an arbitrary key. */
function jitter(key: string): number {
  const h = hashString(key)
  return (h % 20000) / 10000 - 1
}

export interface LatticeOptions {
  seed: string
  cols: number
  rows: number
  /** [west, south, east, north] */
  bbox: [number, number, number, number]
  /** Vertex wobble as a fraction of a cell. 0 = perfect rectangles. */
  wobble?: number
}

interface Pt {
  lon: number
  lat: number
}

/**
 * Build `cols * rows` polygons that tile the bbox with irregular shared edges.
 * Returned in row-major order, top row first (north-west cell is index 0).
 */
export function buildLattice(opts: LatticeOptions): GeoJsonPolygon[] {
  const { seed, cols, rows, bbox } = opts
  const wobble = opts.wobble ?? 0.22
  const [west, south, east, north] = bbox
  const dx = (east - west) / cols
  const dy = (north - south) / rows

  // Corner vertices, jittered once each so neighbours agree on them.
  const corner = (i: number, j: number): Pt => {
    const interiorX = i > 0 && i < cols
    const interiorY = j > 0 && j < rows
    return {
      lon: west + i * dx + (interiorX ? jitter(`${seed}:cx:${i}:${j}`) * dx * wobble : 0),
      lat: south + j * dy + (interiorY ? jitter(`${seed}:cy:${i}:${j}`) * dy * wobble : 0),
    }
  }

  /**
   * Interior points along the edge between two corners, pushed perpendicular by
   * a per-edge jitter. Keyed on the edge, not the cell, so both neighbours get
   * the identical curve.
   */
  const edgePoints = (a: Pt, b: Pt, key: string, onBoundary: boolean): Pt[] => {
    const out: Pt[] = []
    const nx = -(b.lat - a.lat)
    const ny = b.lon - a.lon
    for (const t of [0.33, 0.66]) {
      const base = { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t }
      if (onBoundary) {
        out.push(base)
        continue
      }
      const amp = jitter(`${key}:${t}`) * wobble * 0.55
      out.push({ lon: base.lon + nx * amp, lat: base.lat + ny * amp })
    }
    return out
  }

  const horizontalEdge = (i: number, j: number): Pt[] => {
    // Edge from corner(i,j) to corner(i+1,j), left to right.
    const a = corner(i, j)
    const b = corner(i + 1, j)
    return edgePoints(a, b, `${seed}:h:${i}:${j}`, j === 0 || j === rows)
  }

  const verticalEdge = (i: number, j: number): Pt[] => {
    // Edge from corner(i,j) to corner(i,j+1), bottom to top.
    const a = corner(i, j)
    const b = corner(i, j + 1)
    return edgePoints(a, b, `${seed}:v:${i}:${j}`, i === 0 || i === cols)
  }

  const polygons: GeoJsonPolygon[] = []

  // Row-major from the north so index 0 is the north-west cell.
  for (let r = 0; r < rows; r++) {
    const j = rows - 1 - r
    for (let i = 0; i < cols; i++) {
      const bl = corner(i, j)
      const br = corner(i + 1, j)
      const tr = corner(i + 1, j + 1)
      const tl = corner(i, j + 1)

      const bottom = horizontalEdge(i, j)
      const right = verticalEdge(i + 1, j)
      const top = horizontalEdge(i, j + 1)
      const left = verticalEdge(i, j)

      const ring: Pt[] = [
        bl,
        ...bottom,
        br,
        ...right,
        tr,
        ...[...top].reverse(),
        tl,
        ...[...left].reverse(),
        bl,
      ]

      polygons.push({
        type: 'Polygon',
        coordinates: [ring.map((p) => [round6(p.lon), round6(p.lat)])],
      })
    }
  }

  return polygons
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

/** Area-weighted centroid of a simple polygon ring, in degrees. */
export function polygonCentroid(poly: GeoJsonPolygon): { lon: number; lat: number } {
  const ring = poly.coordinates[0] ?? []
  let twiceArea = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const p = ring[i] as number[]
    const q = ring[i + 1] as number[]
    const x0 = p[0] as number
    const y0 = p[1] as number
    const x1 = q[0] as number
    const y1 = q[1] as number
    const cross = x0 * y1 - x1 * y0
    twiceArea += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  if (Math.abs(twiceArea) < 1e-12) {
    const first = ring[0] as number[] | undefined
    return { lon: (first?.[0] as number) ?? 0, lat: (first?.[1] as number) ?? 0 }
  }
  return { lon: round6(cx / (3 * twiceArea)), lat: round6(cy / (3 * twiceArea)) }
}

/** Rough planar area in km², good enough for a display figure at this latitude. */
export function polygonAreaKm2(poly: GeoJsonPolygon): number {
  const ring = poly.coordinates[0] ?? []
  let twiceArea = 0
  let latSum = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const p = ring[i] as number[]
    const q = ring[i + 1] as number[]
    twiceArea += (p[0] as number) * (q[1] as number) - (q[0] as number) * (p[1] as number)
    latSum += p[1] as number
  }
  const meanLat = ring.length > 1 ? latSum / (ring.length - 1) : 0
  const degArea = Math.abs(twiceArea / 2)
  const kmPerDegLat = 110.574
  const kmPerDegLon = 111.32 * Math.cos((meanLat * Math.PI) / 180)
  return Math.round(degArea * kmPerDegLat * kmPerDegLon * 10) / 10
}

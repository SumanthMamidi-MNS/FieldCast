/**
 * Geometry for the uncertainty band.
 *
 * The detail panel draws, on one shared horizontal scale:
 *
 *   |-------[========#========]------------|
 *           lower   value   upper        (band)
 *                      ^ block value       (tick)
 *
 * Pure arithmetic, no DOM, so it can be tested properly. The rules it has to
 * hold to:
 *
 * - The band must always have a visible width, even when lower == upper
 *   (a genuinely certain forecast must not render as an invisible sliver).
 * - The block-value tick must always land inside the drawn area, because the
 *   whole point of the chart is to compare against it.
 * - Everything is clamped: a value outside its own interval (possible after
 *   block-mean reconciliation) must not draw outside the box.
 */

import type { RangeBasis } from '../types/api'

export interface BandInput {
  /** 10th percentile. */
  lower: number
  /** 90th percentile. */
  upper: number
  /** Downscaled median. */
  value: number
  /** The official block value, drawn as a reference tick. */
  blockValue: number
  /** Drawing width in px. */
  width: number
  /** Fraction of the span left as breathing room on each side. Default 0.08. */
  padding?: number
  /** Optional hard floor for the scale, e.g. 0 for rainfall. */
  floor?: number
}

export interface BandGeometry {
  /** Data value at x = 0. */
  scaleMin: number
  /** Data value at x = width. */
  scaleMax: number
  /** Left edge of the interval band, px. */
  bandStart: number
  /** Width of the interval band, px. Always >= MIN_BAND_PX. */
  bandWidth: number
  /** Centre of the median marker, px. */
  valueX: number
  /** Centre of the block-value tick, px. */
  blockX: number
  /** Same positions as 0..100 percentages, for CSS-positioned markers. */
  bandStartPct: number
  bandWidthPct: number
  valuePct: number
  blockPct: number
  /** True when the median sits outside [lower, upper] and had to be clamped. */
  valueClamped: boolean
}

/** A zero-width band would be invisible; give it at least this many px. */
export const MIN_BAND_PX = 4

function clampTo(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo
  return value < lo ? lo : value > hi ? hi : value
}

export function computeBand(input: BandInput): BandGeometry {
  const width = Number.isFinite(input.width) && input.width > 0 ? input.width : 1
  const padding = input.padding ?? 0.08

  const lower = Number.isFinite(input.lower) ? input.lower : 0
  const upper = Number.isFinite(input.upper) ? input.upper : lower
  const value = Number.isFinite(input.value) ? input.value : lower
  const blockValue = Number.isFinite(input.blockValue) ? input.blockValue : lower

  const lo = Math.min(lower, upper)
  const hi = Math.max(lower, upper)

  let rawMin = Math.min(lo, value, blockValue)
  let rawMax = Math.max(hi, value, blockValue)

  if (rawMax - rawMin < 1e-9) {
    // Everything identical: invent a small symmetric window so the drawing has
    // a scale at all. Magnitude-relative so it works for 0.2 mm and for 38 °C.
    const pad = Math.max(Math.abs(rawMax) * 0.05, 0.5)
    rawMin -= pad
    rawMax += pad
  }

  const span = rawMax - rawMin
  let scaleMin = rawMin - span * padding
  const scaleMax = rawMax + span * padding

  if (input.floor !== undefined && Number.isFinite(input.floor)) {
    scaleMin = Math.max(scaleMin, input.floor)
    // Guard against floor collapsing the scale.
    if (scaleMax - scaleMin < 1e-9) scaleMin = scaleMax - Math.max(Math.abs(scaleMax) * 0.05, 0.5)
  }

  const scaleSpan = scaleMax - scaleMin
  const toPx = (v: number) => clampTo(((v - scaleMin) / scaleSpan) * width, 0, width)

  const startPx = toPx(lo)
  const endPx = toPx(hi)
  let bandStart = Math.min(startPx, endPx)
  let bandWidth = Math.abs(endPx - startPx)

  if (bandWidth < MIN_BAND_PX) {
    const centre = bandStart + bandWidth / 2
    bandWidth = Math.min(MIN_BAND_PX, width)
    bandStart = clampTo(centre - bandWidth / 2, 0, Math.max(0, width - bandWidth))
  }

  const valueX = toPx(value)
  const blockX = toPx(blockValue)
  const pct = (px: number) => (width === 0 ? 0 : (px / width) * 100)

  return {
    scaleMin,
    scaleMax,
    bandStart,
    bandWidth,
    valueX,
    blockX,
    bandStartPct: pct(bandStart),
    bandWidthPct: pct(bandWidth),
    valuePct: pct(valueX),
    blockPct: pct(blockX),
    valueClamped: value < lo || value > hi,
  }
}

/**
 * How much the downscaled value moved away from the block value, as a share of
 * the interval half-width. > 1 means the refinement is larger than the model's
 * own uncertainty — i.e. a claim worth acting on rather than noise.
 */
export function refinementSignal(input: {
  value: number
  blockValue: number
  lower: number
  upper: number
}): number {
  const half = Math.abs(input.upper - input.lower) / 2
  const shift = Math.abs(input.value - input.blockValue)
  if (!Number.isFinite(half) || half < 1e-9) return shift > 1e-9 ? Infinity : 0
  return shift / half
}

// ---------------------------------------------------------------------------
// Range basis: what the band means
// ---------------------------------------------------------------------------

/**
 * What a variable's `confidence.lower/upper` describe.
 *
 * - `all_days`: the likely range of the served value (every variable but rain).
 * - `if_rain`: rain only. The likely amount on a day it rains (2.5 mm or more).
 *   It is not a range for the served value, which is the block amount and can
 *   sit below it on a low-chance day. So the band then carries no value dot,
 *   and nothing may say the block amount is inside or outside a "likely range".
 */
export type { RangeBasis }

/** The basis of a forecast's range; absent (older data) means `all_days`. */
export function rangeBasisOf(v: { range_basis?: RangeBasis | null } | null | undefined): RangeBasis {
  return v?.range_basis === 'if_rain' ? 'if_rain' : 'all_days'
}

export interface BasisBand extends BandGeometry {
  /**
   * Whether to draw the value dot. False for `if_rain`: the served amount is
   * not a draw from the if-it-rains range, so placing it on the band would
   * read as "inside" or "outside" a range it was never part of.
   */
  showValue: boolean
}

/**
 * Band geometry for either basis. For `if_rain` the scale spans only the
 * if-it-rains range and the block amount (the reference tick); the served
 * value is left off the axis.
 */
export function computeBasisBand(input: BandInput & { basis: RangeBasis }): BasisBand {
  const { basis, ...band } = input
  if (basis === 'if_rain') {
    const g = computeBand({ ...band, value: band.blockValue })
    return { ...g, valueX: g.blockX, valuePct: g.blockPct, valueClamped: false, showValue: false }
  }
  return { ...computeBand(band), showValue: true }
}

export interface RangeWording {
  /** Short range line under the band, e.g. "Likely 20–24" or "If it rains 2.5–25 mm". */
  foot: string
  /** Legend text for the shaded band. */
  key: string
  /** Screen-reader clause describing the range (no trailing full stop). */
  spoken: string
}

/**
 * How the range is worded. Rain's `if_rain` range is never called a "likely
 * range": it is the amount on a day it rains.
 */
export function rangeWording(
  basis: RangeBasis,
  lowerText: string,
  upperText: string,
  unit: string,
): RangeWording {
  if (basis === 'if_rain') {
    return {
      foot: `If it rains ${lowerText}–${upperText} ${unit}`,
      key: 'amount if it rains (8 days in 10)',
      spoken: `If it rains, about ${lowerText} to ${upperText} ${unit}, on 8 rainy days in 10`,
    }
  }
  return {
    foot: `Likely ${lowerText}–${upperText}`,
    key: 'likely range (8 days in 10)',
    spoken: `likely between ${lowerText} and ${upperText} ${unit}`,
  }
}

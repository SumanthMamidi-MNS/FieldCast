/**
 * Value → colour.
 *
 * Constraints this module exists to enforce:
 *
 * - **No rainbow scales.** Rainbow ramps invent boundaries that are not in the
 *   data and are unreadable to most colour-blind viewers.
 * - **Rainfall is sequential blue**, temperature is **diverging**, centred on
 *   the official block value so "warmer than the block forecast" is the thing
 *   you see first. That is the product's whole claim, made visual.
 * - **Colour never carries meaning alone.** Every scale here is paired at render
 *   time with a numeric label, and confidence is carried by texture (see
 *   `confidenceTexture.ts`), never by hue or opacity.
 *
 * Ramps are ColorBrewer-derived (Blues, RdBu, BuGn, BuPu) — all of which hold up
 * under deuteranopia/protanopia, and all of which are monotonic in lightness so
 * they survive a washed-out projector in a bright room.
 */

export type ScaleKind =
  | 'sequential-blue'
  | 'sequential-teal'
  | 'sequential-purple'
  | 'diverging-temp'
  | 'diverging-humidity'
  | 'diverging-wind'

export interface Rgb {
  r: number
  g: number
  b: number
}

/** Shown when a value is missing or non-finite. Deliberately not on any ramp. */
export const NO_DATA_COLOR = '#c9ccd1'

const RAMPS: Record<ScaleKind, string[]> = {
  // ColorBrewer Blues (light → dark). Light end still darker than the basemap.
  'sequential-blue': ['#eff6fb', '#c9e0f2', '#96c6e0', '#5ea5cd', '#2f7fb8', '#12549b', '#083070'],
  // ColorBrewer BuGn.
  'sequential-teal': ['#f1f9f4', '#cdebdc', '#9ed8bf', '#66c2a4', '#35a07a', '#137a55', '#004f36'],
  // ColorBrewer BuPu.
  'sequential-purple': ['#f5f2f8', '#dcd9ec', '#bfb3d9', '#a184c0', '#8a55a6', '#6f2a86', '#4a1259'],
  // ColorBrewer RdBu, reversed: cool blue → neutral → warm red. Colour-blind safe.
  'diverging-temp': ['#2166ac', '#67a9cf', '#d1e5f0', '#f4f2ee', '#fddbc7', '#ef8a62', '#b2182b'],
  // ColorBrewer BrBG: drier than the block (brown) -> neutral -> more humid (teal).
  'diverging-humidity': ['#8c510a', '#d8b365', '#f6e8c3', '#f4f2ee', '#c7eae5', '#5ab4ac', '#01665e'],
  // ColorBrewer PuOr: calmer than the block (orange) -> neutral -> windier (purple).
  'diverging-wind': ['#b35806', '#f1a340', '#fee0b6', '#f4f2ee', '#d8daeb', '#998ec3', '#542788'],
}

export function isDiverging(kind: ScaleKind): boolean {
  return kind.startsWith('diverging')
}

export interface ScaleDomain {
  min: number
  max: number
  /**
   * Diverging scales only: the value that maps to the neutral middle of the
   * ramp. For temperature this is the official block forecast.
   */
  mid?: number
}

export interface ColorScale {
  kind: ScaleKind
  domain: ScaleDomain
  /** 0..1 position of a value along the ramp, clamped. NaN-safe (returns 0.5). */
  normalize(value: number): number
  /** Hex colour for a value. Non-finite input returns NO_DATA_COLOR. */
  color(value: number): string
  /** Evenly spaced sample colours, for drawing the legend gradient. */
  samples(count: number): { t: number; value: number; color: string }[]
}

export function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0
  return t < 0 ? 0 : t > 1 ? 1 : t
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function toHex(n: number): string {
  const v = Math.max(0, Math.min(255, Math.round(n)))
  return v.toString(16).padStart(2, '0')
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/** Piecewise-linear interpolation across a ramp. `t` is clamped to [0, 1]. */
export function sampleRamp(ramp: string[], t: number): string {
  if (ramp.length === 0) return NO_DATA_COLOR
  const first = ramp[0] as string
  if (ramp.length === 1) return first
  const tc = clamp01(t)
  const scaled = tc * (ramp.length - 1)
  const i = Math.min(Math.floor(scaled), ramp.length - 2)
  const frac = scaled - i
  const a = hexToRgb(ramp[i] as string)
  const b = hexToRgb(ramp[i + 1] as string)
  return rgbToHex({
    r: a.r + (b.r - a.r) * frac,
    g: a.g + (b.g - a.g) * frac,
    b: a.b + (b.b - a.b) * frac,
  })
}

/**
 * Relative luminance (WCAG). Used by tests to assert that sequential ramps get
 * genuinely darker as values rise, and by the UI to pick readable label ink.
 */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Black or white ink, whichever is readable on the given fill. */
export function readableInk(hex: string): string {
  return luminance(hex) > 0.42 ? '#121417' : '#ffffff'
}

export function buildScale(kind: ScaleKind, domain: ScaleDomain): ColorScale {
  const ramp = RAMPS[kind]
  const { min, max } = domain
  const diverging = isDiverging(kind)
  const mid = diverging ? (domain.mid ?? (min + max) / 2) : undefined

  const normalize = (value: number): number => {
    if (!Number.isFinite(value)) return 0.5
    if (diverging && mid !== undefined) {
      // Half-range on each side of the midpoint, so the neutral colour lands
      // exactly on the block value even when the data is lopsided.
      const reach = Math.max(Math.abs(max - mid), Math.abs(mid - min))
      if (reach <= 0) return 0.5
      return clamp01(0.5 + (value - mid) / (2 * reach))
    }
    const span = max - min
    if (span <= 0) return 0.5
    return clamp01((value - min) / span)
  }

  return {
    kind,
    domain,
    normalize,
    color(value: number): string {
      if (!Number.isFinite(value)) return NO_DATA_COLOR
      return sampleRamp(ramp, normalize(value))
    },
    samples(count: number) {
      const n = Math.max(2, Math.floor(count))
      const out: { t: number; value: number; color: string }[] = []
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1)
        let value: number
        if (diverging && mid !== undefined) {
          const reach = Math.max(Math.abs(max - mid), Math.abs(mid - min))
          value = mid + (t - 0.5) * 2 * reach
        } else {
          value = min + t * (max - min)
        }
        out.push({ t, value, color: sampleRamp(ramp, t) })
      }
      return out
    },
  }
}

/**
 * Pick a readable domain from the actual panchayat values.
 *
 * `blockValue` becomes the diverging midpoint, and is always kept inside the
 * domain for sequential scales so the legend can mark it.
 */
export function niceDomain(
  values: number[],
  opts: { zeroAnchored: boolean; diverging: boolean; blockValue?: number },
): ScaleDomain {
  const finite = values.filter((v) => Number.isFinite(v))
  const block = Number.isFinite(opts.blockValue) ? (opts.blockValue as number) : undefined
  const pool = block === undefined ? finite : [...finite, block]

  if (pool.length === 0) {
    return { min: 0, max: 1, ...(opts.diverging ? { mid: 0.5 } : {}) }
  }

  let min = Math.min(...pool)
  let max = Math.max(...pool)

  if (max - min < 1e-9) {
    // Degenerate: every panchayat identical. Still give the scale a real span so
    // nothing divides by zero, and let the UI say "no differentiation" in words.
    const pad = Math.max(Math.abs(max) * 0.05, 0.5)
    min -= pad
    max += pad
  } else {
    const pad = (max - min) * 0.06
    min -= pad
    max += pad
  }

  if (opts.zeroAnchored) min = Math.min(0, min)

  return opts.diverging && block !== undefined ? { min, max, mid: block } : { min, max }
}

/**
 * A domain fitted to one block, relative to its official value.
 *
 * The product exists to show differences *inside* a block, so a fixed or
 * zero-anchored range is wrong: wind of 30.8-32.8 km/h on a 0-35 scale is one
 * flat colour. Instead:
 *
 * - **sequential** (rain): 0 -> the block's own maximum (village or block value)
 *   while any village is dry (below `dryBelow`), because "dry here, wet there"
 *   is the story. When every village is wet, a 0-based scale paints 22-25 mm
 *   as one dark blue, so the scale is fitted to the villages' own range
 *   (with the block value kept inside) instead. `fit` records which applied,
 *   so the legend can say so.
 * - **diverging** (everything else): centred on the block value, reaching as
 *   far as the furthest village on either side, so the neutral colour *is* the
 *   official forecast and both sides share one unit-per-colour step.
 *
 * `minReach` is the variable's meaningful resolution. Without it a block whose
 * villages differ by 0.02 degC would be painted in full red and blue, turning
 * rounding noise into an apparent finding. With it, sub-resolution differences
 * stay close to neutral, which is the honest picture.
 */
export interface RelativeDomain extends ScaleDomain {
  /** Real lowest and highest village values (NaN when there are none). */
  dataMin: number
  dataMax: number
  /** The official block value. */
  block: number
  /**
   * How the range was chosen: `zero` = sequential from 0, `range` = sequential
   * fitted to the villages' own values, `block` = diverging around the block.
   */
  fit: 'zero' | 'range' | 'block'
}

export function relativeDomain(
  values: number[],
  blockValue: number,
  opts: {
    diverging: boolean
    minReach: number
    /**
     * Sequential only: a village below this counts as dry. When none is, the
     * scale fits the villages' range instead of starting at 0. Omit to always
     * start at 0.
     */
    dryBelow?: number
  },
): RelativeDomain {
  const finite = values.filter((v) => Number.isFinite(v))
  const has = finite.length > 0
  const block = Number.isFinite(blockValue) ? blockValue : has ? mean(finite) : 0
  const dataMin = has ? Math.min(...finite) : Number.NaN
  const dataMax = has ? Math.max(...finite) : Number.NaN
  const minReach = Number.isFinite(opts.minReach) && opts.minReach > 0 ? opts.minReach : 1e-6

  if (!opts.diverging) {
    const dryBelow = opts.dryBelow
    const allWet = has && dryBelow !== undefined && Number.isFinite(dryBelow) && dataMin >= dryBelow
    if (allWet) {
      let lo = Math.min(dataMin, block)
      let hi = Math.max(dataMax, block)
      if (hi - lo < minReach) {
        // Same guard as the diverging case: a sub-resolution spread stays pale
        // rather than being stretched across the whole ramp.
        const centre = (lo + hi) / 2
        lo = Math.max(0, centre - minReach / 2)
        hi = lo + minReach
      }
      return { min: lo, max: hi, dataMin, dataMax, block, fit: 'range' }
    }
    const top = Math.max(has ? dataMax : 0, block, minReach)
    return { min: 0, max: top, dataMin, dataMax, block, fit: 'zero' }
  }

  const reach = Math.max(
    has ? Math.abs(dataMax - block) : 0,
    has ? Math.abs(block - dataMin) : 0,
    minReach,
  )
  return { min: block - reach, max: block + reach, mid: block, dataMin, dataMax, block, fit: 'block' }
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

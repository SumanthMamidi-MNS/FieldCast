/**
 * Canvas-generated fill patterns for the confidence overlay.
 *
 * Each tile is drawn as a **two-tone** stroke: a dark line immediately beside a
 * light one. That is what makes the texture survive being laid over a whole
 * sequential ramp — a purely dark hatch disappears on dark blue, a purely white
 * hatch disappears on pale blue. Two-tone reads on both, and on a projector.
 *
 * Tiles are generated at 2x and registered with `pixelRatio: 2` so they stay
 * crisp on a phone and on a retina laptop.
 */

export interface PatternImage {
  width: number
  height: number
  data: Uint8Array
  pixelRatio: number
}

const TILE = 16 // device pixels; 8 CSS px at pixelRatio 2
const PIXEL_RATIO = 2

const DARK = 'rgba(14, 19, 25, 0.92)'
const LIGHT = 'rgba(255, 255, 255, 0.95)'

function createContext(size: number): CanvasRenderingContext2D | null {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  return canvas.getContext('2d', { willReadFrequently: true })
}

function toImage(ctx: CanvasRenderingContext2D, size: number): PatternImage {
  const { data } = ctx.getImageData(0, 0, size, size)
  return {
    width: size,
    height: size,
    data: new Uint8Array(data.buffer.slice(0)),
    pixelRatio: PIXEL_RATIO,
  }
}

/**
 * Low support: 45° two-tone hatch.
 * Stripes read as "provisional" and cannot be mistaken for more or less of a
 * measured quantity, which is precisely why opacity was rejected.
 */
export function buildHatchPattern(): PatternImage | null {
  const ctx = createContext(TILE)
  if (!ctx) return null
  ctx.clearRect(0, 0, TILE, TILE)
  ctx.lineCap = 'butt'
  ctx.lineWidth = 2.4

  // Spacing divides the tile exactly, so adjacent tiles line up seamlessly.
  const spacing = TILE / 2
  for (let i = -TILE; i <= TILE * 2; i += spacing) {
    const dark = (Math.round(i / spacing) & 1) === 0
    ctx.strokeStyle = dark ? DARK : LIGHT
    ctx.beginPath()
    ctx.moveTo(i, -1)
    ctx.lineTo(i - TILE - 2, TILE + 1)
    ctx.stroke()
  }
  return toImage(ctx, TILE)
}

/**
 * Medium support: sparse stipple. Visibly "in between" clean and striped, and
 * it stays legible when the map is zoomed out to the whole block.
 */
export function buildStipplePattern(): PatternImage | null {
  const ctx = createContext(TILE)
  if (!ctx) return null
  ctx.clearRect(0, 0, TILE, TILE)

  const dots: [number, number][] = [
    [4, 4],
    [12, 12],
  ]
  for (const [x, y] of dots) {
    ctx.beginPath()
    ctx.arc(x, y, 2.9, 0, Math.PI * 2)
    ctx.fillStyle = LIGHT
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y, 1.7, 0, Math.PI * 2)
    ctx.fillStyle = DARK
    ctx.fill()
  }
  return toImage(ctx, TILE)
}

/**
 * The same textures as inline SVG, for legend swatches and list chips — so the
 * legend is demonstrably the same mark the map draws, not an approximation.
 */
export function textureSvgDefs(): string {
  return `
    <pattern id="tex-hatch-low" width="8" height="8" patternUnits="userSpaceOnUse">
      <line x1="0" y1="-1" x2="-9" y2="8" stroke="${DARK}" stroke-width="1.6" />
      <line x1="4" y1="-1" x2="-5" y2="8" stroke="${LIGHT}" stroke-width="1.6" />
      <line x1="8" y1="-1" x2="-1" y2="8" stroke="${DARK}" stroke-width="1.6" />
      <line x1="12" y1="-1" x2="3" y2="8" stroke="${LIGHT}" stroke-width="1.6" />
    </pattern>
    <pattern id="tex-stipple-medium" width="8" height="8" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.5" fill="${LIGHT}" />
      <circle cx="2" cy="2" r="0.9" fill="${DARK}" />
      <circle cx="6" cy="6" r="1.5" fill="${LIGHT}" />
      <circle cx="6" cy="6" r="0.9" fill="${DARK}" />
    </pattern>
  `
}

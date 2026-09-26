/**
 * Map labels, rasterised to images for a MapLibre symbol layer.
 *
 * Why images and not `text-field`: a text symbol needs a hosted glyph (PBF)
 * endpoint, which would reintroduce the keyed / third-party dependency the
 * keyless basemap exists to avoid. An `icon-image` symbol needs no glyphs, and
 * still gets MapLibre's collision engine — so colliding labels are *dropped*,
 * never stacked, and it uses the page's own system font.
 *
 * Values are small, light pills that stay out of the colour's way; the
 * hovered or selected village gets a dark name pill above its value.
 */

import type { PatternImage } from './mapPatterns'

const INK = '#131a17'
const PAPER = '#ffffff'

function pixelRatio(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  return Math.min(3, Math.max(2, Math.ceil(dpr)))
}

function fontStack(): string {
  if (typeof document === 'undefined') return 'system-ui, sans-serif'
  const v = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim()
  return v || 'system-ui, sans-serif'
}

interface Pill {
  text: string
  size: number
  weight: number
  bg: string
  fg: string
  ring: string
}

const PAD_X = 5
const RING = 1

function measure(ctx: CanvasRenderingContext2D, p: Pill, font: string) {
  ctx.font = `${p.weight} ${p.size}px ${font}`
  const w = Math.ceil(ctx.measureText(p.text).width) + PAD_X * 2
  const h = Math.round(p.size * 1.6)
  return { w, h }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawPills(pills: Pill[], gap: number): PatternImage | null {
  if (typeof document === 'undefined') return null
  const font = fontStack()
  const ratio = pixelRatio()
  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) return null

  const sizes = pills.map((p) => measure(probe, p, font))
  const inset = Math.ceil(RING)
  const cssW = Math.max(...sizes.map((s) => s.w)) + inset * 2
  const cssH = sizes.reduce((acc, s) => acc + s.h, 0) + gap * (pills.length - 1) + inset * 2

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(cssW * ratio)
  canvas.height = Math.ceil(cssH * ratio)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.scale(ratio, ratio)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  let y = inset
  pills.forEach((p, i) => {
    const s = sizes[i] as { w: number; h: number }
    const x = (cssW - s.w) / 2
    roundRect(ctx, x, y, s.w, s.h, s.h / 2)
    ctx.fillStyle = p.bg
    ctx.fill()
    ctx.lineWidth = RING
    ctx.strokeStyle = p.ring
    ctx.stroke()
    ctx.font = `${p.weight} ${p.size}px ${font}`
    ctx.fillStyle = p.fg
    ctx.fillText(p.text, cssW / 2, y + s.h / 2 + 0.5)
    y += s.h + gap
  })

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return {
    width: canvas.width,
    height: canvas.height,
    data: new Uint8Array(data.buffer.slice(0)),
    pixelRatio: ratio,
  }
}

/**
 * The always-on value chip, e.g. "28.0°C": small, light and quiet, so the
 * colour carries the pattern and the number is there when you look for it.
 * Dark ink on a near-white pill stays above 4.5:1 on every ramp colour.
 */
export function buildValueLabel(valueText: string): PatternImage | null {
  return drawPills(
    [{ text: valueText, size: 11, weight: 600, bg: 'rgba(255,255,255,0.9)', fg: INK, ring: 'rgba(19,26,23,0.22)' }],
    0,
  )
}

/** Hover / selection chip: village name above its value. */
export function buildFocusLabel(name: string, valueText: string): PatternImage | null {
  return drawPills(
    [
      { text: name, size: 12, weight: 600, bg: INK, fg: PAPER, ring: PAPER },
      { text: valueText, size: 11, weight: 600, bg: PAPER, fg: INK, ring: INK },
    ],
    2,
  )
}

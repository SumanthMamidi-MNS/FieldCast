/**
 * Confidence → texture.
 *
 * The single most important decision in this dashboard.
 *
 * The obvious move — fade low-confidence panchayats out with opacity — is wrong,
 * and wrong in a specific, dangerous way: to a non-expert, a paler blue on a
 * rainfall map reads as *less rain*, not as *less certainty*. The officer would
 * silently misread "we don't know" as "it will be dry here", which is exactly
 * the false-precision failure the PRD (§7) says this product exists to avoid.
 *
 * So confidence is carried on channels that are orthogonal to colour:
 *
 *   1. **Texture** — diagonal hatch (low) / sparse stipple (medium) / clean
 *      (high). Texture cannot be confused with "more" or "less" of a quantity.
 *   2. **Outline style** — a dashed boundary for low support. A broken line
 *      reads as "provisional" in every mapping convention.
 *   3. **Words** — every panchayat carries its `support_label` verbatim from the
 *      API, in the legend, the tooltip and the detail panel.
 *
 * Fill opacity is deliberately **identical** at all three levels. There is a
 * test asserting that, because it is the requirement most likely to be
 * "optimised" away later by someone making the map look prettier.
 */

import type { SupportLevel } from '../types/api'

export type TextureId = 'none' | 'stipple-medium' | 'hatch-low'

/** One constant fill opacity for every support level. Do not vary this. */
export const FILL_OPACITY = 0.75

export interface ConfidenceStyle {
  support: SupportLevel
  texture: TextureId
  /** Constant across support levels, on purpose. */
  fillOpacity: number
  outlineColor: string
  outlineWidth: number
  /** `null` means a solid line; an array is a MapLibre line-dasharray. */
  outlineDash: number[] | null
  /** Short chip text, e.g. for the map tooltip. */
  shortLabel: string
  /** Legend sentence written for someone who has never seen a confidence map. */
  legendExplanation: string
  /** Sort rank, worst-supported last. Used to order the panchayat list. */
  rank: number
}

const STYLES: Record<SupportLevel, ConfidenceStyle> = {
  high: {
    support: 'high',
    texture: 'none',
    fillOpacity: FILL_OPACITY,
    // Dark hairline (drawn over a white casing on the map) so boundaries show
    // even where a diverging fill sits near its white midpoint.
    outlineColor: 'rgba(16, 21, 27, 0.72)',
    outlineWidth: 1,
    outlineDash: null,
    shortLabel: 'Well supported',
    legendExplanation:
      'Plain fill: we have good local terrain data and a nearby weather station. Use the number.',
    rank: 0,
  },
  medium: {
    support: 'medium',
    texture: 'stipple-medium',
    fillOpacity: FILL_OPACITY,
    outlineColor: 'rgba(16, 21, 27, 0.72)',
    outlineWidth: 1,
    outlineDash: null,
    shortLabel: 'Moderate support',
    legendExplanation:
      'Dotted fill: reasonable but not strong local support. Use the range, not the single number.',
    rank: 1,
  },
  low: {
    support: 'low',
    texture: 'hatch-low',
    fillOpacity: FILL_OPACITY,
    outlineColor: '#1b1f24',
    outlineWidth: 1.8,
    outlineDash: [2, 1.4],
    shortLabel: 'Low support',
    legendExplanation:
      'Striped fill with a broken outline: little local data here. Treat as indicative and check locally before advising.',
    rank: 2,
  },
}

export function confidenceStyle(support: SupportLevel): ConfidenceStyle {
  return STYLES[support] ?? STYLES.low
}

export const SUPPORT_LEVELS: SupportLevel[] = ['high', 'medium', 'low']

/**
 * Map a 0..1 support score to a level, for the rare case where the API gives a
 * score without a label. The API's own `support` field always wins when present.
 */
export function supportFromScore(score: number): SupportLevel {
  if (!Number.isFinite(score)) return 'low'
  if (score >= 0.66) return 'high'
  if (score >= 0.33) return 'medium'
  return 'low'
}

/** MapLibre image name for a texture; `null` where no overlay should be drawn. */
export function texturePatternName(texture: TextureId): string | null {
  return texture === 'none' ? null : `confidence-${texture}`
}
